import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { apply, evaluate, legalCells, type Position, settle, winner } from './rules.ts'

/** The position after `cell` is played and every chain has resolved. */
function after(p: Position, cell: number): Position {
  return settle(apply(p, cell))
}

/**
 * The computer's cell. `easy` is random. `normal` simulates each legal move and
 * keeps the one with the best static score. `hard` also looks at the rival's
 * best reply to each move.
 */
export function choose(p: Position, side: Side, difficulty: Difficulty, rng: Rng): number {
  const legal = legalCells(p, side)
  if (difficulty === 'easy') return rng.pick(legal)
  let best = rng.pick(legal)
  let bestV = -Infinity
  for (const m of legal) {
    const next = after(p, m)
    let v: number
    if (difficulty === 'normal' || winner(next) !== null) {
      v = evaluate(next, side)
    } else {
      // Hard: assume the rival answers with the reply that hurts most.
      const replies = legalCells(next, next.turn)
      v = replies.length === 0 ? evaluate(next, side) : Infinity
      for (const r of replies) {
        const answer = after(next, r)
        v = Math.min(v, evaluate(answer, side))
      }
    }
    v += rng.range(0, 0.15)
    if (v > bestV) {
      bestV = v
      best = m
    }
  }
  return best
}
