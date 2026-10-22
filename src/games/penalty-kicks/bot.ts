import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import {
  crossOf,
  crossX,
  GOAL,
  KEEPER_HOME,
  keeperOf,
  keeperRange,
  LINE,
  type Shot,
  SPOT,
  type World,
} from './rules.ts'

interface Tuning {
  /** Seconds the keeper waits after the kick before moving. */
  react: number
  /** Error on the spot aimed at / guessed (world units). */
  noise: number
  /** Power range the shooter picks from. */
  power: [number, number]
  /** Keeper chance to guess a side at random instead of reading the ball. */
  guess: number
  /** Seconds the shooter waits before kicking. */
  wait: number
  /** Chance the shooter bends the ball into its corner (a curled kick is harder to read). */
  curl: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.7, noise: 150, power: [0.45, 0.65], guess: 0.5, wait: 1.5, curl: 0 },
  normal: { react: 0.34, noise: 40, power: [0.72, 0.92], guess: 0, wait: 1.0, curl: 0.25 },
  hard: { react: 0.27, noise: 10, power: [0.88, 1], guess: 0, wait: 0.8, curl: 0.6 },
}

const clampX = (x: number): number => {
  const [lo, hi] = keeperRange()
  return x < lo ? lo : x > hi ? hi : x
}

/**
 * The direction that sends a kick of `power` and `curl` across the goal line at
 * `aimX`, found by flying candidate kicks with the real rules (bisection on the
 * angle: a curled ball does not go where it is pointed).
 */
export function aimAt(shooter: Side, aimX: number, power: number, curl: number): Shot {
  const line = LINE[keeperOf(shooter)]
  const s = SPOT[shooter]
  const fwd = Math.sign(line - s.y)
  const at = (a: number): Shot => ({ dx: Math.sin(a), dy: fwd * Math.cos(a), power, curl })
  // Angle measured from straight at the line, positive toward +x.
  let lo = -1.2
  let hi = 1.2
  const xOf = (a: number): number => crossX(at(a), shooter, line) ?? (a < 0 ? -1e4 : 1e4)
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (xOf(mid) < aimX) lo = mid
    else hi = mid
  }
  return at((lo + hi) / 2)
}

/**
 * The computer shooter picks the corner away from the keeper (easy: any spot
 * in the mouth), aims it exactly with the real flight, and on normal/hard may
 * bend it in from outside the post. Execution error by difficulty.
 */
export function decideShot(w: World, d: Difficulty, rng: Rng): Shot {
  const t = TUNING[d]
  const shooter = w.shooter
  const keeper = keeperOf(shooter)
  const kx = w.keepers[keeper].x
  const right = kx < W / 2
  const corner = right ? GOAL.x1 - 34 : GOAL.x0 + 34
  const base = d === 'easy' ? W / 2 + rng.range(-200, 200) : corner
  const aimX = base + (rng.next() - 0.5) * 2 * t.noise
  const power = t.power[0] + rng.next() * (t.power[1] - t.power[0])
  // Bend toward the middle: the ball starts outside the post and curls in.
  const curl = rng.next() < t.curl ? (right ? -1 : 1) * rng.range(0.5, 1) : 0
  return aimAt(shooter, aimX, power, curl)
}

/** Per-keeper memory for one kick (not part of the synced state). */
export interface KeeperMemory {
  /** Seconds since the kick, -1 when no kick is on. */
  t: number
  /** Where the keeper has decided to be. */
  guess: number
  /** Whether it already dived this kick. */
  dived: boolean
  /** This kick's reaction time (the tuning's, give or take). */
  react: number
}

export const newKeeperMemory = (): KeeperMemory => ({
  t: -1,
  guess: KEEPER_HOME,
  dived: false,
  react: 0,
})

export interface KeeperDecision {
  /** Keeper x to move to, or null to hold. */
  x: number | null
  /** Dive direction this step (-1, 0, 1). */
  dive: number
}

/**
 * The keeper waits a moment after the kick, then reads where the ball will
 * cross the line (easy keepers sometimes guess a side) and dives if it is far.
 */
export function decideKeeper(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: KeeperMemory,
  dt: number,
): KeeperDecision {
  const t = TUNING[d]
  if (w.phase !== 'shot') {
    mem.t = -1
    mem.dived = false
    return { x: KEEPER_HOME, dive: 0 }
  }
  if (mem.t < 0) {
    mem.t = 0
    mem.dived = false
    mem.react = t.react * (0.85 + 0.3 * rng.next())
    const read = crossOf(w.ball, LINE[side]) ?? KEEPER_HOME
    mem.guess =
      d === 'easy' && rng.next() < t.guess
        ? clampX(KEEPER_HOME + rng.range(-220, 220))
        : read + (rng.next() - 0.5) * 2 * t.noise
  }
  mem.t += dt
  if (mem.t < mem.react) return { x: null, dive: 0 }
  const target = clampX(mem.guess)
  const dx = target - w.keepers[side].x
  const dive = !mem.dived && Math.abs(dx) > 120 ? Math.sign(dx) : 0
  if (dive !== 0) mem.dived = true
  return { x: target, dive }
}
