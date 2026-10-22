import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID } from '../../core/stage.ts'
import {
  BALL_R,
  type Ball,
  BAND_Y,
  BUMP_VZ,
  CLAW_Y,
  COURT,
  CRAB_R,
  G,
  HOP_H,
  HOP_T,
  landingOf,
  REACH,
  span,
  STEER,
  type World,
} from './rules.ts'

interface Tuning {
  /** Scuttle speed (units/s): how fast the crabs get across the band. */
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Positioning error on the contact spot (units, ±). */
  error: number
  /** 0..1: how much of the ideal sideways aim (away from the rival) the bot takes. */
  aim: number
  /** Chance per approach to hop and spike a ball it could also just bump. */
  spike: number
  /** Chance per approach to misjudge the ball, plus per bump of the rally (fatigue). */
  miss: number
  fatigue: number
  /** Extra misjudge chance against a spike (a short, flat ball). */
  rush: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: {
    speed: 300,
    react: 0.4,
    error: 90,
    aim: 0,
    spike: 0,
    miss: 0.1,
    fatigue: 0.02,
    rush: 0.45,
  },
  normal: {
    speed: 470,
    react: 0.2,
    error: 40,
    aim: 0.6,
    spike: 0.2,
    miss: 0.04,
    fatigue: 0.01,
    rush: 0.25,
  },
  hard: {
    speed: 640,
    react: 0.08,
    error: 12,
    aim: 1,
    spike: 0.4,
    miss: 0.012,
    fatigue: 0.005,
    rush: 0.1,
  },
}

export interface BotMemory {
  wait: number
  x: (number | null)[]
  hop: boolean[]
  /** The rally hit count the current approach was rolled for. */
  rolled: number
  spiking: boolean
  /** -1 / 1: this ball is misjudged and the crab ends up beside it; 0 otherwise. */
  misjudged: number
  /**
   * Chosen once per approach so the crab does not dither: which side of the
   * rival's court to aim at (1 = right), and this approach's positioning error.
   */
  aimSide: number
  error: number
}

export const newMemory = (): BotMemory => ({
  wait: 0,
  x: [],
  hop: [],
  rolled: -1,
  spiking: false,
  misjudged: 0,
  aimSide: 1,
  error: 0,
})

export interface Plan {
  x: (number | null)[]
  hop: boolean[]
}

const mine = (side: Side, y: number): boolean => (side === 0 ? y > MID : y < MID)

/**
 * Fly the ball forward and return the first moment it can be touched from
 * `side`'s band by a crab reaching `reach` high: descending, low enough, and
 * over the claws. Null if it never is (it dies elsewhere first).
 */
export function contactOf(b: Ball, side: Side, reach: number): { x: number; t: number } | null {
  const h = 1 / 120
  let { x, y, z, vz } = b
  for (let t = h; t < 3; t += h) {
    vz -= G * h
    x += b.vx * h
    y += b.vy * h
    z += vz * h
    if (z <= 0) return null
    if (vz < 0 && z <= reach && Math.abs(y - BAND_Y[side]) < CLAW_Y * 0.85) return { x, t }
  }
  return null
}

/**
 * What `side`'s crabs do. The striker reads the flight and scuttles to where
 * the ball comes within its claws, standing beside it so the bump angles away
 * from the rival (and inside the lines). A ball that only a hop can reach (a
 * spike) gets a hop timed to peak at contact; a spiking bot hops at balls it
 * could also just bump. Others return to the middle of their span. Indices
 * match `w.crabs`.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Plan {
  const tune = TUNING[d]
  mem.wait -= dt
  const b = w.ball
  const land = landingOf(b)
  // Our ball: it comes down on our sand (a serve, a return, or our own short bump).
  const ours = w.phase === 'rally' && land !== null && mine(side, land.y)
  const ground = ours ? contactOf(b, side, REACH) : null
  const high = ours ? contactOf(b, side, REACH + HOP_H * 0.85) : null
  // Hops are timed every step (not only on decisions): a hop must start on time.
  const hopNow = (c: { x: number; hop: number }): boolean => {
    if (!ours || c.hop >= 0 || mem.misjudged !== 0) return false
    const spot = ground && !mem.spiking ? null : (high ?? null)
    if (!spot) return false
    return Math.abs(spot.x - c.x) < CRAB_R + BALL_R - 20 && spot.t <= HOP_T * 0.5
  }
  if (mem.wait > 0 && mem.x.length === w.crabs.length)
    return { x: mem.x, hop: w.crabs.map((c) => c.side === side && hopNow(c)) }
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  if (ours && mem.rolled !== w.hits) {
    mem.rolled = w.hits
    mem.spiking = rng.next() < tune.spike
    const short = ground === null ? 1 : 0
    const p = tune.miss + w.hits * tune.fatigue + short * tune.rush
    mem.misjudged = rng.next() < p ? (rng.chance(0.5) ? 1 : -1) : 0
    const rivals = w.crabs.filter((c) => c.side !== side)
    const rivalX = rivals.length ? rivals.reduce((s, r) => s + r.x, 0) / rivals.length : 500
    mem.aimSide = rivalX < 500 ? 1 : -1
    mem.error = (rng.next() * 2 - 1) * tune.error
  }
  const mates = w.crabs.filter((c) => c.side === side)
  const striker =
    mates.length > 1 && land ? mates.find((c) => c.lane === (land.x < 500 ? 0 : 1)) : mates[0]
  const x: (number | null)[] = []
  const hop: boolean[] = []
  for (const c of w.crabs) {
    if (c.side !== side) {
      x.push(null)
      hop.push(false)
      continue
    }
    const sp = span(c.lane)
    const home = (sp.x0 + sp.x1) / 2
    // Out of the claws' reach entirely: still run under where it lands.
    const spot = ground ?? high ?? land
    if (!ours || !spot || c !== striker) {
      x.push(w.phase === 'point' || !ours ? home : c.x)
      hop.push(false)
      continue
    }
    // Aim: land the return on the side of the rival's band they are not covering.
    const lo = COURT.x0 + BALL_R + 90
    const hi = COURT.x1 - BALL_R - 90
    const goal = mem.aimSide > 0 ? hi - (hi - 500) * 0.3 : lo + (500 - lo) * 0.3
    const flight = (2 * BUMP_VZ) / G
    const want = ((goal - spot.x) / flight) * tune.aim
    const reach = CRAB_R + BALL_R - 34
    const dx = Math.max(-reach, Math.min(reach, want / STEER))
    let tx = spot.x - dx + mem.error
    // A misjudged ball: the crab ends up just beside it.
    if (mem.misjudged !== 0) tx = spot.x + mem.misjudged * (CRAB_R + BALL_R + 30)
    x.push(Math.max(sp.x0, Math.min(sp.x1, tx)))
    hop.push(hopNow(c))
  }
  mem.x = x
  mem.hop = hop
  return { x, hop }
}
