import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MAX_ROLLS, NCATS, openRows, score, type Sheet } from './rules.ts'

/**
 * Typical value of each row, roughly what a decent player averages there.
 * Scoring a row costs its typical value; that's what makes the bot keep its
 * Yazy row for a real Yazy and dump a bad roll in a cheap row. The cost fades
 * as the match runs out of turns: on the last turn only the points count.
 */
const TYPICAL = [9, 12, 22, 16, 9, 12, 16, 12, 8]

export type BotAction =
  { kind: 'roll' } | { kind: 'hold'; held: boolean[] } | { kind: 'score'; cat: number }

/** How much an open row's typical value weighs, with `turns` turns left to fill `open` rows. */
function costWeight(open: number, turns: number): number {
  if (turns <= 1) return 0
  return 0.6 * Math.min(1, (turns - 1) / Math.max(1, open - 1))
}

/** Value of finishing the turn with these dice: best row by gain over its weighed typical value. */
function bestRow(
  dice: readonly number[],
  sheet: Sheet,
  turns = openRows(sheet).length,
): { cat: number; value: number } {
  const open = openRows(sheet)
  const w = costWeight(open.length, turns)
  let best = { cat: open[0] ?? 0, value: -Infinity }
  for (const cat of open) {
    const v = score(dice, cat) - (TYPICAL[cat] ?? 10) * w
    if (v > best.value) best = { cat, value: v }
  }
  return best
}

// ---------- exact dice odds over multisets ----------

/** A hand or a keep as face counts, encoded base 6 on the count of each face (≤ 5 dice). */
type Counts = number[]
const keyOf = (c: Counts): number => c.reduce((k, n) => k * 6 + n, 0)
const toDice = (c: Counts): number[] => c.flatMap((n, f) => Array<number>(n).fill(f + 1))

/** Every multiset of `r` dice with its probability. */
const OUTCOMES: { c: Counts; p: number }[][] = []
for (let r = 0; r <= 5; r++) {
  const out: { c: Counts; p: number }[] = []
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1))
  const walk = (face: number, left: number, c: Counts) => {
    if (face === 5) {
      const full = [...c, left]
      const ways = fact(r) / full.reduce((a, n) => a * fact(n), 1)
      out.push({ c: full, p: ways / 6 ** r })
      return
    }
    for (let n = 0; n <= left; n++) walk(face + 1, left - n, [...c, n])
  }
  walk(0, r, [])
  OUTCOMES.push(out)
}

const countsOf = (dice: readonly number[]): Counts => {
  const c = [0, 0, 0, 0, 0, 0]
  for (const v of dice) c[v - 1] = (c[v - 1] ?? 0) + 1
  return c
}

/**
 * Expected values over rerolls for one turn's sheet. `v0` is the value of
 * scoring a final hand; `keep(k, f)` the expectation of `f` after rolling the
 * dice not in keep `k`; `v1` the value of a hand with one reroll left.
 */
class Odds {
  private v0m = new Map<number, number>()
  private v1m = new Map<number, number>()
  private keepM = [new Map<number, number>(), new Map<number, number>()]

  constructor(
    private sheet: Sheet,
    private turns: number,
  ) {}

  v0(c: Counts): number {
    const k = keyOf(c)
    let v = this.v0m.get(k)
    if (v === undefined) {
      v = bestRow(toDice(c), this.sheet, this.turns).value
      this.v0m.set(k, v)
    }
    return v
  }

  /** E[f(hand)] keeping `keep` and rolling the rest. `level` picks f: 0 = v0, 1 = v1. */
  keep(keep: Counts, level: 0 | 1): number {
    const k = keyOf(keep)
    const m = this.keepM[level] as Map<number, number>
    let v = m.get(k)
    if (v !== undefined) return v
    const r = 5 - keep.reduce((a, n) => a + n, 0)
    v = 0
    for (const o of OUTCOMES[r] ?? []) {
      const hand = keep.map((n, i) => n + (o.c[i] ?? 0))
      v += o.p * (level === 0 ? this.v0(hand) : this.v1(hand))
    }
    m.set(k, v)
    return v
  }

  /** Best value of a hand with one reroll left: stand, or the best keep. */
  v1(c: Counts): number {
    const k = keyOf(c)
    let v = this.v1m.get(k)
    if (v !== undefined) return v
    v = this.v0(c)
    for (const sub of subKeeps(c)) v = Math.max(v, this.keep(sub, 0))
    this.v1m.set(k, v)
    return v
  }
}

/** Every sub-multiset of a hand (including empty and the whole hand). */
function subKeeps(c: Counts): Counts[] {
  const out: Counts[] = []
  const walk = (i: number, cur: Counts) => {
    if (i === 6) {
      out.push(cur)
      return
    }
    for (let n = 0; n <= (c[i] ?? 0); n++) walk(i + 1, [...cur, n])
  }
  walk(0, [])
  return out
}

function holdMasks(n: number): boolean[][] {
  const out: boolean[][] = []
  for (let m = 0; m < 1 << n; m++) out.push(Array.from({ length: n }, (_, i) => !!(m & (1 << i))))
  return out
}

/**
 * Best hold for the rerolls left (1 or 2), by exact expected row value. With
 * two rerolls left it looks two rolls ahead (it may keep less now to chase
 * more). `turns` is the number of turns left in the match.
 */
export function planHold(
  dice: readonly number[],
  sheet: Sheet,
  rerolls: 1 | 2 = 1,
  turns = openRows(sheet).length,
): { held: boolean[]; ev: number } {
  const odds = new Odds(sheet, turns)
  const level = rerolls === 2 ? 1 : 0
  let best = { held: dice.map(() => true), ev: -Infinity }
  for (const held of holdMasks(dice.length)) {
    if (held.every(Boolean)) continue
    const ev = odds.keep(countsOf(dice.filter((_, i) => held[i])), level)
    if (ev > best.ev + 1e-9) best = { held, ev }
  }
  return best
}

/**
 * One step of the bot's turn. Called repeatedly: roll, maybe set holds, roll
 * again, and finally score. `turns` is how many turns it has left in the
 * match (a match can be shorter than the nine rows).
 * - easy: holds its most common face and scores the biggest number, like a
 *   beginner (sometimes stopping early);
 * - normal: exact odds one roll ahead, with an occasional slip;
 * - hard: exact odds over both rerolls, and knows when the match is ending.
 */
export function decide(
  dice: readonly number[],
  held: readonly boolean[],
  rolls: number,
  sheet: Sheet,
  difficulty: Difficulty,
  rng: Rng,
  turns = Math.min(openRows(sheet).length, NCATS),
): BotAction {
  if (rolls === 0) return { kind: 'roll' }
  const t = difficulty === 'hard' ? turns : openRows(sheet).length
  const stand = bestRow(dice, sheet, t)
  if (rolls < MAX_ROLLS) {
    if (difficulty === 'easy') {
      // Holds the most common face, sometimes stops early.
      if (rng.chance(0.25)) return { kind: 'score', cat: greedyRow(dice, sheet, rng) }
      const counts = [0, 0, 0, 0, 0, 0, 0]
      for (const v of dice) counts[v] = (counts[v] ?? 0) + 1
      const face = counts.indexOf(Math.max(...counts))
      const want = dice.map((v) => v === face)
      if (!sameHold(want, held)) return { kind: 'hold', held: want }
      return { kind: 'roll' }
    }
    const rerolls = difficulty === 'hard' && MAX_ROLLS - rolls >= 2 ? 2 : 1
    const plan = planHold(dice, sheet, rerolls, t)
    const sloppy = difficulty === 'normal' && rng.chance(0.12)
    if (plan.ev > stand.value + 0.25) {
      const want = sloppy ? plan.held.map((h) => (rng.chance(0.2) ? !h : h)) : plan.held
      if (want.every(Boolean)) return { kind: 'score', cat: stand.cat }
      if (!sameHold(want, held)) return { kind: 'hold', held: want }
      return { kind: 'roll' }
    }
  }
  if (difficulty === 'easy') return { kind: 'score', cat: greedyRow(dice, sheet, rng) }
  return { kind: 'score', cat: stand.cat }
}

/** Highest raw score, ties at random: what a beginner does. */
function greedyRow(dice: readonly number[], sheet: Sheet, rng: Rng): number {
  const open = openRows(sheet)
  const best = Math.max(...open.map((c) => score(dice, c)))
  return rng.pick(open.filter((c) => score(dice, c) === best))
}

const sameHold = (a: readonly boolean[], b: readonly boolean[]) => a.every((v, i) => v === b[i])
