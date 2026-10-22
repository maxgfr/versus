import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { findSets, type Table } from './rules.ts'

/**
 * Seconds the computer takes to spot a triple on a table holding exactly one,
 * from the moment it starts looking. A table with more triples is quicker to
 * read (see `spotDelay`), for the computer as for a human.
 */
export const SPOT: Record<Difficulty, [number, number]> = {
  easy: [10, 16],
  normal: [5, 8.5],
  hard: [2.8, 4.6],
}

/** Seconds between its three taps once it has seen a triple. */
export const TAP_GAP: Record<Difficulty, [number, number]> = {
  easy: [0.5, 0.8],
  normal: [0.4, 0.6],
  hard: [0.28, 0.42],
}

/** How often it grabs three cards that only look like a triple (and pays for it). */
export const SLIP: Record<Difficulty, number> = { easy: 0.12, normal: 0.04, hard: 0 }

/** Spotting time on a table with `sets` triples in view. */
export function spotDelay(difficulty: Difficulty, rng: Rng, sets = 1): number {
  const [lo, hi] = SPOT[difficulty]
  const crowd = Math.min(1.3, Math.max(0.55, 1.3 / Math.sqrt(Math.max(1, sets))))
  return rng.range(lo, hi) * crowd
}

/** A triple the computer can find on the table (its slots), or null if there is none. */
export function pickTriple(t: Table, rng: Rng): [number, number, number] | null {
  const sets = findSets(t)
  return sets.length ? (rng.pick(sets) ?? null) : null
}

/**
 * What the computer goes for: a real triple, or now and then (easy most) a
 * near miss, two cards of a triple and a wrong third, as a hurried human would.
 */
export function botTriple(
  t: Table,
  difficulty: Difficulty,
  rng: Rng,
): [number, number, number] | null {
  const real = pickTriple(t, rng)
  if (!real || !rng.chance(SLIP[difficulty])) return real
  const others = t.map((_, i) => i).filter((i) => t[i] !== null && !real.includes(i))
  if (!others.length) return real
  const third = rng.pick(others)
  const wrong: [number, number, number] = [real[0], real[1], third]
  return findSets(t).some((x) => wrong.every((w) => x.includes(w))) ? real : wrong
}
