import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import {
  crossOf,
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
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.7, noise: 150, power: [0.45, 0.65], guess: 0.5, wait: 1.5 },
  normal: { react: 0.45, noise: 60, power: [0.7, 0.9], guess: 0, wait: 1.0 },
  hard: { react: 0.4, noise: 12, power: [0.85, 1], guess: 0, wait: 0.8 },
}

const clampX = (x: number): number => {
  const [lo, hi] = keeperRange()
  return x < lo ? lo : x > hi ? hi : x
}

/** The computer shooter picks the corner away from the keeper, with error by difficulty. */
export function decideShot(w: World, d: Difficulty, rng: Rng): Shot {
  const t = TUNING[d]
  const shooter = w.shooter
  const keeper = keeperOf(shooter)
  const kx = w.keepers[keeper].x
  const line = LINE[keeper]
  const corner = kx < W / 2 ? GOAL.x1 - 46 : GOAL.x0 + 46
  // Easy shooters often just pick any spot in the mouth.
  const base = d === 'easy' ? W / 2 + rng.range(-200, 200) : corner
  const aimX = base + (rng.next() - 0.5) * 2 * t.noise
  const dx = aimX - SPOT[shooter].x
  const dy = line - SPOT[shooter].y
  const m = Math.hypot(dx, dy)
  return {
    dx: dx / m,
    dy: dy / m,
    power: t.power[0] + rng.next() * (t.power[1] - t.power[0]),
    curl: 0,
  }
}

/** Per-keeper memory for one kick (not part of the synced state). */
export interface KeeperMemory {
  /** Seconds since the kick, -1 when no kick is on. */
  t: number
  /** Where the keeper has decided to be. */
  guess: number
  /** Whether it already dived this kick. */
  dived: boolean
}

export const newKeeperMemory = (): KeeperMemory => ({ t: -1, guess: KEEPER_HOME, dived: false })

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
    const read = crossOf(w.ball, LINE[side]) ?? KEEPER_HOME
    mem.guess =
      d === 'easy' && rng.next() < t.guess
        ? clampX(KEEPER_HOME + rng.range(-220, 220))
        : read + (rng.next() - 0.5) * 2 * t.noise
  }
  mem.t += dt
  if (mem.t < t.react) return { x: null, dive: 0 }
  const target = clampX(mem.guess)
  const dx = target - w.keepers[side].x
  const dive = !mem.dived && Math.abs(dx) > 120 ? Math.sign(dx) : 0
  if (dive !== 0) mem.dived = true
  return { x: target, dive }
}
