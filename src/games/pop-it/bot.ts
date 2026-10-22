import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { legalMoves, type Move, winningMoves } from './rules.ts'

/** How often each level plays the solved (perfect) move while the board is still busy. */
const SHARP: Record<Difficulty, number> = { easy: 0.2, normal: 0.55, hard: 1 }
/** Normal sees the ending clearly once this few bubbles are left, like a human would. */
const CLEAR_END = 12

/**
 * The computer's turn: which row to pop from and how many. Misère Nim is
 * solved exactly (see rules), so the levels differ in how often they use it:
 * - easy: the perfect move a fifth of the time, otherwise a random pop of one
 *   to three bubbles (a beginner rarely clears whole rows);
 * - normal: perfect half the time, and always once the ending is clear;
 * - hard: always perfect. From a lost position it pops a single bubble from
 *   the fullest row, keeping the board as complicated as possible so a human
 *   can still go wrong.
 */
export function choose(heaps: readonly number[], difficulty: Difficulty, rng: Rng): Move {
  const legal = legalMoves(heaps)
  const left = heaps.reduce((a, b) => a + b, 0)
  const sharp = difficulty === 'normal' && left <= CLEAR_END ? true : rng.chance(SHARP[difficulty])
  if (sharp) {
    const win = winningMoves(heaps)
    if (win.length) return rng.pick(win)
    if (difficulty === 'hard') {
      let row = 0
      heaps.forEach((h, r) => {
        if (h > (heaps[row] ?? 0)) row = r
      })
      return { row, count: 1 }
    }
  }
  if (difficulty === 'easy') {
    const small = legal.filter((m) => m.count <= 3)
    if (small.length) return rng.pick(small)
  }
  return rng.pick(legal)
}
