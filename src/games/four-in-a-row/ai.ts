import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { type Cell, COLS, legalColumns, play, ROWS, WINDOWS, winLine } from './rules.ts'

/**
 * The computer's search. Pure and synchronous, so it runs both on the main
 * thread (easy / normal) and in a Web Worker via `think()` (hard). Negamax with
 * α-β pruning, centre-first move ordering and a window heuristic.
 */

const DEPTH: Record<Difficulty, number> = { easy: 2, normal: 4, hard: 7 }
const ORDER = [3, 2, 4, 1, 5, 0, 6] as const
const WIN = 1_000_000

export interface Position {
  cells: Cell[]
  turn: Side
}

/** Value from `side`'s point of view: open windows, plus a bonus for the centre column. */
function evaluate(b: readonly Cell[], side: Side): number {
  let total = 0
  for (const w of WINDOWS) {
    let own = 0
    let opp = 0
    for (const i of w) {
      const v = b[i]
      if (v === side) own++
      else if (v !== null) opp++
    }
    if (own > 0 && opp > 0) continue
    if (own === 3) total += 5
    else if (own === 2) total += 2
    else if (opp === 3) total -= 4
    else if (opp === 2) total -= 1
  }
  const mid = Math.floor(COLS / 2)
  for (let r = 0; r < ROWS; r++) {
    const v = b[r * COLS + mid]
    if (v === side) total += 3
    else if (v !== null) total -= 3
  }
  return total
}

function negamax(
  b: Cell[],
  side: Side,
  depth: number,
  a: number,
  beta: number,
  ply: number,
): number {
  const w = winLine(b)
  if (w) return w.side === side ? WIN - ply : -(WIN - ply)
  const cols = legalColumns(b)
  if (cols.length === 0) return 0
  if (depth === 0) return evaluate(b, side)
  let best = -Infinity
  for (const col of ORDER) {
    if (!cols.includes(col)) continue
    const child = play(b, col, side)
    const v = -negamax(child, other(side), depth - 1, -beta, -a, ply + 1)
    if (v > best) best = v
    if (best > a) a = best
    if (a >= beta) break
  }
  return best
}

/** Column scores for the side to move, one per legal column. */
export function scores(pos: Position, depth: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const col of legalColumns(pos.cells)) {
    const child = play(pos.cells, col, pos.turn)
    out.set(col, -negamax(child, other(pos.turn), depth - 1, -Infinity, Infinity, 1))
  }
  return out
}

/**
 * The column the computer drops into. Easy plays at random 30% of the time.
 * Equal scores are broken by the seeded rng on easy and normal. Hard takes the
 * most central of them: at its depth, a random pick among equal scores is
 * noticeably weaker, because the evaluation cannot tell those moves apart.
 */
export function choose(pos: Position, difficulty: Difficulty, seed: number): number {
  const rng = new Rng(seed)
  const legal = legalColumns(pos.cells)
  if (difficulty === 'easy' && rng.chance(0.3)) return rng.pick(legal)
  const table = scores(pos, DEPTH[difficulty])
  let best = -Infinity
  let ties: number[] = []
  for (const col of ORDER) {
    const v = table.get(col)
    if (v === undefined) continue
    if (v > best) {
      best = v
      ties = [col]
    } else if (v === best) ties.push(col)
  }
  if (!ties.length) return rng.pick(legal)
  if (difficulty !== 'hard') return rng.pick(ties)
  // Mostly the most central tie; now and then another, so two hard computers do not repeat one game forever.
  return rng.chance(0.8) ? (ties[0] as number) : rng.pick(ties)
}
