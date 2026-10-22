import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import {
  type Ball,
  bandOf,
  fly,
  homeOf,
  REACH,
  rebound,
  serveY,
  strikable,
  type Target,
  type World,
} from './rules.ts'

interface Tuning {
  /** Blob run speed (units/s). */
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Error on the spot it runs to (world units). */
  noise: number
  /** Chance that a return is deliberately mistimed. */
  miss: number
  /** Extra miss chance per stroke of the rally: long rallies wear the bot down. */
  fatigue: number
  /**
   * Chance per approach to drive the return: wait behind the ball's line, then
   * run through it at contact (flatter, quicker, deeper).
   */
  drive: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { speed: 720, react: 0.28, noise: 90, miss: 0.15, fatigue: 0.02, drive: 0 },
  normal: { speed: 1150, react: 0.1, noise: 22, miss: 0.035, fatigue: 0.009, drive: 0.45 },
  hard: { speed: 1320, react: 0.04, noise: 6, miss: 0.008, fatigue: 0.004, drive: 0.75 },
}

/** Per-bot memory carried between steps (not part of the synced state). */
export interface BotMemory {
  wait: number
  target: Target
  serveIn: number
  armed: boolean
  /** Whether the ball is currently coming toward this side (set per approach). */
  incoming: boolean
  /** Rolled once per approach: this return is mistimed. */
  mistimed: boolean
  /** Rolled once per approach: this return is driven. */
  driving: boolean
}

export const newMemory = (): BotMemory => ({
  wait: 0,
  target: null,
  serveIn: 0,
  armed: false,
  incoming: false,
  mistimed: false,
  driving: false,
})

export interface Decision {
  target: Target
  serve: boolean
}

/**
 * Fly the ball forward with the real rules (one bounce on `side`'s court, then
 * low and coming at it) and return the first moment it is strikable from a spot
 * the blob can run to in time, with that spot's ball position. Null when the
 * ball will not be playable on this side (it dies on the other half).
 */
export function intercept(
  w: World,
  side: Side,
  speed: number,
  offset: number,
): { x: number; y: number; t: number } | null {
  if (w.hitter === side) return null
  const b: Ball = { ...w.ball }
  const p = w.blobs[side]
  const band = bandOf(side)
  let bounces = w.bounces
  let last: { x: number; y: number; t: number } | null = null
  const h = 1 / 60
  for (let t = h; t < 2.5; t += h) {
    fly(b, h)
    if (b.z <= 0 && b.vz < 0) {
      const on: Side = b.y < MID ? 1 : 0
      if (on !== side || bounces >= 1) break
      bounces++
      rebound(b)
    }
    if (!strikable(bounces, b, side)) continue
    const x = Math.max(band.x0, Math.min(band.x1, b.x - offset))
    const y = Math.max(band.y0, Math.min(band.y1, b.y))
    // The ball only has to come within reach of the racket, not to the blob.
    const run = Math.max(0, Math.hypot(x - p.x, y - p.y) - REACH * 0.35)
    last = { x, y, t }
    if (run <= speed * t) return last
  }
  return last
}

/**
 * The bot reads the ball's whole flight (bounce included) and runs to the first
 * spot where it can meet it in time, offset so the racket sends the return away
 * from its rival. A mistimed return goes to the wrong side of the court.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Decision {
  const tune = TUNING[d]
  if (w.phase === 'serve' && w.server === side) {
    if (!mem.armed) {
      mem.armed = true
      mem.serveIn = tune.react * (2 + rng.next())
    }
    mem.serveIn -= dt
    return { target: { x: W / 2, y: serveY(side) }, serve: mem.serveIn <= 0 }
  }
  mem.armed = false
  mem.wait -= dt
  if (mem.wait > 0 && mem.target) return { target: mem.target, serve: false }
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const home = homeOf(side)
  const b = w.ball
  const incoming = side === 0 ? b.vy > 0 : b.vy < 0
  if (incoming && !mem.incoming) {
    mem.mistimed = rng.next() < tune.miss + w.rally * tune.fatigue
    mem.driving = rng.next() < tune.drive
  }
  mem.incoming = incoming
  if (w.phase !== 'play') {
    mem.target = home
    return { target: mem.target, serve: false }
  }
  if (!incoming) {
    mem.target = { x: W / 2 + (b.x - W / 2) * 0.35, y: home.y }
    return { target: mem.target, serve: false }
  }
  // Aim the return at the side of the court away from the rival.
  const rival = w.blobs[other(side)]
  const u = Math.max(-1, Math.min(1, -(rival.x - W / 2) / 340 + (rng.next() - 0.5) * 0.4))
  const spot = intercept(w, side, tune.speed, u * REACH * 0.8)
  if (!spot) {
    mem.target = home
    return { target: mem.target, serve: false }
  }
  let x = spot.x + (rng.next() - 0.5) * 2 * tune.noise
  if (mem.mistimed) {
    // Mistimed: run to the far side of the court, out of reach of the ball.
    const band = bandOf(side)
    x = b.x < W / 2 ? band.x1 : band.x0
  }
  // A driven return: wait a step behind the ball's line, then run through it.
  const back = side === 0 ? 1 : -1
  const run = mem.driving ? (spot.t > 0.28 ? 120 : -160) : 0
  mem.target = { x, y: spot.y + back * run }
  return { target: mem.target, serve: false }
}
