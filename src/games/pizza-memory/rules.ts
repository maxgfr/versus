import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure Pizza Memory rules over plain numbers. An order is a list of distinct
 * topping ids (indexes into TOPPINGS). A player rebuilds it from their own tray
 * one topping at a time; the first wrong pick ends their attempt. Everything
 * here is unit-tested.
 */

export const TOPPINGS = ['🍅', '🧀', '🍄', '🫑', '🧅', '🫒', '🌶️', '🍍', '🥓', '🌽'] as const
export const START_LEN = 3
export const MAX_LEN = TOPPINGS.length
export const MAX_ORDERS = 8

/** A topping's place on the shared pizza, relative to its centre. */
export interface Spot {
  x: number
  y: number
  a: number
}

/** A distinct random order of `len` toppings. */
export function makeOrder(rng: Rng, len: number): number[] {
  const all = TOPPINGS.map((_, i) => i)
  return rng.shuffle(all).slice(0, len)
}

/** Random, well-separated spots inside the pizza (radius `R`, pizza-centred). */
export function placeSpots(rng: Rng, n: number, R = 146, gap = 70): Spot[] {
  const out: Spot[] = []
  for (let k = 0; k < n; k++) {
    let best: Spot | null = null
    for (let tries = 0; tries < 300 && !best; tries++) {
      const r = R * Math.sqrt(rng.next())
      const t = rng.range(0, Math.PI * 2)
      const c = { x: Math.cos(t) * r, y: Math.sin(t) * r, a: rng.range(-0.5, 0.5) }
      if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= gap)) best = c
    }
    // Crowded pizza: accept the last try rather than stall.
    out.push(best ?? { x: rng.range(-R, R) * 0.5, y: rng.range(-R, R) * 0.5, a: 0 })
  }
  return out
}

/** The next order is one topping longer after a round where both players finished it. */
export function nextLength(len: number, bothRight: boolean): number {
  return bothRight ? Math.min(MAX_LEN, len + 1) : len
}

/** Is `topping` the one the next empty slot needs? */
export function rightPick(
  order: readonly number[],
  built: readonly number[],
  topping: number,
): boolean {
  return order[built.length] === topping
}

/**
 * Who has won once a round is resolved, or null while the game goes on. A
 * round where exactly one player rebuilt the order decides it; after `total`
 * rounds (the match length the players chose) the higher score wins (equal
 * scores draw).
 */
export function decide(
  right: [boolean, boolean],
  scores: [number, number],
  rounds: number,
  total = MAX_ORDERS,
): Side | 'draw' | null {
  if (right[0] !== right[1]) return right[0] ? 0 : 1
  if (rounds < total) return null
  return scores[0] === scores[1] ? 'draw' : scores[0] > scores[1] ? 0 : 1
}

/** Seconds from the start of an order until the first topping shows. */
export const LEAD = 1.2
/** Seconds between two toppings appearing. */
export const SHOW = 0.85
/** The fastest a topping is ever shown, late in a long match. */
export const SHOW_MIN = 0.55

/**
 * The match ramps up: every order finished shows its toppings a little faster
 * (`round` = orders already played), so the late rounds get tense.
 */
export function showTime(round: number): number {
  return Math.max(SHOW_MIN, SHOW - round * 0.04)
}
/** Seconds the full order stays on the pizza after the last topping. */
export const HOLD = 1.0

/** Length of the watch phase (appear one by one, then hold) for an order of `len`. */
export function watchLength(len: number, show = SHOW): number {
  return LEAD + len * show + HOLD
}
