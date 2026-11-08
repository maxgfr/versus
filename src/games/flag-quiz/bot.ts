import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { BotPlan } from '../math-quiz/bot.ts'
import { COUNTRIES } from './countries.ts'

/** Seconds from the flag appearing to the computer's tap. */
export const BOT_TIME: Record<Difficulty, [number, number]> = {
  easy: [3, 5],
  normal: [1.9, 3.1],
  hard: [1.1, 1.8],
}

/** Chance the computer falls for the trap (locking itself out). */
export const BOT_WRONG: Record<Difficulty, number> = { easy: 0.3, normal: 0.12, hard: 0.03 }

/** When it gets a flag wrong, the computer falls for the most tempting trap, as people do. */
export function planFlagBot(
  d: Difficulty,
  rng: Rng,
  choices: readonly number[],
  answer: number,
): BotPlan {
  const [lo, hi] = BOT_TIME[d]
  const delay = rng.range(lo, hi)
  if (!rng.chance(BOT_WRONG[d])) return { delay, idx: choices.indexOf(answer), wrong: false }
  return { delay, idx: choices.indexOf(COUNTRIES[answer]?.traps[0] ?? -1), wrong: true }
}
