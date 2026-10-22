import type { Side } from '../../core/game.ts'
import { H, W } from '../../core/stage.ts'

/**
 * Traffic Jam: a crossroads. Each side launches cars from its own edge along
 * its own street, straight across the middle to the far edge. Three avenues of
 * cross traffic run left-right through the crossing; the schedule is a pure
 * function of the seed, so both players face the very same traffic. Pure
 * logic: no DOM, no canvas, no Math.random.
 */

/** Half-size of a car along its street (width across, length along it). */
export const CAR_W = 72
export const CAR_L = 124
/** Cross cars: length along the avenue, height across it. */
export const CROSS_L = 124
export const CROSS_H = 72
/** Street centre x for each side (red's street is left, blue's right). */
export const ROAD_X: readonly [number, number] = [280, W - 280]
/** Where each side's queue front waits: red at the bottom, blue at the top. */
export const LAUNCH_Y: readonly [number, number] = [1430, H - 1430]
/** Cruise speed of a launched car (world units / s). */
export const SPEED = 430
/** Holding Go is the gas pedal: cars on your street speed up to FAST, at GAS_ACCEL. */
export const FAST = 640
export const GAS_ACCEL = 1500
/** Seconds a crash keeps the side from launching. */
export const STALL = 1
/** Cars per side at the start (more than any match can use). */
export const QUEUE = 40
/** Minimum distance a car must clear before the next one may launch. */
export const GO_GAP = 180
/** A tap made while the lane is blocked is kept this long before it is refused. */
export const BUFFER = 0.35
/** Avenues of cross traffic (centre y), and their direction of travel. */
export const AVENUES: readonly number[] = [700, 900, 1100]
export const AVENUE_DIR: readonly (1 | -1)[] = [1, -1, 1]

/** Overlap half-extents: a car and a cross car collide when both are inside. */
export const COL_BAND = (CAR_W + CROSS_L) / 2
export const LANE_BAND = (CAR_L + CROSS_H) / 2

const PERIOD = 2.2
const JITTER = 0.8
const V_MIN = 300
const V_MAX = 380
/** Ramp: over the first RAMP_CARS cross cars of an avenue the gaps shrink to (1 - RAMP_GAP) and they speed up by RAMP_V. */
const RAMP_CARS = 25
const RAMP_GAP = 0.3
const RAMP_V = 50

/** Deterministic hash of (seed, a, b) → [0, 1). Same on every device. */
export function hash01(seed: number, a: number, b: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35)
  h ^= Math.imul(b + 7, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** A cross car: travels `dir` along its avenue, centre at x(t) from time `t0`. */
export interface Cross {
  lane: number
  t0: number
  v: number
  dir: 1 | -1
}

/** One car of a side's own, on its street. `prog` is the distance covered since launch. */
export interface Car {
  id: number
  y: number
  prog: number
  /** Current speed (SPEED when absent). */
  v?: number
  /** Avenues (bit per avenue) where it already had a close shave. */
  close?: number
}

/** A cross car passing this close to a car (beyond touching) is a close shave. */
export const CLOSE = 70

export interface Racer {
  queue: number
  cars: Car[]
  /** Cars that reached the far edge. */
  across: number
  crashes: number
  /** World time until which launching is blocked. */
  stallUntil: number
  /** A tap waits for a clear lane until this world time (-1 = none). */
  buf: number
  /** World time of the last launch (drives the queue's slide). */
  lastLaunch: number
}

export interface World {
  /** Seeds the cross traffic. */
  seed: number
  /** World seconds. */
  t: number
  /** Next cross car index to spawn, per avenue. */
  next: number[]
  cross: Cross[]
  racers: [Racer, Racer]
  nextId: number
}

export type Ev =
  | { k: 'launch'; side: Side; x: number; y: number }
  | { k: 'across'; side: Side; x: number; y: number }
  | { k: 'crash'; side: Side; x: number; y: number; dir: 1 | -1 }
  | { k: 'refuse'; side: Side; x: number; y: number }
  | { k: 'close'; side: Side; x: number; y: number }

export function newRacer(): Racer {
  return { queue: QUEUE, cars: [], across: 0, crashes: 0, stallUntil: -1, buf: -1, lastLaunch: -9 }
}

export function newWorld(seed: number): World {
  return {
    seed,
    t: 0,
    next: AVENUES.map(() => 0),
    cross: [],
    racers: [newRacer(), newRacer()],
    nextId: 1,
  }
}

/** Spawn time and speed of the k-th cross car on an avenue. Monotonic in k. */
export function crossAt(seed: number, lane: number, k: number): { t0: number; v: number } {
  const h1 = hash01(seed, lane, 2 * k)
  const h2 = hash01(seed, lane, 2 * k + 1)
  // The gaps close up as the match goes on: spacing falls from PERIOD to (1 - RAMP_GAP) PERIOD.
  const r = Math.min(1, k / RAMP_CARS)
  const base = k * PERIOD * (1 - RAMP_GAP * r)
  return {
    t0: 0.8 + base + lane * (PERIOD / 3) + (h1 - 0.5) * JITTER * (1 - 0.4 * r),
    v: V_MIN + (V_MAX - V_MIN) * h2 + RAMP_V * r,
  }
}

/** Centre x of a cross car at time t (it sits just off the edge before it spawns). */
export function crossX(c: Cross, t: number): number {
  const start = c.dir > 0 ? -CROSS_L : W + CROSS_L
  return start + c.dir * c.v * (t - c.t0)
}

/** Time window in which a cross car's centre is close enough to column x to touch a car there. */
export function crossWindow(c: Cross, x: number): [number, number] {
  const start = c.dir > 0 ? -CROSS_L : W + CROSS_L
  const a = (x - COL_BAND - start) / (c.dir * c.v)
  const b = (x + COL_BAND - start) / (c.dir * c.v)
  return c.dir > 0 ? [c.t0 + a, c.t0 + b] : [c.t0 + b, c.t0 + a]
}

/**
 * Time window in which a car launched at `launchT` from `side` overlaps the
 * avenue at `laneY`.
 */
export function carWindow(
  side: Side,
  laneY: number,
  launchT: number,
  speed = SPEED,
): [number, number] {
  const d = side === 0 ? -1 : 1
  const u1 = ((laneY - LANE_BAND - LAUNCH_Y[side]) * d) / speed
  const u2 = ((laneY + LANE_BAND - LAUNCH_Y[side]) * d) / speed
  return u1 < u2 ? [launchT + u1, launchT + u2] : [launchT + u2, launchT + u1]
}

/** Cross cars of an avenue that exist or will spawn by `until` (active first, then scheduled). */
export function crossUpTo(w: World, lane: number, until: number): Cross[] {
  const out: Cross[] = w.cross.filter((c) => c.lane === lane)
  for (let k = w.next[lane] as number; ; k++) {
    const { t0, v } = crossAt(w.seed, lane, k)
    if (t0 > until) break
    out.push({ lane, t0, v, dir: AVENUE_DIR[lane] as 1 | -1 })
  }
  return out
}

/**
 * Would a car launched at `launchT` make it across every avenue? `margin` (s)
 * widens the timing windows; a negative margin accepts near misses (the bot's
 * timing error). `speed` is the speed it crosses at (FAST with the gas held).
 * With `seen`, only cross cars already on the road count, as a player sees
 * them; otherwise the whole schedule does.
 */
export function launchSafe(
  w: World,
  side: Side,
  launchT: number,
  margin = 0.1,
  speed = SPEED,
  seen = false,
): boolean {
  for (let j = 0; j < AVENUES.length; j++) {
    const laneY = AVENUES[j] as number
    const [a, b] = carWindow(side, laneY, launchT, speed)
    const until = b + 0.5
    const traffic = seen ? w.cross.filter((c) => c.lane === j) : crossUpTo(w, j, until)
    for (const c of traffic) {
      const [ca, cb] = crossWindow(c, ROAD_X[side])
      if (ca - margin < b && a < cb + margin) return false
    }
  }
  return true
}

/** Can this side launch a car right now (no stall, queue left, lane clear)? */
export function canLaunch(w: World, side: Side): boolean {
  const r = w.racers[side]
  return r.queue > 0 && w.t >= r.stallUntil && laneClear(r, side)
}

/** Progress of a point along a side's street, measured from its launch point. */
export function progress(side: Side, y: number): number {
  return side === 0 ? LAUNCH_Y[0] - y : y - LAUNCH_Y[1]
}

export function laneClear(r: Racer, side: Side): boolean {
  for (const c of r.cars) if (progress(side, c.y) < GO_GAP) return false
  return true
}

/** The car's far-edge exit has been passed. */
function gone(side: Side, y: number): boolean {
  return side === 0 ? y < -CAR_L / 2 : y > H + CAR_L / 2
}

/** The cross car a car at (x, y) runs into, if any. */
function hits(w: World, x: number, y: number): Cross | null {
  for (const c of w.cross) {
    if (Math.abs(x - crossX(c, w.t)) >= COL_BAND) continue
    if (Math.abs(y - (AVENUES[c.lane] as number)) < LANE_BAND) return c
  }
  return null
}

/**
 * Advance the crossing one step. `presses[side]` is true on the step a Go
 * button went down. Events are appended to `ev`.
 */
export function stepWorld(
  w: World,
  dt: number,
  presses: readonly [boolean, boolean],
  ev: Ev[],
  /** False once the whistle has blown: everything keeps driving, but nothing scores, crashes or launches. */
  racers = true,
  /** Gas pedal per side: while held, that side's cars speed up toward FAST. */
  gas: readonly [boolean, boolean] = [false, false],
): void {
  w.t += dt
  for (let j = 0; j < AVENUES.length; j++) {
    for (;;) {
      const k = w.next[j] as number
      const { t0, v } = crossAt(w.seed, j, k)
      if (t0 > w.t) break
      w.cross.push({ lane: j, t0, v, dir: AVENUE_DIR[j] as 1 | -1 })
      w.next[j] = k + 1
    }
  }
  w.cross = w.cross.filter((c) => {
    const x = crossX(c, w.t)
    return c.dir > 0 ? x < W + CROSS_L : x > -CROSS_L
  })

  for (const side of [0, 1] as Side[]) {
    const r = w.racers[side]
    const d = side === 0 ? -1 : 1
    const x = ROAD_X[side]
    if (presses[side]) r.buf = w.t + BUFFER

    for (const c of r.cars) {
      const want = gas[side] && racers ? FAST : SPEED
      const v0 = c.v ?? SPEED
      const v =
        v0 < want ? Math.min(want, v0 + GAS_ACCEL * dt) : Math.max(want, v0 - GAS_ACCEL * 0.6 * dt)
      c.v = v
      c.y += d * v * dt
      c.prog += v * dt
    }
    if (!racers) {
      r.cars = r.cars.filter((c) => !gone(side, c.y))
      continue
    }
    for (let i = r.cars.length - 1; i >= 0; i--) {
      const car = r.cars[i]
      if (!car) continue
      if (gone(side, car.y)) {
        r.cars.splice(i, 1)
        r.across++
        ev.push({ k: 'across', side, x, y: side === 0 ? 260 : H - 260 })
      } else {
        const hit = hits(w, x, car.y)
        if (!hit) {
          // A cross car just missing it: a close shave, cheered once per avenue.
          for (const c of w.cross) {
            const bit = 1 << c.lane
            if ((car.close ?? 0) & bit) continue
            if (Math.abs(car.y - (AVENUES[c.lane] as number)) >= LANE_BAND) continue
            if (Math.abs(x - crossX(c, w.t)) >= COL_BAND + CLOSE) continue
            car.close = (car.close ?? 0) | bit
            ev.push({ k: 'close', side, x, y: car.y })
          }
          continue
        }
        r.cars.splice(i, 1)
        r.crashes++
        r.stallUntil = w.t + STALL
        ev.push({ k: 'crash', side, x, y: car.y, dir: hit.dir })
      }
    }

    if (r.buf >= 0) {
      if (canLaunch(w, side)) {
        const y = LAUNCH_Y[side]
        r.cars.push({ id: w.nextId++, y, prog: 0, v: SPEED })
        r.queue--
        r.lastLaunch = w.t
        r.buf = -1
        ev.push({ k: 'launch', side, x, y })
      } else if (w.t >= r.buf) {
        r.buf = -1
        ev.push({ k: 'refuse', side, x, y: LAUNCH_Y[side] })
      }
    }
  }
}

/** Winner by cars across: the side with more; equal counts draw. */
export function winnerOf(w: World): Side | 'draw' {
  const [a, b] = [w.racers[0].across, w.racers[1].across]
  if (a === b) return 'draw'
  return a > b ? 0 : 1
}
