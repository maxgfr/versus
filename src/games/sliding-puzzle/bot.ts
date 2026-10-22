import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { foldPlan, neighbours, solveTaps } from './rules.ts'

/** Seconds between the computer's taps (each one varies a little, like a person's). */
export const PACE: Record<Difficulty, number> = { easy: 1.3, normal: 0.65, hard: 0.42 }

/** Chance that a tap is a slip (an adjacent tile moved for nothing, undone on the next tap). */
export const SLIP: Record<Difficulty, number> = { easy: 0.1, normal: 0.02, hard: 0 }

/**
 * How hard it looks for a short route (weighted search: 1 is shortest). Easy
 * wanders, hard finds a route close to the shortest.
 */
const WEIGHT: Record<Difficulty, number> = { easy: 5, normal: 2.2, hard: 1.6 }

/**
 * The computer's taps for a board, worked out from the board alone (it never
 * sees how it was scrambled). Normal and hard slide straight runs in one tap.
 * The search is capped; a looser search takes over if the tight one runs long.
 */
export function botPlan(tiles: readonly number[], d: Difficulty): number[] {
  let plan: number[] | null = null
  for (const w of [WEIGHT[d], 3, 8]) {
    plan = solveTaps(tiles, w, 60_000)
    if (plan) break
  }
  if (!plan) return []
  return d === 'easy' ? plan : foldPlan(tiles.indexOf(0), plan)
}

/**
 * The computer's next tap. It follows its plan (see `botPlan`), so it always
 * finishes. On a slip it taps a tile next
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
