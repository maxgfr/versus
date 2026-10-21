import type { Difficulty, Side } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'
import { hazardsOn, nextHazard, type Runner, RUN_X, SUPPORT } from './rules.ts'

/** Seconds of travel (at the current speed) the bot waits before it flips for a hazard. */
const REACT: Record<Difficulty, number> = { easy: 0.46, normal: 0.6, hard: 0.64 }
/** Random spread of the reaction, per hazard (seconds). */
const SPREAD: Record<Difficulty, number> = { easy: 0.2, normal: 0.06, hard: 0.03 }
/** Share of hazards the bot simply does not see. */
const LAPSE: Record<Difficulty, number> = { easy: 0.12, normal: 0.03, hard: 0 }

/**
 * Flip when the surface the runner is heading for has a hazard coming up
 * inside its reaction distance, and the other surface is clear until then.
 * A flip takes ~0.5 s of travel, so the reaction must cover that.
 */
export function shouldFlip(
  seed: number,
  r: Runner,
  speed: number,
  d: Difficulty,
  now: number,
  salt = 0,
): boolean {
  if (!r.alive || now - r.flipAt < 0.12) return false
  const cx = r.dist + RUN_X
  const here: Side = r.g > 0 ? 0 : 1
  const there: Side = here === 0 ? 1 : 0
  const h = nextHazard(seed, here, cx - SUPPORT)
  // The first hazards are always seen, so a round never ends on the opening step.
  if (h.i >= 2 && hash01(seed ^ salt, h.i, 5) < LAPSE[d]) return false
  const v = speed * r.mul
  const wait = (REACT[d] + (hash01(seed ^ salt, h.i, 9) * 2 - 1) * SPREAD[d]) * v
  if (h.x - cx > wait) return false
  // Only switch to a surface that is open from here until the hazard is past.
  return hazardsOn(seed, there, cx - SUPPORT, h.x + h.w).length === 0
}
