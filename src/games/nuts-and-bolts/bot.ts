import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Bolts, move, moves, solve } from './rules.ts'

/** Seconds between the computer's taps (a move is one lift and one drop). */
export const PACE: Record<Difficulty, number> = { easy: 1.4, normal: 0.7, hard: 0.5 }

/**
 * Chance, before each move, that the computer wanders off its plan: a legal
 * move it then has to recover from. Easy wanders often, hard never.
 */
export const DETOUR: Record<Difficulty, number> = { easy: 0.35, normal: 0.06, hard: 0 }

/**
 * The bolt the computer taps next, following its plan. With nothing in hand
 * it lifts the source of planned move `idx`; with a run in hand it drops on
 * that move's target. Null once the plan is spent.
 */
export function nextTap(
  plan: readonly [number, number][],
  idx: number,
  hand: boolean,
): { bolt: number } | null {
  const m = plan[idx]
  if (!m) return null
  return { bolt: hand ? m[1] : m[0] }
}

/**
 * A detour: a random legal move off the plan that still leaves the board
 * solvable, followed by a fresh plan from there. Null when no candidate works
 * (the computer then keeps its plan).
 */
export function detour(bolts: Bolts, rng: Rng, tries = 3): [number, number][] | null {
  const ms = moves(bolts)
  for (let t = 0; t < tries && ms.length; t++) {
    const i = rng.int(0, ms.length - 1)
    const m = ms.splice(i, 1)[0] as [number, number]
    const plan = solve(move(bolts, m[0], m[1]), 20000)
    if (plan) return [m, ...plan]
  }
  return null
}
