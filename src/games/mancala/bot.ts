import type { Difficulty } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { bestMove, type SearchSpec } from '../../engines/board/index.ts'
import { apply, isOver, legalPits, type Position, STORE } from './rules.ts'

/** Search depth in plies by difficulty: easy sees one move ahead, hard eight. */
const DEPTH: Record<Difficulty, number> = { easy: 2, normal: 5, hard: 8 }

/** Negamax on store difference, from the side to move. */
const spec: SearchSpec<Position, number> = {
  moves: legalPits,
  play: apply,
  over: (p) => isOver(p.pits),
  turn: (p) => p.turn,
  evaluate: (p, side) => (p.pits[STORE[side]] ?? 0) - (p.pits[STORE[other(side)]] ?? 0),
}

/** The pit the computer sows from. */
export function choose(p: Position, difficulty: Difficulty, rng: Rng): number {
  const legal = legalPits(p)
  return bestMove(spec, p, DEPTH[difficulty], (n) => rng.int(0, n - 1)) ?? rng.pick(legal)
}
