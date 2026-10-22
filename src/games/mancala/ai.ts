// The computer's search runs in a Web Worker (see engines/board/worker.ts).
import type { Difficulty } from '../../core/game.ts'
import { chooseSeeded } from './bot.ts'
import type { Position } from './rules.ts'

export function choose(p: Position, difficulty: Difficulty, seed: number): number {
  return chooseSeeded(p, difficulty, seed)
}
