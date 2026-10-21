import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { countOf, options, subsetsSumming } from './rules.ts'

/**
 * The tiles the computer shuts for this roll, or undefined when no open tiles
 * make it. Hard leaves the box with the best expected final score, normal shuts
 * the most tiles, easy picks any valid set.
 */
export function decide(
  open: number,
  total: number,
  difficulty: Difficulty,
  rng: Rng,
): number | undefined {
  const all = subsetsSumming(open, total)
  if (all.length === 0) return undefined
  if (difficulty === 'easy') return rng.pick(all)
  if (difficulty === 'normal') {
    const most = Math.max(...all.map(countOf))
    return rng.pick(all.filter((m) => countOf(m) === most))
  }
  const opts = options(open, total)
  const best = Math.min(...opts.map((o) => o.value))
  const ties = opts.filter((o) => o.value <= best + 1e-9)
  return rng.pick(ties).mask
}
