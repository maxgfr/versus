import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { candidateList, candidates, hiddenSingles, nakedSingles, solve } from './rules.ts'

/**
 * Seconds a single takes to spot (it plays only in demos and tests: 1P is a
 * solo time trial). Harder deductions take longer, see `Move.think`.
 */
export const PACE: Record<Difficulty, number> = { easy: 6, normal: 3.2, hard: 1.8 }

/** Chance of a slip of the finger on an obvious cell. */
const SLIP: Record<Difficulty, number> = { easy: 0.08, normal: 0.02, hard: 0 }

export interface Move {
  cell: number
  digit: number
  /** How hard it was to find, as a multiple of the pace. */
  think: number
}

/**
 * The next cell a person would fill, by the real rules: an obvious cell (a
 * single candidate) first, then a digit with one place left in a row, column
 * or box (normal and hard). With nothing obvious, hard works the grid out
 * by search (always right, but slow); easy and normal guess among the
 * candidates of the tightest cell, and a wrong guess costs them the penalty.
 * It sees only the board: the hidden solution is never read.
 */
export function nextMove(
  grid: readonly number[],
  d: Difficulty,
  rng: Rng,
  avoid: { cell: number; digit: number } | null = null,
): Move | null {
  const slip = (m: { cell: number; digit: number }, think: number): Move => {
    if (!rng.chance(SLIP[d])) return { ...m, think }
    const wrong = candidateList(grid, m.cell).filter((v) => v !== m.digit)
    const pool = wrong.length ? wrong : [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((v) => v !== m.digit)
    return { cell: m.cell, digit: rng.pick(pool), think }
  }
  const naked = nakedSingles(grid)
  if (naked.length) return slip(rng.pick(naked), 1)
  if (d !== 'easy') {
    const hidden = hiddenSingles(grid)
    if (hidden.length) return slip(rng.pick(hidden), 1.4)
  }
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
  if (d === 'hard') {
    const worked = solve(grid)
    if (worked) return { cell: best, digit: worked[best] as number, think: 2 }
  }
  const all = candidateList(grid, best)
  const guesses = all.filter((v) => best !== avoid?.cell || v !== avoid.digit)
  const pool = guesses.length ? guesses : all
  if (!pool.length) return null
  return { cell: best, digit: rng.pick(pool), think: 1.6 }
}
