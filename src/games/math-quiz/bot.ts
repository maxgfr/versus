import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** The computer's answer to one sum: when it taps, which button, and whether it is a slip. */
export interface BotPlan {
  delay: number
  idx: number
  wrong: boolean
}

/** Seconds from the sum appearing to the computer's tap. */
export const BOT_TIME: Record<Difficulty, [number, number]> = {
  easy: [3, 5],
  normal: [1.7, 2.8],
  hard: [0.9, 1.5],
}

/** Chance the computer taps a wrong option (locking itself out). */
export const BOT_WRONG: Record<Difficulty, number> = { easy: 0.25, normal: 0.05, hard: 0 }

/**
 * Plan the computer's answer for a sum whose options (in its order) are
 * `choices`. `effort` (see rules) stretches the time on harder sums.
 */
export function planBot(
  d: Difficulty,
  rng: Rng,
  choices: readonly number[],
  answer: number,
  effort = 1,
): BotPlan {
  const [lo, hi] = BOT_TIME[d]
  const delay = rng.range(lo, hi) * effort
  const right = choices.indexOf(answer)
  if (!rng.chance(BOT_WRONG[d])) return { delay, idx: right, wrong: false }
  const others = choices.map((_, i) => i).filter((i) => i !== right)
  return { delay, idx: rng.pick(others), wrong: true }
}
