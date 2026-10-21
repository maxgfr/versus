import type { Difficulty } from '../../core/game.ts'

/** Seconds between the computer's taps (a move is one lift and one drop). */
export const PACE: Record<Difficulty, number> = { easy: 1.2, normal: 0.8, hard: 0.5 }

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
