import type { Difficulty, Side } from '../../core/game.ts'

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
/** Default lateral speed of a car following its wanted x (units/s). */
export const LATERAL = 1000
/** A human's car follows the finger nearly at its own speed: a flick is a swerve. */
export const HUMAN_LATERAL = 2600
export const LIVES = 3
/** Seconds of blinking invulnerability after a crash. */
export const INVULN = 1.2

const V0 = 470
const RAMP = 14
const VMAX = 900
/** Past this round time the road keeps getting faster, slowly, so no round runs forever. */
export const OVERTIME = 45
const OVER_RAMP = 16
export const VTOP = 1600

/**
 * Speed of oncoming traffic (units/s) at round time `rt`: ramps up, then creeps
 * on in overtime. The whole curve is scaled by the match tempo.
 */
export function speedAt(rt: number, tempo = 1): number {
  const v = Math.min(VTOP, Math.min(VMAX, V0 + RAMP * rt) + Math.max(0, rt - OVERTIME) * OVER_RAMP)
  return v * tempo
}

/**
 * Against the computer its level also sets the pace: the traffic comes down
 * the road faster (hard) or slower (easy). Local 2P and online play at 1.
 */
export const TEMPO: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.28 }

/** The tempo of a match, fixed once at setup. */
export function tempoOf(d: Difficulty, bots: readonly boolean[]): number {
  return bots.some(Boolean) ? TEMPO[d] : 1
}

/** Chance that a car comes as a two-car row (one lane left open), rising over the round. */
export function doubleChance(rt: number): number {
  return Math.max(0, Math.min(0.35, (rt - 18) / 90))
}
/** A two-car row never comes sooner than this after the car before it, nor the next one after it. */
export const ROW_GAP = 0.8

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
  // Overtime packs the traffic tighter too.
  const squeeze = 1 - Math.min(0.3, Math.max(0, rt - OVERTIME) / 150)
  return Math.max(0.46, 0.95 - 0.008 * rt) * jitter * squeeze
}

/** An oncoming car. `near` is set once it has slipped past a driver closely. */
export interface Obs {
  id: number
  lane: number
  y: number
  near: boolean
}

/** Half-width (x) and half-length (y) of the overlap box between two cars. */
export const OVER_X = CAR_HW * 2 - 8
export const OVER_Y = CAR_HH * 2 - 12

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
  /** The next car comes as a two-car row. */
  dbl: boolean
  /** Road covered so far (drives the scrolling scenery). */
  dist: number
  /** Oncoming cars on each driver's road (local coordinates). */
  obs: [Obs[], Obs[]]
  drivers: [Driver, Driver]
  nextId: number
  /** Traffic speed multiplier (1 = normal), fixed for the match. */
  tempo: number
}

export type Ev =
  | { k: 'hit'; side: Side; x: number; y: number; ox: number; oy: number; id: number }
  | { k: 'near'; side: Side; x: number; y: number; gap: number }
  | { k: 'out'; side: Side; x: number; y: number }

export function newDriver(): Driver {
  const x = LANE_X[1] as number
  return { x, tx: x, lives: LIVES, invT: -1, hitT: -9, out: false }
}

export function newWorld(seed: number, tempo = 1): World {
  return {
    seed,
    rt: 0,
    k: 0,
    nextAt: 1.2,
    dbl: false,
    dist: 0,
    obs: [[], []],
    drivers: [newDriver(), newDriver()],
    nextId: 1,
    tempo,
  }
}

/** Lane of the k-th oncoming car: a seeded pick. */
export function laneOf(seed: number, k: number): number {
  return Math.floor(hash01(seed, k, 1) * LANE_X.length)
}

/** The other lane of a two-car row whose first car is in `lane`. */
export function secondLane(seed: number, k: number, lane: number): number {
  return (lane + 1 + Math.floor(hash01(seed, k, 4) * 2)) % LANE_X.length
}

/**
 * Put the next oncoming car (or two-car row) on both roads. A row always
 * leaves one lane open and gets room on both sides to reach it.
 */
function spawn(w: World): void {
  const lane = laneOf(w.seed, w.k)
  const lanes = w.dbl ? [lane, secondLane(w.seed, w.k, lane)] : [lane]
  for (const l of lanes) {
    for (const side of [0, 1] as Side[]) {
      w.obs[side].push({ id: w.nextId, lane: l, y: HORIZON - 100, near: false })
    }
    w.nextId++
  }
  const wasRow = w.dbl
  w.k++
  w.dbl = hash01(w.seed, w.k, 3) < doubleChance(w.rt)
  const gap = gapAt(w.seed, w.k, w.rt)
  w.nextAt += wasRow || w.dbl ? Math.max(ROW_GAP, gap) : gap
}

/** Do a car and an oncoming car overlap? (slightly forgiving box) */
function overlaps(d: Driver, o: Obs): boolean {
  const dx = Math.abs(d.x - (LANE_X[o.lane] as number))
  const dy = Math.abs(CAR_Y - o.y)
  return dx < OVER_X && dy < OVER_Y
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
  /** Each driver's lateral speed (units/s). */
  lateral: readonly [number, number] = [LATERAL, LATERAL],
): void {
  w.rt += dt
  while (w.rt >= w.nextAt) spawn(w)
  const v = speedAt(w.rt, w.tempo)
  w.dist += v * dt
  for (const side of [0, 1] as Side[]) {
    const d = w.drivers[side]
    if (d.out) continue
    const want = steer[side]
    if (want !== null) d.tx = Math.max(ROAD_L + CAR_HW, Math.min(ROAD_R - CAR_HW, want))
    const dx = d.tx - d.x
    const step = lateral[side] * dt
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
      if (!o.near && o.y - CAR_Y > OVER_Y) {
        o.near = true
        const gap = Math.abs(d.x - (LANE_X[o.lane] as number)) - OVER_X
        if (gap < 44) ev.push({ k: 'near', side, x: d.x, y: CAR_Y, gap: Math.max(0, gap) })
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
