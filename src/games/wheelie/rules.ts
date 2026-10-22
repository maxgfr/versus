import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules for Wheelie, in lane-local units (the lane is 1000 × 900).
 * 10 units = 1 metre. The hills are a function of (seed, run), so both lanes
 * ride the same terrain and nothing about the course travels over the wire.
 */

/** Local x of the rear axle: the bike never moves on screen, the hills do. */
export const BIKE_X = 300
export const WHEEL_R = 46
export const WHEELBASE = 190
/** Local y of the ground at height 0. */
export const BASE_Y = 660
export const RUNS = 2
/** A run that is still going after this long is called on time. */
export const RUN_CAP = 45
/** A run whose front has not left the ground after this long is over (no dead time). */
export const START_CAP = 10
/** Front clearance (units) above which the front counts as "in the air". */
export const CLEAR = 12

const ACCEL = 190
const DRAG = 0.5
/** Gravity along a slope: uphill slows, downhill speeds up. */
const SLOPE_G = 260
const AIR_DRAG = 0.15
/** Vertical pull (units/s²) when the rear wheel is airborne. */
const GRAV = 1500
/** The pitch springs back toward the slope under the rear wheel... */
const STIFF = 5
/** ...and is damped. */
const DAMP = 2.7
/** Nose-up torque per unit of speed while the throttle is held (rad/s²). */
const TORQUE = 0.026
/** Wheelie angle (rad, relative to the ground) at which the bike flips backwards. */
export const FLIP = 1.3

export type Phase = 'run' | 'flipped' | 'dropped' | 'capped'

export interface Bike {
  /** Distance along the course (units). */
  d: number
  v: number
  /** Rear axle clearance above its contact point (≥ 0 on the ground). */
  y: number
  /** Absolute vertical speed of the rear axle (units/s, up positive). */
  vy: number
  /** Body pitch in the world (rad, nose up). */
  phi: number
  /** Pitch rate (rad/s). */
  om: number
  /** Throttle held this step (drives the pitch and the exhaust). */
  thr: boolean
  /** Has the front ever been in the air? Until then, touching down is not a crash. */
  started: boolean
  /** Distance travelled with the front in the air: the run's score (units). */
  wheelie: number
  /** Wheel rotation (rad), for drawing. */
  spin: number
  /** Seconds since the run began. */
  age: number
  end: Phase | null
  /** Game time the run ended (stamped by the game), for the crash animation. */
  endT: number
}

export interface Terrain {
  readonly p: readonly [number, number, number]
}

export type BikeEvent = 'lift' | 'land' | 'flip' | 'dropped' | 'capped'

export function terrainFor(seed: number, run: number): Terrain {
  const tau = Math.PI * 2
  return {
    p: [hash01(seed, run, 21) * tau, hash01(seed, run, 22) * tau, hash01(seed, run, 23) * tau],
  }
}

/** The road roughens from this distance (units) over the next ROUGH_OVER. */
export const ROUGH_FROM = 3000
export const ROUGH_OVER = 9000

/** Ground height (units above the base line) at course distance x. Flat for the first ~60 m. */
export function heightAt(t: Terrain, x: number): number {
  const ramp = Math.min(1, Math.max(0, (x - 60) / 600))
  // The further the ride, the choppier the road: the short bumps grow while the
  // long swells shrink, so the peak height stays the same but the slopes get steeper.
  const k = Math.min(1, Math.max(0, (x - ROUGH_FROM) / ROUGH_OVER))
  const [a, b, c] = t.p
  return (
    ramp *
    ((40 - 10 * k) * Math.sin(x / 300 + a) +
      (22 + 4 * k) * Math.sin(x / 120 + b) +
      (8 + 6 * k) * Math.sin(x / 50 + c))
  )
}

/** Slope of the ground at x (rise over run). */
export function slopeAt(t: Terrain, x: number): number {
  return (heightAt(t, x + 2) - heightAt(t, x - 2)) / 4
}

/** Wheelie angle: how far the body is pitched relative to the ground under the rear wheel. */
export function wheelieAngle(t: Terrain, b: Bike): number {
  return b.phi - slopeAt(t, b.d)
}

export function newBike(): Bike {
  return {
    d: 0,
    v: 0,
    y: 0,
    vy: 0,
    phi: 0,
    om: 0,
    thr: false,
    started: false,
    wheelie: 0,
    spin: 0,
    age: 0,
    end: null,
    endT: -1,
  }
}

/** Front clearance: how high the front wheel is above the ground in front of it (units). */
export function frontClearance(t: Terrain, b: Bike): number {
  return b.y + WHEELBASE * wheelieAngle(t, b)
}

/**
 * One fixed step for one bike. Returns the event that just happened, if any.
 * `now` is the lane's own clock (seconds since the run began).
 */
export function stepBike(b: Bike, t: Terrain, dt: number, thr: boolean): BikeEvent | null {
  if (b.end) return null
  b.thr = thr
  b.age += dt
  let ev: BikeEvent | null = null
  const grounded = b.y <= 0.5
  const s0 = slopeAt(t, b.d)
  const acc = grounded ? (thr ? ACCEL : 0) - DRAG * b.v - SLOPE_G * s0 : -AIR_DRAG * b.v
  b.v = Math.max(0, b.v + acc * dt)
  const d0 = b.d
  b.d += b.v * dt
  b.spin += (b.v * dt) / WHEEL_R
  // The rear wheel follows the ground while it can; past a crest it leaves it.
  if (grounded) b.vy = b.v * s0
  else b.vy -= GRAV * dt
  const h0 = heightAt(t, d0)
  const h1 = heightAt(t, b.d)
  b.y += h0 - h1 + b.vy * dt
  if (b.y <= 0.5) {
    if (!grounded && b.vy < -260) ev = 'land'
    b.y = 0
    b.vy = 0
  }
  // Pitch: throttle lifts the nose, the spring pulls it back to the ground.
  const s1 = slopeAt(t, b.d)
  const torque = thr ? TORQUE * b.v : 0
  b.om += (torque - STIFF * (b.phi - s1) - DAMP * b.om) * dt
  b.phi += b.om * dt
  const c = frontClearance(t, b)
  if (!b.started) {
    if (c < 0) {
      // Nose down on the ground before the first wheelie: rest on it.
      b.phi = s1
      b.om = Math.max(0, b.om)
    } else if (c > CLEAR) {
      b.started = true
      ev = 'lift'
    }
  }
  if (b.started && c > CLEAR) b.wheelie += b.d - d0
  if (b.started && c <= 0) return end(b, 'dropped')
  if (wheelieAngle(t, b) >= FLIP) return end(b, 'flipped')
  if (b.age >= RUN_CAP || (!b.started && b.age >= START_CAP)) return end(b, 'capped')
  return ev
}

function end(b: Bike, why: Phase): BikeEvent {
  b.end = why
  b.om = 0
  return why === 'flipped' ? 'flip' : why === 'dropped' ? 'dropped' : 'capped'
}

/**
 * The match: the best run wins; equal bests go to the higher total over all
 * runs (the steadier rider); equal again is a dead heat.
 */
export function matchWinner(a: readonly number[], b: readonly number[]): 0 | 1 | 'draw' {
  const best = (r: readonly number[]) => Math.max(0, ...r)
  const sum = (r: readonly number[]) => r.reduce((x, y) => x + y, 0)
  if (best(a) !== best(b)) return best(a) > best(b) ? 0 : 1
  if (sum(a) !== sum(b)) return sum(a) > sum(b) ? 0 : 1
  return 'draw'
}

/** Score in whole metres. */
export function metres(units: number): number {
  return Math.floor(units / 10)
}
