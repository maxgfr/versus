import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Seconds from a picture appearing to the computer's tap. */
export const REACT: Record<Difficulty, [number, number]> = {
  easy: [0.55, 0.85],
  normal: [0.4, 0.62],
  hard: [0.26, 0.4],
}

/** Chance per non-matching picture that the computer taps anyway (easy only). */
export const FALSE_TAP: Record<Difficulty, number> = { easy: 0.07, normal: 0, hard: 0 }

/**
 * The computer's plan for one picture: `at` seconds after it appears it taps
 * (or not, `null`). It always catches a match; a non-match only on a false tap.
 */
export function planReaction(d: Difficulty, rng: Rng, matched: boolean): number | null {
  const [lo, hi] = REACT[d]
  const delay = rng.range(lo, hi)
  if (matched) return delay
  return rng.chance(FALSE_TAP[d]) ? delay : null
}
