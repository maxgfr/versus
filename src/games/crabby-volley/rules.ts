import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { rink } from '../../engines/puck/index.ts'

/**
 * Pure crabby volley: crabs stand on their side's baseline band. They scuttle
 * left and right along the band and hop (toward the finger), and a hop lifts
 * them to reach a high ball. The ball is volleyed over the net with a height. No
 * DOM, no sound.
 */

/** The sand: the area the ball and the crabs live on. */
export const COURT = rink({ x0: 60, y0: 30, x1: 940, y1: 1770, goal: 0, corner: 0 })
/** Baseline bands: where each side's crabs sit (y never changes). */
export const BAND_Y = { 0: 1540, 1: 260 } as const
export const BALL_R = 60
export const CRAB_R = 74
/** Claws reach forward (toward the net) a little further than the body is wide. */
export const CLAW_Y = 200
export const NET_H = 230
/** Highest a crab reaches on its own; a hop adds up to HOP_H. */
export const REACH = 230
export const HOP_H = 280
export const HOP_D = 230
export const HOP_T = 0.6
export const SCUTTLE = 880
export const G = 1400
export const BUMP_VZ = 1540
export const STEER = 1.5
export const MAX_TOUCH = 3
export const POINT_PAUSE = 1.3
/**
 * Safety net: a rally longer than this (s) goes to the last toucher. Rallies
 * quicken with every bump and end on play long before.
 */
export const RALLY_MAX = 30
/** A plain bump comes down this far in front of the rival's band (toward the net). */
export const DEEP = 60
/** A spike (struck at the top of a hop) comes down this much shorter, and this much flatter. */
export const SPIKE_SHORT = 240
const SPIKE_FLAT = 0.42
/** Each bump of a rally takes this share off the flight time, up to `QUICK_MAX`. */
const QUICK = 0.018
const QUICK_MAX = 0.32
const SUBSTEPS = 4
/** After a bump the crab cannot touch the ball again until it has risen clear. */
const COOL = 0.5

export interface Crab {
  side: Side
  /** 2 vs 2: which lane of the band the crab may cover. Undefined in 1 vs 1. */
  lane?: 0 | 1
  x: number
  y: number
  /** Height while hopping (0 on the sand). */
  z: number
  /** Hop clock: seconds into the hop, or -1 when not hopping. */
  hop: number
  /** Where the current hop lands (x). */
  hopTo: number
  /** Hop start x. */
  hopFrom: number
  /** Lateral speed (units/s), for steering the bump. */
  vx: number
  cool: number
}

export interface Ball {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export interface World {
  ball: Ball
  crabs: Crab[]
  score: [number, number]
  phase: 'rally' | 'point'
  pause: number
  server: Side
  last: Side | -1
  count: number
  why: 'land' | 'net' | 'touches' | 'slow' | 'out' | ''
  rally: number
  /** Bumps so far in this rally (each one quickens the next flight). */
  hits: number
}

export type Event =
  | { kind: 'hop'; side: Side; x: number; y: number }
  | {
      kind: 'bump'
      side: Side
      x: number
      y: number
      count: number
      /** 0..1: how high in its hop the crab struck it (a spike). */
      power: number
      /** Ground speed the ball leaves at. */
      speed: number
    }
  | { kind: 'net'; x: number; y: number }
  | { kind: 'land'; side: Side; x: number; y: number }
  | { kind: 'point'; side: Side; why: 'land' | 'net' | 'touches' | 'slow' | 'out' }
  | { kind: 'serve'; side: Side }

export const fwd = (side: Side): number => (side === 0 ? -1 : 1)
export const other = (s: Side): Side => (s === 0 ? 1 : 0)

/** The horizontal span a crab may cover: the whole band, or one lane of it. */
export function span(lane?: 0 | 1): { x0: number; x1: number } {
  const x0 = lane === 1 ? W / 2 : COURT.x0 + CRAB_R
  const x1 = lane === 0 ? W / 2 : COURT.x1 - CRAB_R
  return { x0, x1 }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export function newWorld(teams: boolean, server: Side, rng: Rng): World {
  const crabs: Crab[] = []
  for (const side of [0, 1] as Side[]) {
    const lanes: (0 | 1 | undefined)[] = teams ? [0, 1] : [undefined]
    for (const lane of lanes) {
      const sp = span(lane)
      const c: Crab = {
        side,
        x: (sp.x0 + sp.x1) / 2,
        y: BAND_Y[side],
        z: 0,
        hop: -1,
        hopTo: 0,
        hopFrom: 0,
        vx: 0,
        cool: 0,
      }
      if (lane !== undefined) c.lane = lane
      c.hopTo = c.x
      c.hopFrom = c.x
      crabs.push(c)
    }
  }
  const w: World = {
    ball: { x: W / 2, y: MID, z: 0, vx: 0, vy: 0, vz: 0 },
    crabs,
    score: [0, 0],
    phase: 'rally',
    pause: 0,
    server,
    last: -1,
    count: 0,
    why: '',
    rally: 0,
    hits: 0,
  }
  serve(w, server, rng)
  return w
}

/** Toss the ball up over the server's band. */
export function serve(w: World, side: Side, rng: Rng): void {
  w.ball = {
    x: rng.range(420, 580),
    y: BAND_Y[side] + fwd(side) * -40,
    z: 40,
    vx: 0,
    vy: 0,
    vz: BUMP_VZ * 0.92,
  }
  w.phase = 'rally'
  w.server = side
  w.last = -1
  w.count = 0
  w.why = ''
  w.rally = 0
  w.hits = 0
}

function point(
  w: World,
  side: Side,
  why: 'land' | 'net' | 'touches' | 'slow' | 'out',
  ev: Event[],
): void {
  if (w.phase !== 'rally') return
  w.score[side]++
  w.phase = 'point'
  w.pause = 0
  w.why = why
  w.server = side
  ev.push({ kind: 'point', side, why })
}

/** Start a hop: the crab leaps toward `targetX` (clamped to its hop distance and span). */
export function hopCrab(c: Crab, targetX: number): boolean {
  if (c.hop >= 0 || c.cool > 0) return false
  const sp = span(c.lane)
  c.hopFrom = c.x
  c.hopTo = clamp(targetX, c.x - HOP_D, c.x + HOP_D)
  c.hopTo = clamp(c.hopTo, sp.x0, sp.x1)
  c.hop = 0
  return true
}

/** Where the ball lands if nothing touches it: ground point and time. */
export function landingOf(b: Ball): { x: number; y: number; t: number } | null {
  if (b.z <= 0 && b.vz <= 0) return { x: b.x, y: b.y, t: 0 }
  const t = (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * b.z)) / G
  let x = b.x + b.vx * t
  let y = b.y + b.vy * t
  const lo = COURT.x0 + BALL_R
  const hi = COURT.x1 - BALL_R
  const s = hi - lo
  x = (((x - lo) % (2 * s)) + 2 * s) % (2 * s)
  if (x > s) x = 2 * s - x
  x += lo
  const top = COURT.y0 + BALL_R
  const bottom = COURT.y1 - BALL_R
  if (y < top) y = 2 * top - y
  if (y > bottom) y = 2 * bottom - y
  return { x, y, t }
}

/**
 * Advance one fixed step. `targetX[i]` is where crab i wants to scuttle (null =
 * stay); `hopReq[i]` asks crab i to hop this step. Returns what happened.
 */
export function step(
  w: World,
  dt: number,
  targetX: (number | null)[],
  hopReq: boolean[],
  rng: Rng,
  speeds: number[] = [],
): Event[] {
  const ev: Event[] = []
  if (w.phase === 'point') {
    w.pause += dt
    moveCrabs(w, dt, targetX, hopReq, ev, speeds)
    if (w.pause >= POINT_PAUSE) {
      serve(w, w.server, rng)
      ev.push({ kind: 'serve', side: w.server })
    }
    return ev
  }
  const h = dt / SUBSTEPS
  // The finger moves once per frame: walk each target evenly through the
  // substeps so a crab's sideways speed is its real one in every substep.
  const from = w.crabs.map((c) => c.x)
  for (let s = 0; s < SUBSTEPS && w.phase === 'rally'; s++) {
    moveCrabs(w, h, targetX, s === 0 ? hopReq : [], ev, speeds, from, (s + 1) / SUBSTEPS)
    flight(w, h, ev, rng)
  }
  return ev
}

function moveCrabs(
  w: World,
  dt: number,
  targetX: (number | null)[],
  hopReq: boolean[],
  ev: Event[],
  speeds: number[],
  from?: number[],
  k = 1,
): void {
  w.crabs.forEach((c, i) => {
    c.cool = Math.max(0, c.cool - dt)
    if (hopReq[i]) {
      if (hopCrab(c, targetX[i] ?? c.x)) ev.push({ kind: 'hop', side: c.side, x: c.x, y: c.y })
    }
    const sp = span(c.lane)
    const before = c.x
    if (c.hop >= 0) {
      // A hop covers its distance along an arc in HOP_T seconds.
      c.hop += dt
      const u = Math.min(1, c.hop / HOP_T)
      c.x = c.hopFrom + (c.hopTo - c.hopFrom) * u
      c.z = HOP_H * 4 * u * (1 - u)
      if (c.hop >= HOP_T) {
        c.hop = -1
        c.z = 0
        c.cool = 0.12
      }
    } else {
      const goal = targetX[i]
      const f = from?.[i]
      const t =
        goal === null || goal === undefined ? null : f === undefined ? goal : f + (goal - f) * k
      if (t !== null) {
        const d = t - c.x
        const step = (speeds[i] ?? SCUTTLE) * dt
        c.x += Math.abs(d) <= step ? d : Math.sign(d) * step
      }
    }
    c.x = clamp(c.x, sp.x0, sp.x1)
    c.vx = dt > 0 ? (c.x - before) / dt : 0
  })
}

function flight(w: World, h: number, ev: Event[], rng: Rng): void {
  const b = w.ball
  const prevY = b.y
  w.rally += h
  if (w.rally > RALLY_MAX) {
    // Too long a rally: the side that has to return the ball could not, so the last
    // side to touch it wins the point.
    point(w, w.last === -1 ? w.server : w.last, 'slow', ev)
    return
  }
  b.vz -= G * h
  b.x += b.vx * h
  b.y += b.vy * h
  b.z += b.vz * h
  // Out: the ball leaves the court past a side line or an end line. The side that
  // last touched it put it out.
  const lo = COURT.x0 + BALL_R
  const hi = COURT.x1 - BALL_R
  const top = COURT.y0 + BALL_R
  const bottom = COURT.y1 - BALL_R
  if (b.x < lo - 40 || b.x > hi + 40 || b.y < top - 40 || b.y > bottom + 40) {
    point(w, w.last === -1 ? other(w.server) : other(w.last), 'out', ev)
    return
  }
  if (prevY < MID !== b.y < MID && b.z < NET_H) {
    ev.push({ kind: 'net', x: b.x, y: MID })
    if (w.last !== -1) point(w, other(w.last), 'net', ev)
    else point(w, other(w.server), 'net', ev)
    return
  }
  // Claws meet a falling ball: the serve toss (and a ball still climbing off a
  // bump) cannot be swatted on the way up.
  for (const c of b.vz > 0 ? [] : w.crabs) {
    if (c.cool > 0) continue
    const reach = REACH + c.z
    if (b.z > reach) continue
    const dx = b.x - c.x
    const dy = b.y - c.y
    // Crabs are wide and flat: they cover the ball's ground spot within a disc.
    if (Math.abs(dx) >= CRAB_R + BALL_R || Math.abs(dy) >= CLAW_Y) continue
    if (w.last === c.side) w.count++
    else {
      w.last = c.side
      w.count = 1
    }
    // A crab high in its hop spikes: flatter, faster, and short of the rival's
    // band so they must hop to meet it. Where the ball sits on the claws and the
    // crab's sideways scuttle aim it left or right. The rally quickens.
    const power = Math.max(0, Math.min(1, (c.z - 40) / (HOP_H - 40)))
    w.hits++
    const quick = 1 - Math.min(QUICK_MAX, w.hits * QUICK)
    const vz = BUMP_VZ * quick * (1 - power * SPIKE_FLAT) * (0.98 + 0.04 * rng.next())
    const z0 = Math.max(0, b.z)
    const T = (vz + Math.sqrt(vz * vz + 2 * G * z0)) / G
    const rival = other(c.side)
    const landY = BAND_Y[rival] - fwd(c.side) * (DEEP + power * SPIKE_SHORT)
    b.vx = dx * STEER + c.vx * 0.4
    b.vy = (landY - b.y) / T
    b.vz = vz
    c.cool = COOL
    const speed = Math.hypot(b.vx, b.vy)
    ev.push({ kind: 'bump', side: c.side, x: b.x, y: b.y, count: w.count, power, speed })
    if (w.count > MAX_TOUCH) {
      point(w, other(c.side), 'touches', ev)
      return
    }
    break
  }
  if (b.z <= 0 && b.vz <= 0) {
    b.z = 0
    const owner: Side = b.y < MID ? 1 : 0
    ev.push({ kind: 'land', side: owner, x: b.x, y: b.y })
    point(w, other(owner), 'land', ev)
  }
}

export function winner(w: World, target: number): Side | null {
  if (w.score[0] >= target) return 0
  if (w.score[1] >= target) return 1
  return null
}
