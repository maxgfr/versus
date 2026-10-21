import { Rng } from '../../core/rng.ts'
import type { Difficulty } from '../../core/game.ts'
import { choose as pick } from './bot.ts'
import type { Pos, Step } from './rules.ts'

/** Worker entry (see engines/board/worker.ts): the same search as bot.ts, off the main thread. */
export function choose(state: unknown, difficulty: string, seed: number): Step {
  return pick(state as Pos, difficulty as Difficulty, new Rng(seed))
}
