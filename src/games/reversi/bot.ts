import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { think } from '../../engines/board/index.ts'
import { choose as search } from './ai.ts'
import type { Cell } from './rules.ts'

/**
 * The computer player. Easy plays on the main thread; normal and hard run
 * `ai.ts` in a worker (`think`). Returns the square, or a promise of it when
 * the search is off-thread.
 */
export function choose(
  cells: readonly Cell[],
  side: Side,
  difficulty: Difficulty,
  rng: Rng,
): number | Promise<number> {
  const seed = rng.int(1, 2 ** 31 - 1)
  const pos = { cells: cells.slice(), turn: side }
  // Off-thread when a worker exists (the browser); inline otherwise (tests, old engines).
  if (difficulty !== 'easy' && typeof Worker !== 'undefined')
    return think<number>('reversi', pos, difficulty, seed)
  return search(pos, difficulty, seed)
}
