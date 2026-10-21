import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { TOPPINGS } from './rules.ts'

/** Chance the computer remembers each topping it saw on the pizza. */
export const REMEMBER: Record<Difficulty, number> = { easy: 0.5, normal: 0.75, hard: 0.95 }

/** Seconds the computer waits before its first pick, and between picks. */
export const THINK: Record<Difficulty, [number, number]> = {
  easy: [1.3, 1.9],
  normal: [1.0, 1.5],
  hard: [0.6, 1.0],
}
export const GAP: Record<Difficulty, [number, number]> = {
  easy: [0.9, 1.3],
  normal: [0.7, 1.0],
  hard: [0.45, 0.7],
}

/** Which slots of an order the computer remembers. */
export function memorise(len: number, difficulty: Difficulty, rng: Rng): boolean[] {
  return Array.from({ length: len }, () => rng.chance(REMEMBER[difficulty]))
}

/**
 * The topping the computer picks next: the one it remembers for this slot,
 * otherwise a random topping it has not used yet (and so may get wrong).
 */
export function nextPick(
  order: readonly number[],
  built: readonly number[],
  known: readonly boolean[],
  rng: Rng,
): number {
  const k = built.length
  if (known[k]) return order[k] ?? 0
  const unused = TOPPINGS.map((_, i) => i).filter((t) => !built.includes(t))
  return rng.pick(unused.length ? unused : TOPPINGS.map((_, i) => i))
}
