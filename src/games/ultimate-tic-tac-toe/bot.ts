import type { Difficulty } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { bestMove, type SearchSpec } from '../../engines/board/index.ts'
import { lineWinner } from '../tic-tac-toe/rules.ts'
import { evaluate, legalMoves, play, type Position, verdict, winningCells } from './rules.ts'

const spec: SearchSpec<Position, number> = {
  moves: legalMoves,
  play,
  evaluate,
  over: (p) => verdict(p) !== null,
  turn: (p) => p.turn,
}

/**
 * One-ply heuristic for `normal`: take a small board, block the rival's
 * small-board threat, and avoid sending the rival to a board where it can win.
 */
function quick(p: Position, m: number): number {
  const side = p.turn
  const rival = other(side)
  const next = play(p, m)
  if (lineWinner(next.won)?.side === side) return 10000
  const b = Math.floor(m / 9)
  const i = m % 9
  let v = 0
  if (next.won[b] === side) v += 60
  if (winningCells(p.cells, b, rival).includes(i)) v += 40
  if (next.active === -1) v -= 6
  else if (winningCells(next.cells, next.active, rival).length > 0) v -= 50
  v += i === 4 ? 3 : i % 2 === 0 ? 2 : 1
  return v + evaluate(next, side) * 0.1
}

/** The move the computer plays. `easy` is random, `normal` one-ply, `hard` depth-3 negamax. */
export function choose(p: Position, difficulty: Difficulty, rng: Rng): number {
  const legal = legalMoves(p)
  if (difficulty === 'easy') return rng.pick(legal)
  if (difficulty === 'normal') {
    let best = rng.pick(legal)
    let bestV = -Infinity
    for (const m of legal) {
      const v = quick(p, m) + rng.range(0, 0.5)
      if (v > bestV) {
        bestV = v
        best = m
      }
    }
    return best
  }
  return bestMove(spec, p, 3, (n) => rng.int(0, n - 1)) ?? rng.pick(legal)
}
