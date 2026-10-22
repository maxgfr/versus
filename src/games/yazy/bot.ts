import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { bestHold } from './odds.ts'
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
  return bestHold(dice, (d) => bestRow(d, sheet, turns).value, rerolls)
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
