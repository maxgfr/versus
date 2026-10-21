import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { legalMoves, type Move, winningMoves } from './rules.ts'

/**
 * The computer's turn: which row to pop from and how many. Hard plays perfect
 * misère Nim (it always finds the winning move when there is one). Normal does
 * so 60% of the time and otherwise pops at random. Easy always pops at random.
 */
export function choose(heaps: readonly number[], difficulty: Difficulty, rng: Rng): Move {
  const legal = legalMoves(heaps)
  if (difficulty === 'easy') return rng.pick(legal)
  if (difficulty === 'normal' && !rng.chance(0.6)) return rng.pick(legal)
  const win = winningMoves(heaps)
  return win.length ? rng.pick(win) : rng.pick(legal)
}
