import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Board,
  completes,
  doubleDealsAfter,
  drawLine,
  givesBox,
  legalLines,
  takeAll,
  waiting,
} from './rules.ts'

/**
 * The computer player. It returns the line to draw.
 *
 * - easy: a random line, often taking a box when one is on offer.
 * - normal: takes every box it can, else a line that gives nothing, else the
 *   smallest sacrifice.
 * - hard: as normal, but in the endgame it keeps control of a long chain by
 *   double-dealing, and it hands out two-box chains so the rival cannot decline.
 */
export function choose(board: Board, side: Side, difficulty: Difficulty, rng: Rng): number {
  const legal = legalLines(board)
  const completing = legal.filter((e) => completes(board, e))
  if (difficulty === 'easy') {
    if (completing.length && rng.chance(0.6)) return rng.pick(completing)
    return rng.pick(legal)
  }
  if (completing.length) {
    if (difficulty === 'hard') {
      const keep = control(board, side, legal)
      if (keep !== undefined) return keep
    }
    return rng.pick(completing)
  }
  const safe = legal.filter((e) => !givesBox(board, e))
  if (safe.length) return rng.pick(safe)
  return sacrifice(board, side, legal, difficulty === 'hard', rng)
}

/**
 * Endgame control: with no safe line left, and exactly two boxes still on the
 * table for the taking, decline them with a double-cross instead of taking
 * them. The rival collects two boxes and has to open the next chain.
 */
function control(board: Board, side: Side, legal: readonly number[]): number | undefined {
  if (legal.some((e) => !completes(board, e) && !givesBox(board, e))) return undefined
  if (takeAll(board) !== 2) return undefined
  return legal.find((e) => doubleDealsAfter(board, e, side))
}

/** The line that gives the rival the fewest boxes. Hard avoids handing out a chain it can decline. */
function sacrifice(
  board: Board,
  side: Side,
  legal: readonly number[],
  hard: boolean,
  rng: Rng,
): number {
  let best = Infinity
  let ties: number[] = []
  for (const e of legal) {
    const after = drawLine(board, e, side).board
    let cost = takeAll(after)
    if (hard && cost >= 2) {
      const w = waiting(after)
      if (w.length === 2 && w[0]?.missing === w[1]?.missing) cost += 0.5
    }
    if (cost < best) {
      best = cost
      ties = [e]
    } else if (cost === best) ties.push(e)
  }
  return rng.pick(ties.length ? ties : legal)
}
