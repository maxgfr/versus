import type { Side } from '../../core/game.ts'

/**
 * Road Dodge: each player drives up their own road in their half. Oncoming
 * traffic comes down the road toward them; drag left and right to dodge. Three
 * crashes and you are out. Positions are kept in red's frame (red's road at the
 * bottom of the world, y grows toward red's edge); blue's frame is the same
 * layout turned 180°. Pure logic: no DOM, no canvas, no Math.random.
 */

export const ROAD_L = 125
export const ROAD_R = 875
export const LANE_X: readonly number[] = [250, 500, 750]
/** Local y of every car on its road (near its owner's edge). */
export const CAR_Y = 1560
/** The horizon: the middle of the table, where oncoming traffic appears. */
export const HORIZON = 900
export const CAR_HW = 46
export const CAR_HH = 84
/** Lateral speed of a car following the finger / bot (units/s). */
export const LATERAL = 1000
export const LIVES = 3
/** Seconds of blinking invulnerability after a crash. */
export const INVULN = 1.2

const V0 = 470
const RAMP = 14
const VMAX = 900

/** Speed of oncoming traffic (units/s) at round time `rt`: ramps up, capped. */
export function speedAt(rt: number): number {
  return Math.min(VMAX, V0 + RAMP * rt)
}

/** Road covered by round time `rt` (the integral of `speedAt`): drives the scrolling scenery. */
export function distAt(rt: number): number {
  const tc = (VMAX - V0) / RAMP
  if (rt <= tc) return V0 * rt + (RAMP / 2) * rt * rt
  return V0 * tc + (RAMP / 2) * tc * tc + VMAX * (rt - tc)
}

/** Deterministic hash of (seed, a, b) → [0, 1). */
export function hash01(seed: number, a: number, b: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35)
  h ^= Math.imul(b + 7, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** Seconds between two oncoming cars at round time `rt` (the k-th gap of the round). */
export function gapAt(seed: number, k: number, rt: number): number {
  const jitter = 0.8 + 0.4 * hash01(seed, k, 2)
  return Math.max(0.46, 0.95 - 0.008 * rt) * jitter
}

/** An oncoming car. `near` is set once it has slipped past a driver closely. */
export interface Obs {
  id: number
  lane: number
  y: number
  near: boolean
}

export interface Driver {
  /** Lateral position (local x) and the position it is steering toward. */
  x: number
  tx: number
  lives: number
  /** Invulnerable until this round time (after a crash). */
  invT: number
  /** Round time of the last crash (-9 = never). */
  hitT: number
  out: boolean
}

export interface World {
  /** Seeds the traffic of this round. Both roads get the very same cars. */
  seed: number
  /** Seconds since the round began. */
  rt: number
  /** Index of the next oncoming car, and the round time it appears at. */
  k: number
  nextAt: number
  /** Oncoming cars on each driver's road (local coordinates). */
  obs: [Obs[], Obs[]]
  drivers: [Driver, Driver]
  nextId: number
}

export type Ev =
  | { k: 'hit'; side: Side; x: number; y: number; ox: number; oy: number; id: number }
  | { k: 'near'; side: Side; x: number; y: number }
  | { k: 'out'; side: Side; x: number; y: number }

export function newDriver(): Driver {
  const x = LANE_X[1] as number
  return { x, tx: x, lives: LIVES, invT: -1, hitT: -9, out: false }
}

export function newWorld(seed: number): World {
  return {
    seed,
    rt: 0,
    k: 0,
    nextAt: 1.2,
    obs: [[], []],
    drivers: [newDriver(), newDriver()],
    nextId: 1,
  }
}

/** Lane of the k-th oncoming car: a seeded pick. */
export function laneOf(seed: number, k: number): number {
  return Math.floor(hash01(seed, k, 1) * LANE_X.length)
}

/** Put the next oncoming car on both roads. */
function spawn(w: World): void {
  const lane = laneOf(w.seed, w.k)
  for (const side of [0, 1] as Side[]) {
    w.obs[side].push({ id: w.nextId, lane, y: HORIZON - 100, near: false })
  }
  w.nextId++
  w.k++
  w.nextAt += gapAt(w.seed, w.k, w.rt)
}

/** Do a car and an oncoming car overlap? (slightly forgiving box) */
function overlaps(d: Driver, o: Obs): boolean {
  const dx = Math.abs(d.x - (LANE_X[o.lane] as number))
  const dy = Math.abs(CAR_Y - o.y)
  return dx < CAR_HW * 2 - 8 && dy < CAR_HH * 2 - 12
}

/**
 * Advance the round one step. `steer[side]` is the local x the side's driver
 * wants (null = hold). Events are appended to `ev`.
 */
export function stepWorld(
  w: World,
  dt: number,
  steer: readonly [number | null, number | null],
  ev: Ev[],
  /** False once the match is decided: traffic keeps rolling but no longer hits anyone. */
  collide = true,
): void {
  w.rt += dt
  while (w.rt >= w.nextAt) spawn(w)
  const v = speedAt(w.rt)
  for (const side of [0, 1] as Side[]) {
    const d = w.drivers[side]
    if (d.out) continue
    const want = steer[side]
    if (want !== null) d.tx = Math.max(ROAD_L + CAR_HW, Math.min(ROAD_R - CAR_HW, want))
    const dx = d.tx - d.x
    const step = LATERAL * dt
    d.x += Math.max(-step, Math.min(step, dx))

    const list = w.obs[side]
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i]
      if (!o) continue
      o.y += v * dt
      if (o.y > CAR_Y + 260) {
        list.splice(i, 1)
        continue
      }
      if (!collide) continue
      // Once past the car without touching it, a close pass counts as a near miss.
      if (!o.near && o.y - CAR_Y > CAR_HH * 2 - 12) {
        o.near = true
        if (Math.abs(d.x - (LANE_X[o.lane] as number)) < CAR_HW * 2 + 36)
          ev.push({ k: 'near', side, x: d.x, y: CAR_Y })
      }
      if (w.rt >= d.invT && overlaps(d, o)) {
        list.splice(i, 1)
        d.lives--
        d.invT = w.rt + INVULN
        d.hitT = w.rt
        ev.push({
          k: 'hit',
          side,
          x: d.x,
          y: CAR_Y,
          ox: LANE_X[o.lane] as number,
          oy: o.y,
          id: o.id,
        })
        if (d.lives <= 0) {
          d.out = true
          ev.push({ k: 'out', side, x: d.x, y: CAR_Y })
          break
        }
      }
    }
  }
}

/** The round is decided once someone is out: the other driver wins, both out is a draw. */
export function roundOver(w: World): Side | 'draw' | null {
  const [a, b] = w.drivers
  if (!a.out && !b.out) return null
  if (a.out && b.out) return 'draw'
  return a.out ? 1 : 0
}
