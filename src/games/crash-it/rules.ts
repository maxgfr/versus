import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules for Crash It, in lane-local units (the lane is 1000 × 900).
 * 10 units = 1 metre. The course is a function of (seed, index), so both
 * trucks run the same road and the course never travels over the wire.
 */

/** Screen x of the truck's centre: the road scrolls past it. */
export const TRUCK_X = 300
/** Front bumper from the centre. */
export const TRUCK_HALF = 120
/** Wheel centres from the truck's centre, and their radius. */
export const WHEEL_DX = 84
export const WHEEL_R = 44
/** Local y of the road surface. */
export const ROAD_Y = 650
export const WALL_H = 260
export const FINISH = 11000

export const CRUISE = 440
/** Speed a truck needs to smash a wall. Only boost gets there. */
export const WALL_V = 580
export const BOOST_V = 760
const ACCEL = 200
const DECEL = 260
const BOOST_ACC = 520
export const BOOST_MAX = 100
const BOOST_DRAIN = 32
const BOOST_REFILL = 18
export const JUMP_V = 760
const GRAV = 1600
/** Seconds in the air for a full jump. */
export const AIRTIME = (2 * JUMP_V) / GRAV
export const BUMP_T = 0.9
export const RISE_T = 0.9
export const FALL_DEPTH = 240

export type Kind = 'gap' | 'wall'
export interface Obstacle {
  /** Centre-x where it starts. A gap spans [x, x + len]; a wall stands at x. */
  x: number
  kind: Kind
  len: number
}

export function obstacleAt(seed: number, i: number): Obstacle {
  const x = 900 + i * 600 + Math.floor(hash01(seed, i, 1) * 160)
  const kind: Kind = hash01(seed, i, 2) < 0.5 ? 'gap' : 'wall'
  return { x, kind, len: kind === 'gap' ? 170 + Math.floor(hash01(seed, i, 3) * 90) : 0 }
}

export type TState = 'run' | 'bump' | 'fall' | 'rise'

export interface Truck {
  /** Distance along the road (units). */
  x: number
  v: number
  /** Height above the road (≥ 0, negative in a pit). */
  y: number
  vy: number
  boost: number
  boosting: boolean
  state: TState
  timer: number
  /** Bump slide: from and to x. */
  from: number
  to: number
  /** Index of the next obstacle. */
  k: number
  smashed: number
  finished: boolean
}

export type TruckEvent = 'jump' | 'smash' | 'bump' | 'fall' | 'finish'

export function newTruck(): Truck {
  return {
    x: 0,
    v: 0,
    y: 0,
    vy: 0,
    boost: BOOST_MAX,
    boosting: false,
    state: 'run',
    timer: 0,
    from: 0,
    to: 0,
    k: 0,
    smashed: 0,
    finished: false,
  }
}

function approach(v: number, target: number, rate: number): number {
  if (v < target) return Math.min(target, v + rate)
  return Math.max(target, v - rate)
}

/** Distance (units) ahead of the front bumper to the next wall, or Infinity. */
export function wallAhead(seed: number, t: Truck): number {
  const o = obstacleAt(seed, t.k)
  return o.kind === 'wall' ? o.x - (t.x + TRUCK_HALF) : Infinity
}

/**
 * One fixed step. `press` is a fresh tap (jump), `hold` is a finger on the
 * screen (boost while the meter lasts). Returns what just happened.
 */
export function stepTruck(
  t: Truck,
  seed: number,
  dt: number,
  press: boolean,
  hold: boolean,
): TruckEvent | null {
  if (t.finished) return null
  if (t.state === 'bump') {
    t.timer -= dt
    const p = 1 - Math.max(0, t.timer) / BUMP_T
    t.x = t.from + (t.to - t.from) * (p * p * (3 - 2 * p))
    t.v = 0
    t.boosting = false
    t.boost = Math.min(BOOST_MAX, t.boost + BOOST_REFILL * dt)
    if (t.timer <= 0) {
      t.state = 'run'
      t.x = t.to
    }
    return null
  }
  if (t.state === 'fall') {
    t.vy -= GRAV * dt
    t.y += t.vy * dt
    if (t.y <= -FALL_DEPTH) {
      // Climb back out on the near side of the pit.
      t.state = 'rise'
      t.timer = RISE_T
      t.x = obstacleAt(seed, t.k).x - 220
      t.y = -FALL_DEPTH
      t.vy = 0
      t.v = 0
    }
    t.boosting = false
    return null
  }
  if (t.state === 'rise') {
    t.timer -= dt
    t.y = (-FALL_DEPTH * Math.max(0, t.timer)) / RISE_T
    if (t.timer <= 0) {
      t.state = 'run'
      t.y = 0
    }
    return null
  }

  let ev: TruckEvent | null = null
  const grounded = t.y <= 0 && t.vy <= 0
  if (press && grounded) {
    t.vy = JUMP_V
    ev = 'jump'
  }
  const canBoost = hold && t.boost > 0
  t.boosting = canBoost
  t.boost = Math.max(
    0,
    Math.min(BOOST_MAX, t.boost + (canBoost ? -BOOST_DRAIN : BOOST_REFILL) * dt),
  )
  if (canBoost) t.v = approach(t.v, BOOST_V, BOOST_ACC * dt)
  else if (grounded) t.v = approach(t.v, CRUISE, (t.v < CRUISE ? ACCEL : DECEL) * dt)
  t.x += t.v * dt

  if (t.y > 0 || t.vy > 0) {
    t.vy -= GRAV * dt
    t.y += t.vy * dt
    if (t.y <= 0 && t.vy <= 0) {
      t.y = 0
      t.vy = 0
    }
  }

  // Obstacles, in order.
  const o = obstacleAt(seed, t.k)
  if (o.kind === 'gap') {
    if (t.x >= o.x && t.x < o.x + o.len && t.y <= 0) {
      t.state = 'fall'
      t.vy = 0
      return 'fall'
    }
    if (t.x >= o.x + o.len) t.k++
  } else if (t.x + TRUCK_HALF >= o.x) {
    if (t.v >= WALL_V) {
      t.k++
      t.smashed++
      t.v *= 0.9
      ev = 'smash'
    } else {
      t.state = 'bump'
      t.timer = BUMP_T
      t.from = o.x - TRUCK_HALF
      t.x = t.from
      // Back up far enough to build the speed for a second try.
      t.to = t.from - 420
      t.v = 0
      t.boosting = false
      return 'bump'
    }
  }

  if (t.x >= FINISH) {
    t.finished = true
    return 'finish'
  }
  return ev
}

/** Metres covered, for the score line. */
export function metres(units: number): number {
  return Math.floor(units / 10)
}
