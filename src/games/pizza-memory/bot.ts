import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { START_LEN, TOPPINGS } from './rules.ts'

/** Chance the computer remembers each topping of a starting-length order. */
export const REMEMBER: Record<Difficulty, number> = { easy: 0.5, normal: 0.86, hard: 0.97 }
/**
 * Memory fades with every topping beyond the starting length, like a human's:
 * a long order is much harder for easy than for hard.
 */
export const FADE: Record<Difficulty, number> = { easy: 0.86, normal: 0.94, hard: 0.98 }
/** The middle of a long order is the hardest part to hold (first and last stick best). */
const MIDDLE = 0.9
/**
 * When it forgot a slot, how often the computer still narrows its guess to the
 * toppings it saw on the pizza (it remembers what, not where).
 */
export const NARROW: Record<Difficulty, number> = { easy: 0.15, normal: 0.75, hard: 1 }

/** Seconds the computer waits before its first pick, and between picks. */
export const THINK: Record<Difficulty, [number, number]> = {
  easy: [0.9, 1.4],
  normal: [0.7, 1.1],
  hard: [0.45, 0.75],
}
export const GAP: Record<Difficulty, [number, number]> = {
  easy: [0.6, 0.95],
  normal: [0.45, 0.7],
  hard: [0.3, 0.5],
}

/** Chance of remembering slot `k` of an order of `len`. */
export function recall(len: number, k: number, difficulty: Difficulty): number {
  let p = REMEMBER[difficulty] * FADE[difficulty] ** Math.max(0, len - START_LEN)
  if (len > START_LEN && k > 0 && k < len - 1) p *= MIDDLE
  return Math.min(0.99, p)
}

/** Which slots of an order the computer remembers. */
export function memorise(len: number, difficulty: Difficulty, rng: Rng): boolean[] {
  return Array.from({ length: len }, (_, k) => rng.chance(recall(len, k, difficulty)))
}

/**
 * The topping the computer picks next: the one it remembers for this slot.
 * Otherwise a guess: among the order's toppings it has not placed and does not
 * remember elsewhere (how often depends on the level), else any unused one.
 */
export function nextPick(
  order: readonly number[],
  built: readonly number[],
  known: readonly boolean[],
  rng: Rng,
  difficulty: Difficulty = 'easy',
): number {
  const k = built.length
  if (known[k]) return order[k] ?? 0
  if (rng.chance(NARROW[difficulty])) {
    const elsewhere = new Set(order.filter((_, i) => i > k && known[i]))
    const seen = order.filter((t, i) => i >= k && !built.includes(t) && !elsewhere.has(t))
    if (seen.length) return rng.pick(seen)
  }
  const unused = TOPPINGS.map((_, i) => i).filter((t) => !built.includes(t))
  return rng.pick(unused.length ? unused : TOPPINGS.map((_, i) => i))
}
