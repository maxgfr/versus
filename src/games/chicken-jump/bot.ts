import type { Difficulty } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'
import { type Chicken, CH_HALF, nextObstacle, type ObstacleKind, RUN_X } from './rules.ts'

/** Jump when the next obstacle is this fraction of a second of running away (by kind). */
const AIM: Record<ObstacleKind, number> = { fence: 0.3, hay: 0.3, pit: 0.23 }
/** Random spread of that aim, per obstacle, as a fraction of a second. */
const SPREAD: Record<Difficulty, number> = { easy: 0.16, normal: 0.07, hard: 0.03 }
/** Share of obstacles the bot misjudges and simply runs into. */
const LAPSE: Record<Difficulty, number> = { easy: 0.08, normal: 0.03, hard: 0 }

/**
 * Jump once the next obstacle is close enough that a jump now clears it: the
 * aim is a short run-up that is shorter for pits (which need the air time).
 */
export function shouldJump(
  seed: number,
  c: Chicken,
  speed: number,
  d: Difficulty,
  salt = 0,
): boolean {
  if (!c.alive || !c.grounded) return false
  const front = c.dist + RUN_X + CH_HALF
  const o = nextObstacle(seed, front - 10)
  // The opening obstacles are always seen, so a round never ends on the first step.
  if (o.i >= 2 && hash01(seed ^ salt, o.i, 5) < LAPSE[d]) return false
  const aim = AIM[o.kind] + (hash01(seed ^ salt, o.i, 9) * 2 - 1) * SPREAD[d]
  return o.x - front <= aim * speed
}
