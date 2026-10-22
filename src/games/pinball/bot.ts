import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'
import { BALL_R, FLIP_LEN, FLIP_TIME, PIVOT, RAIL_R, RAILS, type World } from './rules.ts'

/**
 * The computer player. It reads the table in its own frame (its flippers at
 * the bottom, as red sees them), so the same code plays red or blue. It
 * watches the ball's predicted arrival at its flipper line and swings the
 * flipper on the side the ball will land, after a reaction delay and with a
 * timing error that depends on difficulty.
 */

interface Tuning {
  /** Seconds to notice a ball heading in (scaled by 0.7..1.3 per ball). */
  react: number
  /** Timing error (s) on when the swing starts. */
  lead: number
  /** Chance to swing the wrong flipper. */
  miss: number
  /** Seconds a flipper is held up once the bot calls it. */
  hold: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.22, lead: 0.1, miss: 0.22, hold: 0.22 },
  normal: { react: 0.12, lead: 0.045, miss: 0.07, hold: 0.2 },
  hard: { react: 0.04, lead: 0.012, miss: 0.015, hold: 0.2 },
}

/** Per-bot memory carried between steps (host only, not synced). */
export interface BotMemory {
  clock: number
  armed: boolean
  at: number
  lane: 0 | 1
  lead: number
  hold: [number, number]
}

export const newMemory = (): BotMemory => ({
  clock: 0,
  armed: false,
  at: 0,
  lane: 0,
  lead: 0,
  hold: [0, 0],
})

const FLIP_Y = PIVOT[0][1]
/** The side walls the ball folds between (the first two rails), not the stage edges. */
const LO = (RAILS[0]?.[0] ?? 70) + RAIL_R + BALL_R
const HI = (RAILS[1]?.[0] ?? 930) - RAIL_R - BALL_R
/** A slow ball this close above the flipper line is on (or rolling down) a flipper. */
const DRIBBLE_Y = FLIP_Y - 150
/** How early (s) before arrival the bot starts a swing: the swing itself takes FLIP_TIME. */
const LEAD = FLIP_TIME

/** Ball x `t` seconds ahead, folded back into the table by the side walls. */
export function foldX(x: number, vx: number, t: number): number {
  const span = HI - LO
  let u = x + vx * t - LO
  u = ((u % (2 * span)) + 2 * span) % (2 * span)
  if (u > span) u = 2 * span - u
  return LO + u
}

/** The ball in the bot's own frame: its flippers at the bottom, as red sees them. */
function localBall(w: World, side: Side): { x: number; y: number; vx: number; vy: number } {
  const b = w.ball
  if (side === 0) return { x: b.x, y: b.y, vx: b.vx, vy: b.vy }
  return { x: W - b.x, y: H - b.y, vx: -b.vx, vy: -b.vy }
}

/**
 * Decide which of this side's flippers to hold up. Returns [left, right] for
 * the side's own lanes; the caller maps them to `side * 2 + lane`.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): [boolean, boolean] {
  const tune = TUNING[d]
  mem.clock += dt
  mem.hold[0] = Math.max(0, mem.hold[0] - dt)
  mem.hold[1] = Math.max(0, mem.hold[1] - dt)
  const b = localBall(w, side)
  // A slow ball dribbling onto a flipper never "comes in" fast: flip the one it is on.
  if (b.y > DRIBBLE_Y && b.vy <= 120 && b.vy > -200) {
    const lane: 0 | 1 = b.x < W / 2 ? 0 : 1
    const [px] = PIVOT[lane]
    if (Math.abs(b.x - px) < FLIP_LEN + BALL_R && mem.clock >= mem.at) {
      mem.hold[lane] = tune.hold
      // Re-arm after a short beat so it does not machine-gun the flipper.
      mem.at = mem.clock + tune.hold + tune.react
    }
    return [mem.hold[0] > 0, mem.hold[1] > 0]
  }
  const incoming = b.y > MID && b.vy > 120
  if (!incoming) {
    mem.armed = false
  } else {
    const t = (FLIP_Y - b.y) / b.vy
    if (!mem.armed) {
      mem.armed = true
      mem.at = mem.clock + tune.react * (0.7 + rng.next() * 0.6)
      const px = foldX(b.x, b.vx, Math.max(0, t))
      let lane: 0 | 1 = px < W / 2 ? 0 : 1
      if (rng.next() < tune.miss) lane = lane === 0 ? 1 : 0
      mem.lane = lane
      mem.lead = (rng.next() * 2 - 1) * tune.lead
    }
    // Swing so the flipper is up as the ball arrives, not before.
    if (mem.clock >= mem.at && t <= LEAD + mem.lead && t >= -0.15) {
      mem.hold[mem.lane] = tune.hold
    }
  }
  return [mem.hold[0] > 0, mem.hold[1] > 0]
}
