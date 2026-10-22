import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { halfBox } from '../../engines/puck/index.ts'
import {
  type Ball,
  type Blob,
  BLOB_R,
  COURT,
  fly,
  fwd,
  homeOf,
  landingOf,
  REACH,
  type World,
} from './rules.ts'

interface Tuning {
  /** Blob top speed (units/s). */
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Positioning error on the contact spot (units, ±). */
  error: number
  /** How far the blob stands beside the ball to angle its return away from the rival. */
  aim: number
  /** Chance per approach to wait back and charge the ball: a spike. */
  spike: number
  /** Chance per approach to misjudge the ball, plus per bump of the rally (fatigue). */
  miss: number
  fatigue: number
  /** Extra misjudge chance against a fast ball (a spike), at full pace. */
  rush: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: {
    speed: 650,
    react: 0.45,
    error: 120,
    aim: 0,
    spike: 0,
    miss: 0.1,
    fatigue: 0.025,
    rush: 0.4,
  },
  normal: {
    speed: 900,
    react: 0.25,
    error: 50,
    aim: 35,
    spike: 0.25,
    miss: 0.04,
    fatigue: 0.012,
    rush: 0.22,
  },
  hard: {
    speed: 1250,
    react: 0.12,
    error: 15,
    aim: 60,
    spike: 0.5,
    miss: 0.015,
    fatigue: 0.006,
    rush: 0.1,
  },
}

export interface BotMemory {
  wait: number
  targets: ({ x: number; y: number } | null)[]
  /** The rally hit count the current approach was rolled for. */
  rolled: number
  /** Rolled once per approach: charge this ball. */
  spiking: boolean
  /** Rolled once per approach: misjudge this ball (lands beside the blob). */
  misjudged: number
}

export const newMemory = (): BotMemory => ({
  wait: 0,
  targets: [],
  rolled: -1,
  spiking: false,
  misjudged: 0,
})

/** How far beside the ball a misjudging blob stands (just out of touch). */
const BALL_R_REACH = 140

const mine = (side: Side, y: number): boolean => (side === 0 ? y > MID : y < MID)

/**
 * Fly the ball forward with the real rules and return the first spot where it
 * is comfortably low (well under the reach height), over sand the blob can
 * stand on, and reachable by `blob` in time (or the last such spot when none
 * is). Null when it never comes within reach on this side.
 */
export function intercept(
  w: World,
  side: Side,
  blob: { x: number; y: number },
  speed: number,
  lane?: 0 | 1,
): { x: number; y: number; t: number } | null {
  const b: Ball = { ...w.ball }
  const box = halfBox(side, COURT, BLOB_R, lane)
  let last: { x: number; y: number; t: number } | null = null
  const h = 1 / 60
  for (let t = h; t < 3; t += h) {
    fly(b, h)
    if (b.z <= 0) break
    if (b.z > REACH * 0.6 || b.vz > 0 || !mine(side, b.y)) continue
    if (b.x < box.x0 - 40 || b.x > box.x1 + 40 || b.y < box.y0 - 40 || b.y > box.y1 + 40) continue
    last = { x: b.x, y: b.y, t }
    // Contact only needs the ball to touch the blob's edge.
    const run = Math.max(0, Math.hypot(b.x - blob.x, b.y - blob.y) - BLOB_R * 0.8)
    if (run <= speed * t) return last
  }
  return last
}

/**
 * Where each of `side`'s blobs should stand. When the ball will come down on
 * our sand, the striker runs to the first spot it can meet it in time, a little
 * beside it so the bump angles away from the rival; a spiking bot waits a step
 * back and charges through the ball. Everyone else covers their spot. Indices
 * match `w.blobs`.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): ({ x: number; y: number } | null)[] {
  const tune = TUNING[d]
  mem.wait -= dt
  if (mem.wait > 0 && mem.targets.length === w.blobs.length) return mem.targets
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const b = w.ball
  const land = landingOf(b)
  // Our ball: it comes down on our sand (a serve, a return, or our own short bump).
  const ours = w.phase === 'rally' && !w.dropping && land !== null && mine(side, land.y)
  if (ours && mem.rolled !== w.hits) {
    mem.rolled = w.hits
    mem.spiking = rng.next() < tune.spike
    // A fast, flat ball (a spike) is harder to read; long rallies wear the bot down.
    const pace = Math.max(0, Math.min(1, (Math.hypot(b.vx, b.vy) - 600) / 700))
    const p = tune.miss + w.hits * tune.fatigue + pace * tune.rush
    mem.misjudged = w.last === side || rng.next() >= p ? 0 : rng.chance(0.5) ? 1 : -1
  }
  const mates = w.blobs.filter((x) => x.side === side)
  // In 2 vs 2 the blob on the landing side takes the ball; the other covers its own lane.
  const striker: Blob | undefined =
    mates.length > 1 && land ? mates.find((x) => x.lane === (land.x < W / 2 ? 0 : 1)) : mates[0]
  const rivals = w.blobs.filter((x) => x.side !== side)
  const rivalX = rivals.length ? rivals.reduce((s, r) => s + r.x, 0) / rivals.length : W / 2
  // Send the ball to the side of the court the rival is not covering.
  const aimDir = rivalX < W / 2 ? 1 : -1
  const out = w.blobs.map((bl): { x: number; y: number } | null => {
    if (bl.side !== side) return null
    const home = homeOf(side, bl.lane)
    if (w.phase === 'point') return home
    if (bl === striker && ours) {
      const spot = intercept(w, side, bl, tune.speed, bl.lane) ?? land
      if (spot) {
        const e = tune.error
        const box = halfBox(side, COURT, BLOB_R, bl.lane)
        // Behind the ball (toward our back line) so the bump goes forward.
        const back = -fwd(side)
        const t = 't' in spot ? spot.t : 1
        const charge = mem.spiking && w.last !== side ? (t > 0.2 ? 120 : -70) : 40
        // A misjudged ball: the blob ends up just beside it.
        const off = mem.misjudged * (BLOB_R + BALL_R_REACH)
        const x = spot.x - aimDir * tune.aim + off + (rng.next() * 2 - 1) * e
        const y = spot.y + back * charge + (rng.next() * 2 - 1) * e * 0.5
        return {
          x: Math.max(box.x0, Math.min(box.x1, x)),
          y: Math.max(box.y0, Math.min(box.y1, y)),
        }
      }
    }
    // Waiting: cover our half, leaning toward the ball's side.
    const inMine = mine(side, b.y)
    const sx = bl.lane === undefined ? W / 2 + (b.x - W / 2) * 0.6 : b.x * 0.5 + home.x * 0.5
    return { x: sx, y: inMine ? home.y : home.y + fwd(side) * 40 }
  })
  mem.targets = out
  return out
}
