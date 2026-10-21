import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  jokerOn,
  legalRows,
  MAX_ROLLS,
  rowScore,
  type Sheet,
  UPPER_ROWS,
  UPPER_TARGET,
  upperSum,
  YAZY_BONUS,
} from './rules.ts'

/**
 * Typical points a decent player gets from each row. Scoring a row costs this
 * much (times 0.6), so the bot keeps its straights and Yazy for real chances
 * and dumps a poor roll in a cheap row.
 */
const TYPICAL = [3, 6, 9, 12, 15, 18, 22, 12, 18, 25, 25, 10, 22]

export type BotAction =
  { kind: 'roll' } | { kind: 'hold'; held: boolean[] } | { kind: 'score'; row: number }

/** Gain of scoring `row` now: points (and any Yazy bonus) above what the row is typically worth. */
function gainOf(dice: readonly number[], sheet: Sheet, row: number): number {
  const joker = jokerOn(dice, sheet)
  const pts = rowScore(dice, row, joker) + (joker ? YAZY_BONUS : 0)
  let g = pts - (TYPICAL[row] ?? 10) * 0.6
  // While the upper bonus is still reachable, a face above its par of 3 pays it back.
  if (row < UPPER_ROWS && upperSum(sheet) < UPPER_TARGET) g += (pts - 3 * (row + 1)) * 0.5
  return g
}

/** Best row to score these dice in right now. */
function bestRow(dice: readonly number[], sheet: Sheet): { row: number; value: number } {
  let best = { row: legalRows(dice, sheet)[0] ?? 0, value: -Infinity }
  for (const row of legalRows(dice, sheet)) {
    const v = gainOf(dice, sheet, row)
    if (v > best.value) best = { row, value: v }
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

/** Best hold for one more roll, by expected row gain (one-roll lookahead). */
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
      if (rng.chance(0.3)) return { kind: 'score', row: greedyRow(dice, sheet, rng) }
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
  if (difficulty === 'easy') return { kind: 'score', row: greedyRow(dice, sheet, rng) }
  if (difficulty === 'normal' && rng.chance(0.2)) {
    // A slightly careless pick: the best row by raw points instead of by gain.
    return { kind: 'score', row: greedyRow(dice, sheet, rng) }
  }
  return { kind: 'score', row: stand.row }
}

/** Highest raw score (bonus included), ties at random: what a beginner does. */
function greedyRow(dice: readonly number[], sheet: Sheet, rng: Rng): number {
  const joker = jokerOn(dice, sheet)
  const rows = legalRows(dice, sheet)
  const raw = (r: number) => rowScore(dice, r, joker) + (joker ? YAZY_BONUS : 0)
  const best = Math.max(...rows.map(raw))
  return rng.pick(rows.filter((r) => raw(r) === best))
}

const sameHold = (a: readonly boolean[], b: readonly boolean[]) => a.every((v, i) => v === b[i])
