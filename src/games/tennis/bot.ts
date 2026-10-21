import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { bandOf, COURT, homeOf, REACH, serveY, type Target, timeTo, type World } from './rules.ts'

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
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { speed: 760, react: 0.24, noise: 80, miss: 0.14, fatigue: 0.02 },
  normal: { speed: 1050, react: 0.12, noise: 30, miss: 0.05, fatigue: 0.012 },
  hard: { speed: 1320, react: 0.05, noise: 8, miss: 0.015, fatigue: 0.007 },
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
}

export const newMemory = (): BotMemory => ({
  wait: 0,
  target: null,
  serveIn: 0,
  armed: false,
  incoming: false,
  mistimed: false,
})

export interface Decision {
  target: Target
  serve: boolean
}

/** The bot waits for the bounce: it stands where the ball lands. */
const HIT_LEVEL = 0

/**
 * The bot runs to the ground spot where the ball will be low enough to hit,
 * then places the blob so the racket offset sends the return away from the
 * human. A mistimed return is planted just beside the ball.
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
  if (incoming && !mem.incoming) mem.mistimed = rng.next() < tune.miss + w.rally * tune.fatigue
  mem.incoming = incoming
  if (w.phase !== 'play') {
    mem.target = home
    return { target: mem.target, serve: false }
  }
  if (!incoming) {
    mem.target = { x: W / 2 + (b.x - W / 2) * 0.35, y: home.y }
    return { target: mem.target, serve: false }
  }
  const t = timeTo(b.z, b.vz, HIT_LEVEL)
  const gx = Math.max(COURT.x0, Math.min(COURT.x1, b.x + b.vx * t))
  const gy = b.y + b.vy * t
  const mine = side === 0 ? gy > MID : gy < MID
  if (!mine) {
    mem.target = home
    return { target: mem.target, serve: false }
  }
  // Aim the return at the side of the court away from the human.
  const rival = w.blobs[other(side)]
  const u = Math.max(-1, Math.min(1, -(rival.x - W / 2) / 340 + (rng.next() - 0.5) * 0.4))
  let x = gx - u * REACH + (rng.next() - 0.5) * 2 * tune.noise
  if (mem.mistimed) {
    // Mistimed: run to the far side of the court, out of reach of the ball.
    const band = bandOf(side)
    x = gx < W / 2 ? band.x1 : band.x0
  }
  mem.target = { x, y: gy }
  return { target: mem.target, serve: false }
}
