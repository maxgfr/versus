import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Seconds from a picture appearing to the computer's tap. */
export const REACT: Record<Difficulty, [number, number]> = {
  easy: [0.55, 0.85],
  normal: [0.34, 0.52],
  hard: [0.22, 0.34],
}

/** Chance per non-matching picture that the computer taps anyway. */
export const FALSE_TAP: Record<Difficulty, number> = { easy: 0.07, normal: 0.02, hard: 0 }
/** Chance per matching picture that the computer does not spot it at all. */
export const BLIND: Record<Difficulty, number> = { easy: 0.15, normal: 0.05, hard: 0 }

/**
 * The computer's plan for one picture: `at` seconds after it appears it taps
 * (or not, `null`). Hard always catches a match and never false-taps; the
 * lower levels now and then miss one or jump at a wrong one.
 */
export function planReaction(d: Difficulty, rng: Rng, matched: boolean): number | null {
  const [lo, hi] = REACT[d]
  const delay = rng.range(lo, hi)
  if (matched) return rng.chance(BLIND[d]) ? null : delay
  return rng.chance(FALSE_TAP[d]) ? delay : null
}
