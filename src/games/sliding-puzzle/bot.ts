import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { neighbours } from './rules.ts'

/** Seconds between the computer's taps. */
export const PACE: Record<Difficulty, number> = { easy: 1.3, normal: 0.8, hard: 0.45 }

/** Chance that a tap is a slip (an adjacent tile moved for nothing, undone on the next tap). */
export const SLIP: Record<Difficulty, number> = { easy: 0.1, normal: 0.03, hard: 0 }

/**
 * The computer's next tap. It follows its plan (the scramble undone move by
 * move, see `solvePlan`), so it always finishes. On a slip it taps a tile next
 * to the gap instead and puts the undo in front of the plan.
 */
export function botTap(
  tiles: readonly number[],
  plan: readonly number[],
  d: Difficulty,
  rng: Rng,
): { cell: number; plan: number[] } | null {
  const head = plan[0]
  if (head === undefined) return null
  const gap = tiles.indexOf(0)
  if (rng.chance(SLIP[d])) {
    const wrong = rng.pick(neighbours(gap).filter((n) => n !== head))
    return { cell: wrong, plan: [gap, ...plan] }
  }
  return { cell: head, plan: plan.slice(1) }
}
