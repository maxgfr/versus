import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { type Cell, counts, hasMove, legalMoves, type Move, N, apply } from './rules.ts'

/**
 * The computer's search. Pure and synchronous, so it runs both on the main
 * thread (tests) and in a Web Worker via `think()` (normal and hard). Negamax with
 * α-β pruning over a positional weight table plus mobility, and an exact disc
 * count once the board is nearly full.
 */

const DEPTH: Record<Difficulty, number> = { easy: 1, normal: 4, hard: 5 }
/** Hard plays the ending perfectly once this few squares are left. */
export const SOLVE = 9

/** Corners are gold, the squares beside them are poison. */
const WEIGHT: readonly number[] = [
  120, -20, 20, 5, 5, 20, -20, 120, -20, -40, -5, -5, -5, -5, -40, -20, 20, -5, 15, 3, 3, 15, -5,
  20, 5, -5, 3, 3, 3, 3, -5, 5, 5, -5, 3, 3, 3, 3, -5, 5, 20, -5, 15, 3, 3, 15, -5, 20, -20, -40,
  -5, -5, -5, -5, -40, -20, 120, -20, 20, 5, 5, 20, -20, 120,
]

const WIN = 100_000

export interface Position {
  cells: Cell[]
  turn: Side
}

/** Value for `side` to move: position, mobility, and the disc count near the end. */
function evaluate(b: readonly Cell[], side: Side): number {
  const rival = other(side)
  let pos = 0
  let empty = 0
  let discs = 0
  for (let i = 0; i < N * N; i++) {
    const v = b[i]
    if (v === side) {
      pos += WEIGHT[i] as number
      discs++
    } else if (v === rival) {
      pos -= WEIGHT[i] as number
      discs--
    } else empty++
  }
  const mobility = legalMoves(b, side).length - legalMoves(b, rival).length
  let value = pos + mobility * 8
  if (empty <= 12) value += discs * 6
  return value
}

function negamax(b: Cell[], side: Side, depth: number, a: number, beta: number): number {
  const mine = legalMoves(b, side)
  if (mine.length === 0) {
    if (!hasMove(b, other(side))) {
      const [x, y] = counts(b)
      const diff = side === 0 ? x - y : y - x
      return diff === 0 ? 0 : diff > 0 ? WIN + diff : -WIN + diff
    }
    // Pass: the rival moves again at the same depth.
    return -negamax(b, other(side), depth, -beta, -a)
  }
  if (depth === 0) return evaluate(b, side)
  // Corners and edges first: good moves cut the most.
  mine.sort((p, q) => (WEIGHT[q.at] as number) - (WEIGHT[p.at] as number))
  let best = -Infinity
  for (const m of mine) {
    const v = -negamax(apply(b, m, side), other(side), depth - 1, -beta, -a)
    if (v > best) best = v
    if (best > a) a = best
    if (a >= beta) break
  }
  return best
}

/** Every legal move for the side to move, scored (higher is better for that side). */
export function scores(pos: Position, depth: number): { move: Move; value: number }[] {
  return legalMoves(pos.cells, pos.turn).map((move) => ({
    move,
    value: -negamax(
      apply(pos.cells, move, pos.turn),
      other(pos.turn),
      depth - 1,
      -Infinity,
      Infinity,
    ),
  }))
}

/** Search depth: hard reads the last `SOLVE` squares to the very end. */
export function depthFor(pos: Position, difficulty: Difficulty): number {
  let empty = 0
  for (const c of pos.cells) if (c === null) empty++
  if (difficulty === 'hard' && empty <= SOLVE) return empty
  return DEPTH[difficulty]
}

/**
 * The square the computer plays. Ties are broken by the seeded rng. Easy plays
 * like a beginner: greedy for the most discs right now (ignoring corners and
 * the poison squares beside them), and at random a third of the time.
 */
export function choose(pos: Position, difficulty: Difficulty, seed: number): number {
  const rng = new Rng(seed)
  const legal = legalMoves(pos.cells, pos.turn)
  if (difficulty === 'easy') {
    if (rng.chance(0.35)) return rng.pick(legal).at
    let most = 0
    for (const m of legal) most = Math.max(most, m.flips.length)
    return rng.pick(legal.filter((m) => m.flips.length === most)).at
  }
  const table = scores(pos, depthFor(pos, difficulty))
  let best = -Infinity
  let ties: number[] = []
  for (const { move, value } of table) {
    if (value > best) {
      best = value
      ties = [move.at]
    } else if (value === best) ties.push(move.at)
  }
  return rng.pick(ties.length ? ties : legal.map((m) => m.at))
}
