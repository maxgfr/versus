import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { bestHold } from '../yazy/odds.ts'
import {
  jokerOn,
  jokerRules,
  legalRows,
  MAX_ROLLS,
  openRows,
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
 * and dumps a poor roll in a cheap row. The cost fades as the match runs out
 * of turns: on its last turn only the points count.
 */
const TYPICAL = [3, 6, 9, 12, 15, 18, 22, 12, 18, 25, 25, 10, 22]
/** What strong play averages in each row: hard prices its rows with these. */
const EXPECT = [2.1, 5.3, 8.6, 12.2, 15.7, 19.2, 21.7, 13.1, 22.6, 29.5, 32.7, 16.9, 22]

/** How a level prices a row: its cost table and weight, and how keenly it chases the upper bonus. */
interface Style {
  table: readonly number[]
  w: number
  up: number
}
const PLAIN: Style = { table: TYPICAL, w: 0.6, up: 0.5 }
/** Tuned by self-play (150 seeded games): about +6 points a game over PLAIN. */
const SHARP: Style = { table: EXPECT, w: 0.8, up: 1.5 }

export type BotAction =
  { kind: 'roll' } | { kind: 'hold'; held: boolean[] } | { kind: 'score'; row: number }

/** How much an open row's typical value weighs, with `turns` turns left to fill `open` rows. */
function costWeight(open: number, turns: number, style: Style): number {
  if (turns <= 1) return 0
  return style.w * Math.min(1, (turns - 1) / Math.max(1, open - 1))
}

/** Gain of scoring `row` now: points (and any Yazy bonus) above what the row is typically worth. */
function gainOf(
  dice: readonly number[],
  sheet: Sheet,
  row: number,
  w: number,
  turns: number,
  style: Style,
): number {
  const pts = rowScore(dice, row, jokerRules(dice, sheet)) + (jokerOn(dice, sheet) ? YAZY_BONUS : 0)
  let g = pts - (style.table[row] ?? 10) * w
  // While the upper bonus is still reachable, a face above its par of 3 pays it back.
  if (row < UPPER_ROWS && turns > 1 && upperSum(sheet) < UPPER_TARGET)
    g += (pts - 3 * (row + 1)) * style.up
  return g
}

/** Best row to score these dice in right now, with `turns` turns left in the match. */
function bestRow(
  dice: readonly number[],
  sheet: Sheet,
  turns = openRows(sheet).length,
  style: Style = PLAIN,
): { row: number; value: number } {
  const w = costWeight(openRows(sheet).length, turns, style)
  const legal = legalRows(dice, sheet)
  let best = { row: legal[0] ?? 0, value: -Infinity }
  for (const row of legal) {
    const v = gainOf(dice, sheet, row, w, turns, style)
    if (v > best.value) best = { row, value: v }
  }
  return best
}

/**
 * Best hold for the rerolls left (1 or 2), by exact expected row gain: two
 * rerolls ahead looks further (it may keep less now to chase more).
 */
export function planHold(
  dice: readonly number[],
  sheet: Sheet,
  rerolls: 1 | 2 = 1,
  turns = openRows(sheet).length,
  style: Style = PLAIN,
): { held: boolean[]; ev: number } {
  return bestHold(dice, (d) => bestRow(d, sheet, turns, style).value, rerolls)
}

/**
 * One step of the bot's turn. Called repeatedly: roll, maybe set holds, roll
 * again, and finally score. `turns` is how many turns it has left.
 * - easy: holds its most common face and scores the biggest number;
 * - normal: exact odds one roll ahead, with an occasional slip;
 * - hard: exact odds over both rerolls, and plays the match's last turns for points.
 */
export function decide(
  dice: readonly number[],
  held: readonly boolean[],
  rolls: number,
  sheet: Sheet,
  difficulty: Difficulty,
  rng: Rng,
  turns = openRows(sheet).length,
): BotAction {
  if (rolls === 0) return { kind: 'roll' }
  const t = difficulty === 'hard' ? turns : openRows(sheet).length
  const style = difficulty === 'hard' ? SHARP : PLAIN
  const stand = bestRow(dice, sheet, t, style)
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
    const rerolls = difficulty === 'hard' && MAX_ROLLS - rolls >= 2 ? 2 : 1
    const plan = planHold(dice, sheet, rerolls, t, style)
    const sloppy = difficulty === 'normal' && rng.chance(0.12)
    if (plan.ev > stand.value + 0.25) {
      const want = sloppy ? plan.held.map((h) => (rng.chance(0.2) ? !h : h)) : plan.held
      if (!sameHold(want, held)) return { kind: 'hold', held: want }
      return { kind: 'roll' }
    }
  }
  if (difficulty === 'easy') return { kind: 'score', row: greedyRow(dice, sheet, rng) }
  if (difficulty === 'normal' && rng.chance(0.08)) {
    // A slightly careless pick: the best row by raw points instead of by gain.
    return { kind: 'score', row: greedyRow(dice, sheet, rng) }
  }
  return { kind: 'score', row: stand.row }
}

/** Highest raw score (bonus included), ties at random: what a beginner does. */
function greedyRow(dice: readonly number[], sheet: Sheet, rng: Rng): number {
  const joker = jokerRules(dice, sheet)
  const rows = legalRows(dice, sheet)
  const raw = (r: number) => rowScore(dice, r, joker)
  const best = Math.max(...rows.map(raw))
  return rng.pick(rows.filter((r) => raw(r) === best))
}

const sameHold = (a: readonly boolean[], b: readonly boolean[]) => a.every((v, i) => v === b[i])
