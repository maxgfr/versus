import type { Difficulty, Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { planTurn } from './bot.ts'
import type { Pos, Step } from './rules.ts'

/** What the worker is asked: the position the turn starts from, who moves, and the dice. */
export interface AiState {
  pos: Pos
  side: Side
  dice: number[]
}

/**
 * Worker entry (see `think()` in engines/board): the hard bot's one-ply
 * expectimax over the opponent's 21 rolls can take a second on a busy turn,
 * so it plans the whole turn off the main thread.
 */
export function choose(state: AiState, difficulty: string, seed: number): Step[] {
  return planTurn(state.pos, state.side, state.dice, difficulty as Difficulty, new Rng(seed))
}
