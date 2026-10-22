// The hard search runs in a Web Worker (see engines/board/worker.ts) so a deep
// think never stalls the frame.
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose as pick } from './bot.ts'
import type { Position } from './rules.ts'

export function choose(p: Position, difficulty: Difficulty, seed: number): number {
  return pick(p, difficulty, new Rng(seed))
}
