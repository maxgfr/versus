import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Seconds from a new card coming up to the computer finding its symbol. */
export const FIND_TIME: Record<Difficulty, [number, number]> = {
  easy: [3.4, 4.8],
  normal: [1.7, 2.6],
  hard: [0.95, 1.5],
}

/** Chance the computer taps a look-alike first (and is frozen like a human would be). */
export const SLIP: Record<Difficulty, number> = { easy: 0.12, normal: 0.05, hard: 0 }

/**
 * How long the computer takes to spot the shared symbol after a card changes.
 * `heat` (0..1, see rules) makes late cards a little slower to read for it too.
 */
export function findDelay(d: Difficulty, rng: Rng, heat = 0): number {
  const [lo, hi] = FIND_TIME[d]
  return rng.range(lo, hi) * (1 + 0.15 * heat)
}
