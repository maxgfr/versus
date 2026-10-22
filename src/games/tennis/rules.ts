import { other, type Side } from '../../core/game.ts'
import { MID, W } from '../../core/stage.ts'
import { type Box, type Disc, disc, driveTo } from '../../engines/puck/index.ts'

/**
 * Pure tennis, seen from above. Each player's blob runs toward the finger in
 * its half; the racket swings by itself when the ball is in reach, and the
 * offset from the blob's centre aims the return. The ball carries a pseudo
 * height z (drawn as a shadow and a scale) and bounces on the ground.
 */

/** The singles court (lines). Blue's baseline is y0, red's is y1; each end leaves room for a scoreboard. */
export const COURT = { x0: 150, x1: 850, y0: 190, y1: 1610 }
export const NET_H = 46
/** Ground distance from a blob's centre at which it can reach the ball. */
export const REACH = 170
/** The racket only meets balls this low (a groundstroke after the bounce). */
export const REACH_Z = 60
export const BLOB_R = 64
export const GRAV = 900
export const SUBSTEPS = 4
export const TOSS_T = 0.42
const TOSS_H = 150
export const SWING_T = 0.36
/** A serve lands this far beyond the net, inside the service box. */
const SERVE_DEPTH = 280
const SERVE_VZ = 380
const HIT_VZ = 470
const MIN_VZ = 300
const BOUNCE = 0.55
const FRICTION = 0.8
/** Where a hit should land, measured from each end (inside the court). */
const DEEP = 330
/** A full-power drive lands this much deeper, and flies this much quicker. */
const POWER_DEEP = 150
const POWER_QUICK = 0.3
/** Blob speed (units/s) running into the ball that counts as a full-power drive. */
export const POWER_FULL = 1300
/** Every shot clears the net tape by at least this much. */
const NET_CLEAR = 16
/** The ball sits in the server's hand this far to the side of the blob. */
export const HAND = 84
export const POINT_PAUSE = 1.3

export interface Ball {
  x: number
  y: number
  /** Pseudo height above the ground (world units). */
  z: number
  vx: number
  vy: number
  vz: number
}

export interface World {
  ball: Ball
  /** Blob characters: centre and velocity (Disc shape), index = side. */
  blobs: [Disc, Disc]
  score: [number, number]
  /** Who serves the current (or next) point. */
  server: Side
  /** 'serve': the server is ready to toss. 'play': rally. 'point': pause after a point. */
  phase: 'serve' | 'play' | 'point'
  /** Seconds since the server's toss began, -1 while it has not started. */
  toss: number
  /** Seconds left in the 'point' pause. */
  pause: number
  /** Who hit the ball last. */
  hitter: Side | null
  /** Bounces on the receiving side since the last hit (one is allowed). */
  bounces: number
  /** Ball contacts in the current rally. */
  rally: number
  /** Seconds left in each racket's swing (also its cooldown). */
  swing: [number, number]
  surface: 'clay' | 'grass'
}

export type Reason = 'out' | 'short' | 'net' | 'double' | 'ace'

export type Event =
  | {
      kind: 'hit'
      side: Side
      x: number
      y: number
      z: number
      speed: number
      rally: number
      /** 0..1: how hard the blob ran into the ball. */
      power: number
    }
  | { kind: 'bounce'; side: Side; x: number; y: number; z: number }
  | { kind: 'serve'; side: Side; x: number; y: number }
  | { kind: 'point'; side: Side; reason: Reason; x: number; y: number }

export type Target = { x: number; y: number } | null

export interface Cmd {
  target: [Target, Target]
  speed: [number, number]
  serve: [boolean, boolean]
}

/** First to `target` points. */
export function winner(score: [number, number], target: number): Side | null {
  if (score[0] >= target) return 0
  if (score[1] >= target) return 1
  return null
}

/** Where a blob may run: its own half of the court. */
export function bandOf(side: Side): Box {
  const x0 = COURT.x0 + BLOB_R
  const x1 = COURT.x1 - BLOB_R
  return side === 0
    ? { x0, x1, y0: MID + 40, y1: COURT.y1 - BLOB_R * 0.4 }
    : { x0, x1, y0: COURT.y0 + BLOB_R * 0.4, y1: MID - 40 }
}

/** Spot the server stands on, and the blob's ready spot in a rally. */
export const serveY = (side: Side): number => (side === 0 ? COURT.y1 - 100 : COURT.y0 + 100)
export const homeOf = (side: Side): { x: number; y: number } => ({
  x: W / 2,
  y: side === 0 ? MID + 420 : MID - 420,
})

export function newWorld(first: Side, surface: 'clay' | 'grass'): World {
  const blobs: [Disc, Disc] = [disc(W / 2, serveY(0), BLOB_R), disc(W / 2, serveY(1), BLOB_R)]
  const w: World = {
    ball: { x: W / 2, y: serveY(first), z: 0, vx: 0, vy: 0, vz: 0 },
    blobs,
    score: [0, 0],
    server: first,
    phase: 'serve',
    toss: -1,
    pause: 0,
    hitter: null,
    bounces: 0,
    rally: 0,
    swing: [0, 0],
    surface,
  }
  holdBall(w)
  return w
}

/** Height of a toss, a parabola from the server's hand to its peak and back. */
export const tossZ = (t: number): number =>
  TOSS_H * Math.sin(Math.PI * Math.min(1, Math.max(0, t / TOSS_T)))

/** Keep the ball in the server's hand (rising in the toss). */
function holdBall(w: World): void {
  const b = w.blobs[w.server]
  w.ball.x = b.x + (w.server === 0 ? -HAND : HAND)
  w.ball.y = b.y + (w.server === 0 ? 10 : -10)
  w.ball.z = w.toss >= 0 ? tossZ(w.toss) : 0
  w.ball.vx = 0
  w.ball.vy = 0
  w.ball.vz = 0
}

/** One slice of free flight (no bounce, no net). */
export function fly(b: Ball, h: number): void {
  b.x += b.vx * h
  b.y += b.vy * h
  b.z += b.vz * h
  b.vz -= GRAV * h
}

/** The bounce off the ground: loses height and some pace. */
export function rebound(b: Ball): void {
  b.z = 0
  b.vz = -b.vz * BOUNCE
  b.vx *= FRICTION
  b.vy *= FRICTION
}

/** Seconds until a ball at height z0 falling at vz first drops to `level`. */
export function timeTo(z0: number, vz: number, level: number): number {
  if (z0 <= level) return 0
  const d = vz * vz - 2 * GRAV * (level - z0)
  if (d < 0) return 0
  return (vz + Math.sqrt(d)) / GRAV
}

/**
 * Run a blob for one substep. The finger moves once per frame, so the target is
 * walked from the frame's start (`from`) by `k` of the way: the blob's velocity is
 * then its real running speed in every substep, which is what a stroke reads.
 */
function moveBlob(
  p: Disc,
  cmd: Cmd,
  side: Side,
  h: number,
  from?: { x: number; y: number },
  k = 1,
): void {
  const t = cmd.target[side]
  if (t) {
    const tx = from ? from.x + (t.x - from.x) * k : t.x
    const ty = from ? from.y + (t.y - from.y) * k : t.y
    driveTo(p, tx, ty, cmd.speed[side], h, bandOf(side))
  } else {
    p.vx = 0
    p.vy = 0
  }
}

/** Flight time of a ball thrown up at `vz` from height `z` until it lands. */
const airTime = (vz: number, z: number): number =>
  (vz + Math.sqrt(vz * vz + 2 * GRAV * Math.max(0, z))) / GRAV

/**
 * Send the ball from where it is to land on (landX, landY) after `t` seconds,
 * stretching the flight (a loftier ball) until it clears the net tape: a shot
 * the racket makes can never be a net fault by itself.
 */
export function aim(b: Ball, landX: number, landY: number, t: number): void {
  const z0 = Math.max(0, b.z)
  const across = (b.y - MID) * (landY - MID) < 0
  const f = across ? (MID - b.y) / (landY - b.y) : 0
  let T = t
  for (let i = 0; i < 40 && across; i++) {
    const vz = (0.5 * GRAV * T * T - z0) / T
    const tn = T * f
    if (z0 + vz * tn - 0.5 * GRAV * tn * tn >= NET_H + NET_CLEAR) break
    T *= 1.06
  }
  b.vx = (landX - b.x) / T
  b.vy = (landY - b.y) / T
  b.vz = (0.5 * GRAV * T * T - z0) / T
}

/** The ball leaves the server's racket toward the far court. */
function launch(w: World, ev: Event[]): void {
  const s = w.server
  const b = w.blobs[s]
  const dir = s === 0 ? -1 : 1
  const z = 90
  // Aim inside the far service box, across from where the server stands.
  const landX = Math.max(COURT.x0 + 90, Math.min(COURT.x1 - 90, W / 2 - (b.x - W / 2) * 0.6))
  const landY = MID + dir * SERVE_DEPTH
  w.ball = { x: w.ball.x, y: b.y + dir * 40, z, vx: 0, vy: 0, vz: 0 }
  aim(w.ball, landX, landY, airTime(SERVE_VZ, z))
  w.phase = 'play'
  w.toss = -1
  w.hitter = s
  w.bounces = 0
  w.rally = 0
  w.swing[s] = SWING_T
  ev.push({ kind: 'serve', side: s, x: b.x, y: b.y })
}

function point(w: World, scorer: Side, reason: Reason, ev: Event[]): void {
  const b = w.ball
  w.score[scorer]++
  w.phase = 'point'
  w.pause = POINT_PAUSE
  w.server = other(w.server)
  w.toss = -1
  ev.push({ kind: 'point', side: scorer, reason, x: b.x, y: b.y })
}

/** The ball meets the ground. Out, short, or a second bounce ends the point. */
function land(w: World, ev: Event[]): void {
  const b = w.ball
  const hitter = w.hitter ?? other(w.server)
  b.z = 0
  const side: Side = b.y < MID ? 1 : 0
  // Not played after its one bounce: a double, wherever the second bounce lands
  // (an ace when it was the serve and the receiver never touched it).
  if (side !== hitter && w.bounces >= 1)
    return point(w, hitter, w.rally === 0 ? 'ace' : 'double', ev)
  const inside = b.x >= COURT.x0 && b.x <= COURT.x1 && b.y >= COURT.y0 && b.y <= COURT.y1
  if (!inside) return point(w, other(hitter), 'out', ev)
  if (side === hitter) return point(w, other(hitter), 'short', ev)
  w.bounces++
  rebound(b)
  ev.push({ kind: 'bounce', side, x: b.x, y: b.y, z: 0 })
}

/** Can `side` strike this ball now (ignoring reach)? After its one bounce, low, coming at it. */
export function strikable(bounces: number, b: Ball, side: Side): boolean {
  if (bounces < 1 || b.z > REACH_Z) return false
  const dir = side === 0 ? 1 : -1
  return b.vy * dir > 0 && (b.y - MID) * dir >= -80
}

/**
 * The racket swings when the ball is low, after its one bounce, in reach, and
 * coming toward this side. Where the ball sits against the blob sets where the return lands:
 * left of centre sends it left, right sends it right. Running into the ball
 * drives it (flatter, quicker, deeper); running across it bends the angle.
 */
function swing(w: World, side: Side, ev: Event[]): void {
  const b = w.ball
  const p = w.blobs[side]
  // One bounce must come first: the receiver plays the ball after it lands in their court.
  if (w.phase !== 'play' || w.swing[side] > 0 || !strikable(w.bounces, b, side)) return
  const dx = b.x - p.x
  const dy = b.y - p.y
  if (dx * dx + dy * dy > REACH * REACH) return
  // Toward the net is -y for red, +y for blue.
  const fwd = Math.max(0, side === 0 ? -p.vy : p.vy)
  const power = Math.min(1, (fwd + Math.abs(p.vx) * 0.35) / POWER_FULL)
  // The ball also takes the blob's sideways run (world x for both sides).
  const bend = Math.max(-0.35, Math.min(0.35, (p.vx / POWER_FULL) * 0.35))
  const u = Math.max(-1, Math.min(1, dx / REACH + bend))
  const landX = W / 2 + u * (COURT.x1 - W / 2 - 40)
  const deep = DEEP - power * POWER_DEEP
  const landY = side === 0 ? COURT.y0 + deep : COURT.y1 - deep
  w.rally++
  // Each return is a little flatter and quicker than the last, so rallies end.
  const vz = Math.max(MIN_VZ, HIT_VZ - w.rally * 12)
  w.swing[side] = SWING_T
  w.hitter = side
  w.bounces = 0
  aim(b, landX, landY, airTime(vz, b.z) * (1 - power * POWER_QUICK))
  const speed = Math.hypot(b.vx, b.vy)
  ev.push({ kind: 'hit', side, x: b.x, y: b.y, z: b.z, speed, rally: w.rally, power })
}

/**
 * Advance one fixed step. `cmd.target[side]` is where that blob runs (null =
 * stand still), `cmd.serve[side]` starts the toss when that side serves.
 */
export function step(w: World, dt: number, cmd: Cmd): Event[] {
  const ev: Event[] = []
  w.swing[0] = Math.max(0, w.swing[0] - dt)
  w.swing[1] = Math.max(0, w.swing[1] - dt)
  if (w.phase === 'point') {
    w.pause -= dt
    for (const side of [0, 1] as Side[]) moveBlob(w.blobs[side], cmd, side, dt)
    if (w.pause <= 0) {
      w.phase = 'serve'
      holdBall(w)
    }
    return ev
  }
  if (w.phase === 'serve') {
    for (const side of [0, 1] as Side[]) moveBlob(w.blobs[side], cmd, side, dt)
    if (w.toss < 0 && cmd.serve[w.server]) w.toss = 0
    if (w.toss >= 0) {
      w.toss += dt
      if (w.toss >= TOSS_T) launch(w, ev)
    }
    if (w.phase === 'serve') holdBall(w)
    return ev
  }
  const h = dt / SUBSTEPS
  const from = [
    { x: w.blobs[0].x, y: w.blobs[0].y },
    { x: w.blobs[1].x, y: w.blobs[1].y },
  ]
  for (let s = 0; s < SUBSTEPS; s++) {
    const k = (s + 1) / SUBSTEPS
    for (const side of [0, 1] as Side[]) moveBlob(w.blobs[side], cmd, side, h, from[side], k)
    const b = w.ball
    const prevY = b.y
    fly(b, h)
    // Crossing the net below its tape is a fault by the side that hit.
    if (Math.sign(prevY - MID) !== Math.sign(b.y - MID) && b.z < NET_H) {
      point(w, other(w.hitter ?? other(w.server)), 'net', ev)
      break
    }
    swing(w, 0, ev)
    swing(w, 1, ev)
    if (b.z <= 0 && b.vz < 0) {
      land(w, ev)
      if (w.phase !== 'play') break
    }
  }
  return ev
}
