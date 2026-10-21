import type { Difficulty } from '../../core/game.ts'

/**
 * The computer in Snakes & Ladders has no decisions to make: every turn it
 * rolls. The difficulty only sets how quickly it reacts (see `botDelay` in
 * index.ts), so all three levels share this one answer and any side can use it.
 */
export type BotAction = 'roll'

export function decide(_difficulty: Difficulty): BotAction {
  return 'roll'
}
