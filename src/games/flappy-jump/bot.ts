import type { Difficulty } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'
import {
  type Climber,
  GRAV,
  type Plat,
  platformsBetween,
  platX,
  solidFor,
  SPEED_X,
  wrapDelta,
} from './rules.ts'

/** How far off the bot's aim point may be (world units), per platform. */
const ERROR: Record<Difficulty, number> = { easy: 80, normal: 20, hard: 6 }
/** Share of quarter-second slots in which the bot forgets to steer. */
const LAPSE: Record<Difficulty, number> = { easy: 0.12, normal: 0, hard: 0 }
/** Steering reaches full speed this far (units) off target. */
const FULL = 70
/** Seconds ahead the bot aims for, to meet a moving platform. */
const AHEAD = 0.35
/** Seconds of current sideways speed the bot brakes for. */
const DAMP = 0.25

/**
 * Steer toward the platform the current bounce will come down on: the highest
 * solid one under the apex of this jump that can still be reached sideways in
 * the time left (lower ones are the fallback). Returns a direction in [-1, 1].
 */
export function steer(seed: number, c: Climber, now: number, d: Difficulty, salt = 0): number {
  if (!c.alive) return 0
  const up = Math.max(0, c.vh)
  const apex = c.h + (up * up) / (2 * GRAV)
  const rise = up / GRAV
  let target: Plat | undefined
  let fallback: Plat | undefined
  // Look well below too: the nearer ones may have crumbled.
  for (const p of platformsBetween(seed, c.h - 900, apex - 12)) {
    if (!solidFor(c, p, now)) continue
    // Still below it while rising toward it is fine; once past, it must be under the feet.
    if (c.vh < 0 && p.h > c.h) continue
    if (!fallback || p.h > fallback.h) fallback = p
    const t = rise + Math.sqrt((2 * Math.max(0, apex - p.h)) / GRAV)
    const reach = SPEED_X * t * 0.8
    if (Math.abs(wrapDelta(platX(p, now + t), c.x)) > reach) continue
    if (!target || p.h > target.h) target = p
  }
  target ??= fallback
  if (!target) return 0
  // A lapse is a short blip in time, never tied to one platform, so it cannot stall the climb.
  if (hash01(seed ^ salt, Math.floor(now * 4), 5) < LAPSE[d]) return 0
  // Aim where a moving platform will be by the time the bounce brings us there.
  const aim = platX(target, now + AHEAD) + (hash01(seed ^ salt, target.i, 8) * 2 - 1) * ERROR[d]
  // Damped: the speed already carried counts against the distance still to go.
  const dx = wrapDelta(aim, c.x) - c.vx * DAMP
  if (Math.abs(dx) < 8) return 0
  return Math.max(-1, Math.min(1, dx / FULL))
}
