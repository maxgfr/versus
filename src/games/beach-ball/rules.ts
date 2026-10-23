import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { driveTo, halfBox, type Disc, disc, rink } from '../../engines/puck/index.ts'
import { MID, W } from '../../core/stage.ts'

/**
 * Pure beach ball: a big ball volleyed over a net on sand. Each side has blobs
 * that bump the ball when they touch it low enough. The ball has a height (z),
 * so a blob can only reach it before it lands. No DOM, no sound.
 */

/** The sand: a rectangle around the net. */
export const COURT = rink({ x0: 60, y0: 30, x1: 940, y1: 1770, goal: 0, corner: 0 })
export const BALL_R = 64
export const BLOB_R = 70
export const NET_H = 230
/** Highest a blob can reach: a touch counts only below this height. */
export const REACH = 300
export const G = 1400
export const BUMP_VZ = 1120
export const BUMP_VY = 470
/** Sideways pace (units/s) per unit of offset between the ball and the blob's centre. */
export const STEER = 2.4
export const MAX_TOUCH = 3
/** Pause after a point before the next serve (s). */
export const POINT_PAUSE = 1.3
const SUBSTEPS = 4
const COOL = 0.22
/** Blob speed toward the net (units/s) that makes a full spike. */
export const SPIKE_FULL = 1800
/** A full spike flies this much faster and this much flatter than a plain bump. */
const SPIKE_PACE = 1.2
const SPIKE_FLAT = 0.35
/** Each bump of a rally adds this much pace, up to `ESCALATE_MAX`, so long rallies open up. */
const ESCALATE = 0.035
const ESCALATE_MAX = 0.6
/** ...and flies this much lower (shorter), up to `LOWER_MAX`. */
const LOWER = 0.015
const LOWER_MAX = 0.3
/**
 * Safety net: a rally longer than this (s) is let drop where the ball is. The
 * escalating pace ends rallies long before; this only guards against a stalemate.
 */
export const RALLY_MAX = 30
/** Blob top speed for humans (units/s); bots are slower or quicker by difficulty. */
export const HUMAN_SPEED = 3800

/**
 * Against the computer its level also sets the pace: the ball's flight runs on
 * a faster (or slower) clock, so every bump keeps its arc but comes down
 * sooner. Local 2P and online play at 1.
 */
export const TEMPO: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.25 }

/** The tempo of a match, fixed once at setup. */
export function tempoOf(d: Difficulty, bots: readonly boolean[]): number {
  return bots.some(Boolean) ? TEMPO[d] : 1
}

export interface Blob extends Disc {
  side: Side
  /** 2 vs 2: which lane of the half the blob may cover. Undefined in 1 vs 1. */
  lane?: 0 | 1
  /** Seconds until the blob can bump again. */
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
  blobs: Blob[]
  score: [number, number]
  /** rally: the ball is live. point: a point was just won (short pause). */
  phase: 'rally' | 'point'
  /** Seconds left in the pause after a point. */
  pause: number
  /** Who serves (and who won the last point). */
  server: Side
  /** Side that last touched the ball, and how many times in a row. */
  last: Side | -1
  count: number
  /** Why the last point was won, for the banner. */
  why: 'land' | 'net' | 'touches' | ''
  /** Seconds since the serve. */
  rally: number
  /** A rally that ran too long: the ball is simply let drop where it is. */
  dropping: boolean
  /** Bumps so far in this rally (pace escalates with it). */
  hits: number
  /** Ball clock multiplier (1 = normal), fixed for the match. */
  tempo: number
}

export type Event =
  | {
      kind: 'bump'
      side: Side
      x: number
      y: number
      /** Pace the ball leaves at (ground speed). */
      speed: number
      count: number
      /** 0..1: how hard the blob charged into it (a spike). */
      power: number
    }
  | { kind: 'wall'; x: number; y: number; speed: number }
  | { kind: 'net'; x: number; y: number }
  | { kind: 'land'; side: Side; x: number; y: number; speed: number }
  | { kind: 'point'; side: Side; why: 'land' | 'net' | 'touches' }
  | { kind: 'serve'; side: Side }

export const fwd = (side: Side): number => (side === 0 ? -1 : 1)

/** Blob home spots: centre of each half, one per lane in 2 vs 2. */
export function homeOf(side: Side, lane?: 0 | 1): { x: number; y: number } {
  const x = lane === undefined ? W / 2 : lane === 0 ? 300 : 700
  return { x, y: side === 0 ? 1330 : 470 }
}

export function newWorld(teams: boolean, server: Side, rng: Rng, tempo = 1): World {
  const blobs: Blob[] = []
  for (const side of [0, 1] as Side[]) {
    const lanes: (0 | 1 | undefined)[] = teams ? [0, 1] : [undefined]
    for (const lane of lanes) {
      const h = homeOf(side, lane)
      const b: Blob = { ...disc(h.x, h.y, BLOB_R), side, cool: 0 }
      if (lane !== undefined) b.lane = lane
      blobs.push(b)
    }
  }
  const w: World = {
    ball: { x: W / 2, y: MID, z: 0, vx: 0, vy: 0, vz: 0 },
    blobs,
    score: [0, 0],
    phase: 'rally',
    pause: 0,
    server,
    last: -1,
    count: 0,
    why: '',
    rally: 0,
    dropping: false,
    hits: 0,
    tempo,
  }
  serve(w, server, rng)
  return w
}

/** Toss the ball up over the server's sand. The serving side has not touched it yet. */
export function serve(w: World, side: Side, rng: Rng): void {
  const y = side === 0 ? 1560 : 240
  w.ball = { x: rng.range(420, 580), y, z: 40, vx: 0, vy: 0, vz: BUMP_VZ * 0.92 }
  w.phase = 'rally'
  w.server = side
  w.last = -1
  w.count = 0
  w.why = ''
  w.rally = 0
  w.dropping = false
  w.hits = 0
}

/** Score a point for `side` and pause before the serve. */
function point(w: World, side: Side, why: 'land' | 'net' | 'touches', ev: Event[]): void {
  if (w.phase !== 'rally') return
  w.score[side]++
  w.phase = 'point'
  w.pause = 0
  w.why = why
  w.server = side
  ev.push({ kind: 'point', side, why })
}

/** Where the ball lands if nothing touches it: ground point and time (or null if it never does). */
export function landingOf(b: Ball): { x: number; y: number; t: number } | null {
  if (b.z <= 0 && b.vz <= 0) return { x: b.x, y: b.y, t: 0 }
  const t = (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * b.z)) / G
  let x = b.x + b.vx * t
  let y = b.y + b.vy * t
  // Fold into the court, like the walls do.
  const lo = COURT.x0 + BALL_R
  const hi = COURT.x1 - BALL_R
  const span = hi - lo
  x = (((x - lo) % (2 * span)) + 2 * span) % (2 * span)
  if (x > span) x = 2 * span - x
  x += lo
  if (y < COURT.y0 + BALL_R) y = 2 * (COURT.y0 + BALL_R) - y
  if (y > COURT.y1 - BALL_R) y = 2 * (COURT.y1 - BALL_R) - y
  return { x, y, t }
}

/**
 * Advance one fixed step. `targets[i]` is where blob i wants to go (null = stay),
 * `speeds[i]` its top speed.
 */
export function step(
  w: World,
  dt: number,
  targets: ({ x: number; y: number } | null)[],
  speeds: number[],
  rng: Rng,
): Event[] {
  const ev: Event[] = []
  if (w.phase === 'point') {
    w.pause += dt
    moveBlobs(w, dt, targets, speeds)
    if (w.pause >= POINT_PAUSE) {
      serve(w, w.server, rng)
      ev.push({ kind: 'serve', side: w.server })
    }
    return ev
  }
  const h = dt / SUBSTEPS
  // The finger moves once per frame: walk each target evenly through the
  // substeps so a blob's velocity is its real speed in every one of them.
  const from = w.blobs.map((b) => ({ x: b.x, y: b.y }))
  for (let s = 0; s < SUBSTEPS && w.phase === 'rally'; s++) {
    moveBlobs(w, h, targets, speeds, from, (s + 1) / SUBSTEPS)
    flight(w, h, ev, rng)
  }
  return ev
}

function moveBlobs(
  w: World,
  dt: number,
  targets: ({ x: number; y: number } | null)[],
  speeds: number[],
  from?: { x: number; y: number }[],
  k = 1,
): void {
  w.blobs.forEach((b, i) => {
    b.cool = Math.max(0, b.cool - dt)
    const t = targets[i]
    const f = from?.[i]
    if (t) {
      const tx = f ? f.x + (t.x - f.x) * k : t.x
      const ty = f ? f.y + (t.y - f.y) * k : t.y
      driveTo(b, tx, ty, speeds[i] ?? HUMAN_SPEED, dt, halfBox(b.side, COURT, BLOB_R, b.lane))
    } else {
      b.vx = 0
      b.vy = 0
    }
  })
}

/**
 * One slice of free flight: gravity, then the side walls and the far ends of
 * the sand bounce the ball back in. Returns the side-wall impact speed (0 if none).
 */
export function fly(b: Ball, h: number): number {
  b.vz -= G * h
  b.x += b.vx * h
  b.y += b.vy * h
  b.z += b.vz * h
  let wall = 0
  const lo = COURT.x0 + BALL_R
  const hi = COURT.x1 - BALL_R
  if (b.x < lo || b.x > hi) {
    wall = Math.abs(b.vx)
    b.x = b.x < lo ? lo : hi
    b.vx = -b.vx * 0.7
  }
  const top = COURT.y0 + BALL_R
  const bottom = COURT.y1 - BALL_R
  if (b.y < top || b.y > bottom) {
    b.y = b.y < top ? top : bottom
    b.vy = -b.vy * 0.7
  }
  return wall
}

function flight(w: World, h: number, ev: Event[], rng: Rng): void {
  const b = w.ball
  const prevY = b.y
  w.rally += h
  if (!w.dropping && w.rally > RALLY_MAX) {
    w.dropping = true
    b.vx *= 0.3
    b.vy *= 0.3
    if (b.vz > 0) b.vz = 0
  }
  // The ball's own clock runs at the match tempo; speeds below are as seen on screen.
  const wall = fly(b, h * w.tempo) * w.tempo
  if (wall > 300) ev.push({ kind: 'wall', x: b.x, y: b.y, speed: wall })
  // Net: crossing the middle lower than the net costs the last toucher the point.
  if (prevY < MID !== b.y < MID && b.z < NET_H) {
    ev.push({ kind: 'net', x: b.x, y: MID })
    if (w.last !== -1) point(w, other(w.last), 'net', ev)
    else point(w, other(w.server), 'net', ev)
    return
  }
  // Blobs: a touch below the reach height bumps the ball toward the rival.
  for (const bl of w.dropping ? [] : w.blobs) {
    if (bl.cool > 0 || b.z > REACH) continue
    const dx = b.x - bl.x
    const dy = b.y - bl.y
    const d = Math.hypot(dx, dy)
    const r = BLOB_R + BALL_R
    if (d >= r) continue
    // Push the ball out of the blob, then bump it.
    const nx = d > 0 ? dx / d : 0
    const ny = d > 0 ? dy / d : fwd(bl.side)
    b.x = bl.x + nx * r
    b.y = bl.y + ny * r
    if (w.last === bl.side) w.count++
    else {
      w.last = bl.side
      w.count = 1
    }
    // Charging at the net spikes it: faster and flatter. Standing still lobs it.
    // Where the ball sits on the blob, and the blob's sideways run, aim it.
    const charge = bl.vy * fwd(bl.side)
    const power = Math.max(0, Math.min(1, charge / SPIKE_FULL))
    w.hits++
    const pace = (1 + Math.min(ESCALATE_MAX, w.hits * ESCALATE)) * (1 + power * SPIKE_PACE)
    b.vx = dx * STEER + bl.vx * 0.45
    b.vy = fwd(bl.side) * BUMP_VY * pace * (0.96 + 0.08 * rng.next())
    // Long rallies also fly lower: less time to get under the next ball.
    const low = 1 - Math.min(LOWER_MAX, w.hits * LOWER)
    b.vz = BUMP_VZ * low * (1 - power * SPIKE_FLAT) * (0.97 + 0.06 * rng.next())
    bl.cool = COOL
    const speed = Math.hypot(b.vx, b.vy) * w.tempo
    ev.push({ kind: 'bump', side: bl.side, x: b.x, y: b.y, speed, count: w.count, power })
    if (w.count > MAX_TOUCH) {
      point(w, other(bl.side), 'touches', ev)
      return
    }
    break
  }
  // Landing: the ball is on the sand of whichever half it is over.
  if (b.z <= 0 && b.vz <= 0) {
    b.z = 0
    const owner: Side = b.y < MID ? 1 : 0
    ev.push({ kind: 'land', side: owner, x: b.x, y: b.y, speed: -b.vz * w.tempo })
    point(w, other(owner), 'land', ev)
  }
}

export const other = (s: Side): Side => (s === 0 ? 1 : 0)

export function winner(w: World, target: number): Side | null {
  if (w.score[0] >= target) return 0
  if (w.score[1] >= target) return 1
  return null
}
