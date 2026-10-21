import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { findSets, type Table } from './rules.ts'

/** Seconds the computer takes to spot a triple, from the moment it starts looking. */
export const SPOT: Record<Difficulty, [number, number]> = {
  easy: [12, 18],
  normal: [7, 11],
  hard: [3, 6],
}

export function spotDelay(difficulty: Difficulty, rng: Rng): number {
  const [lo, hi] = SPOT[difficulty]
  return rng.range(lo, hi)
}

/** A triple the computer can find on the table (its slots), or null if there is none. */
export function pickTriple(t: Table, rng: Rng): [number, number, number] | null {
  const sets = findSets(t)
  return sets.length ? (rng.pick(sets) ?? null) : null
}
