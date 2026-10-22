import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { apply, evaluate, legalCells, type Position, settle, winner } from './rules.ts'

/** The position after `cell` is played and every chain has resolved. */
function after(p: Position, cell: number): Position {
  return settle(apply(p, cell))
}

/**
 * How each level plays: how many moves it reads ahead (its own and the
 * rival's), and how often it just taps one of its cells. Easy grabs what looks
 * best right now, but often taps anywhere; normal also sees the rival's best
 * answer; hard reads four moves deep.
 */
const LEVEL: Record<Difficulty, { depth: number; slip: number; noise: number }> = {
  easy: { depth: 1, slip: 0.5, noise: 1.5 },
  normal: { depth: 2, slip: 0, noise: 0.15 },
  hard: { depth: 4, slip: 0, noise: 0.05 },
}

const WIN = 1000

/** Negamax with α-β; values are for the side to move in `p`. Faster wins score higher. */
function negamax(p: Position, depth: number, a: number, b: number): number {
  const w = winner(p)
  if (w !== null) return w === p.turn ? WIN + depth : -(WIN + depth)
  if (depth === 0) return evaluate(p, p.turn)
  const moves = legalCells(p, p.turn)
  if (moves.length === 0) return evaluate(p, p.turn)
  // Look at the moves that look best right now first: better cut-offs.
  const kids = moves.map((m) => {
    const q = after(p, m)
    return { q, v: -evaluate(q, q.turn) }
  })
  kids.sort((x, y) => y.v - x.v)
  let best = -Infinity
  for (const { q } of kids) {
    const v = -negamax(q, depth - 1, -b, -a)
    if (v > best) best = v
    if (best > a) a = best
    if (a >= b) break
  }
  return best
}

/** The computer's cell. */
export function choose(p: Position, side: Side, difficulty: Difficulty, rng: Rng): number {
  const legal = legalCells(p, side)
  const lv = LEVEL[difficulty]
  if (lv.slip > 0 && rng.chance(lv.slip)) return rng.pick(legal)
  let best = rng.pick(legal)
  let bestV = -Infinity
  for (const m of legal) {
    const next = after(p, m)
    const v = -negamax(next, lv.depth - 1, -Infinity, Infinity) + rng.range(0, lv.noise)
    if (v > bestV) {
      bestV = v
      best = m
    }
  }
  return best
}
