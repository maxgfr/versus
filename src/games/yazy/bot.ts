import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MAX_ROLLS, openRows, score, type Sheet } from './rules.ts'

/**
 * Typical value of each row, roughly what a decent player averages there.
 * Scoring a row costs its typical value; that's what makes the bot keep its
 * Yazy row for a real Yazy and dump a bad roll in a cheap row.
 */
const TYPICAL = [9, 12, 22, 16, 9, 12, 16, 12, 8]

export type BotAction =
  { kind: 'roll' } | { kind: 'hold'; held: boolean[] } | { kind: 'score'; cat: number }

/** Value of finishing the turn with these dice: best row by gain over its typical value. */
function bestRow(dice: readonly number[], sheet: Sheet): { cat: number; value: number } {
  let best = { cat: openRows(sheet)[0] ?? 0, value: -Infinity }
  for (const cat of openRows(sheet)) {
    const v = score(dice, cat) - (TYPICAL[cat] ?? 10) * 0.6
    if (v > best.value) best = { cat, value: v }
  }
  return best
}

/** All outcomes of rerolling the non-held dice, enumerated (at most 6^5). */
function expected(
  dice: readonly number[],
  held: readonly boolean[],
  value: (d: readonly number[]) => number,
): number {
  const free = held.flatMap((h, i) => (h ? [] : [i]))
  const n = free.length
  if (n === 0) return value(dice)
  const total = 6 ** n
  const d = dice.slice()
  let acc = 0
  for (let k = 0; k < total; k++) {
    let x = k
    for (const i of free) {
      d[i] = (x % 6) + 1
      x = Math.floor(x / 6)
    }
    acc += value(d)
  }
  return acc / total
}

function holdMasks(n: number): boolean[][] {
  const out: boolean[][] = []
  for (let m = 0; m < 1 << n; m++) out.push(Array.from({ length: n }, (_, i) => !!(m & (1 << i))))
  return out
}

/** Best hold for one more roll, by expected row value (one-roll lookahead). */
export function planHold(dice: readonly number[], sheet: Sheet): { held: boolean[]; ev: number } {
  // Only 252 distinct hands exist: memoise by sorted dice.
  const memo = new Map<string, number>()
  const value = (d: readonly number[]) => {
    const key = d.slice().sort().join('')
    let v = memo.get(key)
    if (v === undefined) memo.set(key, (v = bestRow(d, sheet).value))
    return v
  }
  let best = { held: dice.map(() => true), ev: -Infinity }
  for (const held of holdMasks(dice.length)) {
    const ev = expected(dice, held, value)
    if (ev > best.ev + 1e-9) best = { held, ev }
  }
  return best
}

/**
 * One step of the bot's turn. Called repeatedly: roll, maybe set holds, roll
 * again, and finally score.
 */
export function decide(
  dice: readonly number[],
  held: readonly boolean[],
  rolls: number,
  sheet: Sheet,
  difficulty: Difficulty,
  rng: Rng,
): BotAction {
  if (rolls === 0) return { kind: 'roll' }
  const stand = bestRow(dice, sheet)
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
    const plan = planHold(dice, sheet)
    const sloppy = difficulty === 'normal' && rng.chance(0.3)
    if (plan.ev > stand.value + 0.5 && !plan.held.every(Boolean)) {
      const want = sloppy ? plan.held.map((h) => (rng.chance(0.2) ? !h : h)) : plan.held
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
