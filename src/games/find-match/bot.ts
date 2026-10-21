import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Seconds from a new card coming up to the computer finding its symbol. */
export const FIND_TIME: Record<Difficulty, [number, number]> = {
  easy: [3.4, 4.8],
  normal: [2, 3.2],
  hard: [1.2, 1.9],
}

/** How long the computer takes to spot the shared symbol after a card changes. */
export function findDelay(d: Difficulty, rng: Rng): number {
  const [lo, hi] = FIND_TIME[d]
  return rng.range(lo, hi)
}
