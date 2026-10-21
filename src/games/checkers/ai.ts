import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose as pick, type Pos } from './bot.ts'
import type { Move } from './rules.ts'

/** Worker entry (see engines/board/worker.ts): the same search as bot.ts, off the main thread. */
export function choose(state: unknown, difficulty: string, seed: number): Move {
  return pick(state as Pos, difficulty as Difficulty, new Rng(seed))
}
