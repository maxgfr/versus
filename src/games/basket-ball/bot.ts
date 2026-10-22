import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  FLICK_FAST,
  FLICK_SLOW,
  GAIN,
  MAX_SWIPE,
  MIN_SWIPE,
  T_RING,
  hoopAt,
  ready,
  type World,
} from './rules.ts'

interface Tuning {
  /** Angular error on each swipe (radians, ±). */
  angle: number
  /** Relative error on each swipe's length (±). */
  length: number
  /** Seconds between two shots (after the last one was launched). */
  cadence: number
  /** How snappy its flicks are, 0 (lazy lob) .. 1 (fastest tempo). */
  snap: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { angle: 0.3, length: 0.3, cadence: 2.1, snap: 0.1 },
  normal: { angle: 0.17, length: 0.15, cadence: 1.4, snap: 0.5 },
  hard: { angle: 0.1, length: 0.09, cadence: 0.9, snap: 0.9 },
}

/** Per-bot memory between steps (not synced). */
export interface BotMemory {
  cool: number
}

export const newMemory = (): BotMemory => ({ cool: 0 })

export interface Swipe {
  dx: number
  dy: number
  len: number
  /** Flick speed (world units/s): sets the shot's tempo. */
  flick: number
}

/**
 * The swipe that would put the ball's flight through the rim centre: the ground
 * distance to the hoop over the flight time gives the speed, the speed gives the
 * swipe length. Error and cadence depend on difficulty. Null when no shot now.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Swipe | null {
  const tune = TUNING[d]
  mem.cool -= dt
  if (!ready(w, side) || mem.cool > 0) return null
  mem.cool = tune.cadence * (0.85 + rng.next() * 0.3)
  const b = w.balls[side]
  const hoop = hoopAt(side)
  const dx = hoop.x - b.x
  const dy = hoop.y - b.y
  const speed = Math.hypot(dx, dy) / T_RING
  const ang = Math.atan2(dy, dx) + (rng.next() * 2 - 1) * tune.angle
  const len = (speed / GAIN) * (1 + (rng.next() * 2 - 1) * tune.length)
  return {
    dx: Math.cos(ang),
    dy: Math.sin(ang),
    len: Math.min(MAX_SWIPE, Math.max(MIN_SWIPE, len)),
    flick:
      FLICK_SLOW + (FLICK_FAST - FLICK_SLOW) * Math.min(1, tune.snap + (rng.next() - 0.5) * 0.3),
  }
}
