import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { candidates } from './rules.ts'

/** Seconds between the computer's moves (it plays only in demos and tests: 1P is a solo time trial). */
export const PACE: Record<Difficulty, number> = { easy: 7, normal: 4.5, hard: 2.6 }

/**
 * The next cell a person would fill: the empty cell with the fewest
 * candidates. Returns the cell and the correct digit, or a plausible wrong one
 * now and then on easier levels.
 */
export function nextMove(
  grid: readonly number[],
  solution: readonly number[],
  d: Difficulty,
  rng: Rng,
): { cell: number; digit: number } | null {
  let best = -1
  let bestN = 10
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue
    let n = 0
    let m = candidates(grid, i)
    while (m) {
      m &= m - 1
      n++
    }
    if (n < bestN) {
      best = i
      bestN = n
    }
  }
  if (best < 0) return null
  const right = solution[best] as number
  const slip = d === 'easy' ? 0.12 : d === 'normal' ? 0.05 : 0
  if (rng.chance(slip)) {
    const wrong = rng.pick([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => v !== right))
    return { cell: best, digit: wrong }
  }
  return { cell: best, digit: right }
}
