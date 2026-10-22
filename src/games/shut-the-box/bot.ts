import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { countOf, options, subsetsSumming, winChance } from './rules.ts'

/**
 * The tiles the computer shuts for this roll, or undefined when no open tiles
 * make it. `beat` is the rival's final score when it is already known (the
 * computer plays second).
 * - easy: shuts the most tiles half the time, any valid set otherwise;
 * - normal: leaves the box with the lowest expected final score (exact);
 * - hard: the same when playing first; when playing second it plays for the
 *   best chance to beat the known score, which is not always the lowest average.
 */
export function decide(
  open: number,
  total: number,
  difficulty: Difficulty,
  rng: Rng,
  beat: number | null = null,
): number | undefined {
  const all = subsetsSumming(open, total)
  if (all.length === 0) return undefined
  if (difficulty === 'easy') {
    if (rng.chance(0.5)) return rng.pick(all)
    const most = Math.max(...all.map(countOf))
    return rng.pick(all.filter((m) => countOf(m) === most))
  }
  if (difficulty === 'hard' && beat !== null) {
    const chance = all.map((m) => winChance(open ^ m, beat))
    const best = Math.max(...chance)
    return rng.pick(all.filter((_, i) => (chance[i] ?? 0) >= best - 1e-9))
  }
  const opts = options(open, total)
  const best = Math.min(...opts.map((o) => o.value))
  const ties = opts.filter((o) => o.value <= best + 1e-9)
  return rng.pick(ties).mask
}
