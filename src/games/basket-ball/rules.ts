import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { frame } from '../../core/frame.ts'
import { H, MID, W } from '../../core/stage.ts'

/**
 * Pure basket ball: each side has its own ball and its own hoop, both playing at
 * the same time. A swipe is a shot: the ball leaves the ground at a fixed arc and
 * the swipe sets how far it travels. Height is simulated (z), the table is flat.
 * No DOM, no sound.
 */

/** Distance from the midline to each hoop (in the owner's half). */
export const HOOP_DIST = 260
/** Rim height above the court, and the rim's radius. */
export const RIM_H = 290
export const RIM_R = 100
export const BALL_R = 56
/** Backboard: a slab `BOARD_OFF` in front of the hoop (toward the midline). */
export const BOARD_OFF = 60
export const BOARD_HALF = 130
export const BOARD_Z: [number, number] = [250, 430]
/** A ball centre this close to the rim centre, crossing the rim from above, is a basket. */
export const SWISH_R = 66
export const G = 1000
/** Seconds from launch to the rim plane. Every shot takes the same time; the swipe sets the reach. */
export const T_RING = 1.2
/** Launch speed up, so that the ball is at rim height exactly on the rim plane at T_RING. */
export const VZ = (RIM_H + 0.5 * G * T_RING * T_RING) / T_RING
/**
 * The flick's speed sets the tempo: a lazy push lobs the ball high (T_LOB to the
 * rim plane), a snappy flick fires a flatter, quicker shot (T_SNAP). The swipe's
 * length still sets where it lands, so aiming never depends on the speed; a fast
 * hand just shoots more often.
 */
export const T_LOB = 1.3
export const T_SNAP = 0.95
/** Flick speeds (world units/s) mapped onto [T_LOB, T_SNAP]. */
export const FLICK_SLOW = 900
export const FLICK_FAST = 3400
/** Rim touches before a rattling ball is settled (in if it sits inside the rim, out otherwise). */
export const MAX_RIMS = 4
/** Ground speed per world unit of swipe. */
export const GAIN = 1.25
export const MIN_SWIPE = 70
export const MAX_SWIPE = 620
const SUBSTEPS = 4
const RESPAWN = 0.6
/** Sudden-death length after a tied clock (s). */
export const OVERTIME = 12
/** How long a ball rolls on the court before the shot is over (s). */
const ROLL_TIME = 0.3
const MAX_FLIGHT = 5
const ROLL_BOUNCE = 0.25
const RIM_E = 0.5
const BOARD_E = 0.55

export interface Ball {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** wait: between shots. ready: on the ground, waiting for a swipe. fly: in the air. */
  state: 'wait' | 'ready' | 'fly'
  /** Seconds left before a waiting ball spawns. */
  wait: number
  /** Seconds since launch. */
  t: number
  bounces: number
  /** Whether this shot already went in (ignores the rim and board from then on). */
  scored: boolean
  /** Lying on the court: it rolls for a moment, then the shot is over. */
  grounded: boolean
  /** Seconds since launch when it first lay on the court. */
  landed: number
  /** World time the ball appeared (drives the pop-in). */
  born: number
  /** Seconds from launch to the rim plane for this shot (the flick's tempo). */
  arc: number
  /** Rim touches this shot. */
  rims: number
}

export interface World {
  balls: [Ball, Ball]
  score: [number, number]
  /** World time of each side's last basket (-10 = never). */
  swishAt: [number, number]
  /** Seconds left on the clock. */
  left: number
  /** Clock has run out: no new balls, the last flights finish. */
  ended: boolean
  /** Sudden death after a tied clock: the next basket ends the match. */
  overtime: boolean
  /** The sudden-death basket went in: later baskets no longer count. */
  golden: boolean
  /** Seconds since the start. */
  time: number
}

export type Event =
  | { kind: 'shoot'; side: Side; x: number; y: number; speed: number }
  | { kind: 'rim'; side: Side; x: number; y: number; speed: number }
  | { kind: 'board'; side: Side; x: number; y: number; speed: number }
  | { kind: 'swish'; side: Side; x: number; y: number }
  | { kind: 'land'; side: Side; x: number; y: number; speed: number }
  | { kind: 'out'; side: Side; x: number; y: number }

const fwd = (side: Side): number => (side === 0 ? -1 : 1)

/** The hoop's ground point for `side`, in world units. */
export function hoopAt(side: Side): { x: number; y: number } {
  return frame(side, W / 2, MID + HOOP_DIST)
}

/** The backboard's ground line for `side`, in world units. */
export function boardY(side: Side): number {
  return frame(side, W / 2, MID + HOOP_DIST - BOARD_OFF).y
}

/** A fresh ball on the ground near `side`'s edge, ready for a swipe. */
export function spawn(side: Side, rng: Rng, time: number): Ball {
  const lx = rng.range(180, 820)
  const ly = rng.range(1480, 1620)
  const p = frame(side, lx, ly)
  return {
    x: p.x,
    y: p.y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    state: 'ready',
    wait: 0,
    t: 0,
    bounces: 0,
    scored: false,
    grounded: false,
    landed: 0,
    born: time,
    arc: T_RING,
    rims: 0,
  }
}

export function newWorld(target: number, rng: Rng): World {
  return {
    balls: [spawn(0, rng, 0), spawn(1, rng, 0)],
    score: [0, 0],
    swishAt: [-10, -10],
    left: target,
    ended: false,
    overtime: false,
    golden: false,
    time: 0,
  }
}

/** Whether `side` can take a shot right now. */
export function ready(w: World, side: Side): boolean {
  return !w.ended && w.balls[side].state === 'ready'
}

/** Seconds to the rim plane for a flick of `speed` world units/s (undefined = the standard arc). */
export function arcFor(speed?: number): number {
  if (speed === undefined || !Number.isFinite(speed)) return T_RING
  const k = Math.min(1, Math.max(0, (speed - FLICK_SLOW) / (FLICK_FAST - FLICK_SLOW)))
  return T_LOB + (T_SNAP - T_LOB) * k
}

/** Launch velocity for a swipe: the reach on the rim plane depends on `len` only. */
function launch(dx: number, dy: number, len: number, arc: number): [number, number, number] {
  const m = Math.hypot(dx, dy) || 1
  const speed = (Math.min(Math.max(len, 0), MAX_SWIPE) * GAIN * T_RING) / arc
  return [(dx / m) * speed, (dy / m) * speed, (RIM_H + 0.5 * G * arc * arc) / arc]
}

/**
 * Launch `side`'s ball along the unit direction (dx, dy) with a swipe of `len`
 * world units flicked at `flick` units/s. Refused unless the ball is ready and
 * the swipe heads for the hoop.
 */
export function shoot(
  w: World,
  side: Side,
  dx: number,
  dy: number,
  len: number,
  flick?: number,
): boolean {
  const b = w.balls[side]
  if (!ready(w, side)) return false
  const m = Math.hypot(dx, dy)
  if (m < 1e-6 || dy * fwd(side) <= 0) return false
  if (!(len >= MIN_SWIPE)) return false
  const arc = arcFor(flick)
  ;[b.vx, b.vy, b.vz] = launch(dx, dy, len, arc)
  b.arc = arc
  b.state = 'fly'
  b.t = 0
  b.bounces = 0
  b.rims = 0
  b.scored = false
  b.grounded = false
  b.landed = 0
  return true
}

/** Predicted flight for the aim preview: the same arc `shoot` would launch. */
export function aimPath(
  from: { x: number; y: number },
  dx: number,
  dy: number,
  len: number,
  flick?: number,
): { x: number; y: number; z: number }[] {
  const [vx, vy, vz] = launch(dx, dy, len, arcFor(flick))
  const out: { x: number; y: number; z: number }[] = []
  for (let t = 0; t <= 2.2; t += 0.05) {
    const z = vz * t - 0.5 * G * t * t
    if (z < 0 && t > 0) break
    out.push({ x: from.x + vx * t, y: from.y + vy * t, z })
  }
  return out
}

/** Where a side's swipe goes, if it is a shot at all (for the live preview). */
export function swipeOK(side: Side, dy: number, len: number): boolean {
  return len >= MIN_SWIPE && dy * fwd(side) > 0
}

/** The clock is out and every ball has finished its flight. */
export function over(w: World): boolean {
  return w.ended && w.balls.every((b) => b.state !== 'fly')
}

export function winner(w: World): Side | 'draw' {
  if (w.score[0] === w.score[1]) return 'draw'
  return w.score[0] > w.score[1] ? 0 : 1
}

/** Advance one fixed step (1/60 s). */
export function step(w: World, dt: number, rng: Rng): Event[] {
  const ev: Event[] = []
  w.time += dt
  if (!w.ended) {
    w.left -= dt
    if (w.left <= 0) {
      w.left = 0
      // A tie on the clock goes to sudden death, once.
      if (w.score[0] === w.score[1] && !w.overtime) {
        w.overtime = true
        w.left = OVERTIME
      } else w.ended = true
    }
  }
  for (const side of [0, 1] as Side[]) {
    const b = w.balls[side]
    if (b.state === 'wait') {
      b.wait -= dt
      if (b.wait <= 0 && !w.ended) w.balls[side] = spawn(side, rng, w.time)
    } else if (b.state === 'fly') {
      const h = dt / SUBSTEPS
      for (let s = 0; s < SUBSTEPS && b.state === 'fly'; s++) flyStep(w, side, h, ev)
    }
  }
  return ev
}

function flyStep(w: World, side: Side, h: number, ev: Event[]): void {
  const b = w.balls[side]
  const hoop = hoopAt(side)
  const f = fwd(side)
  const px = b.x
  const py = b.y
  const pz = b.z
  if (!b.grounded) {
    b.vz -= G * h
    b.z += b.vz * h
  }
  b.x += b.vx * h
  b.y += b.vy * h
  b.t += h
  // Court walls (the hall around the table).
  if (b.x < 60) {
    b.x = 60
    b.vx = Math.abs(b.vx) * 0.6
  } else if (b.x > W - 60) {
    b.x = W - 60
    b.vx = -Math.abs(b.vx) * 0.6
  }
  if (b.y < 20 || b.y > H - 20) {
    b.y = b.y < 20 ? 20 : H - 20
    b.vy = -b.vy * 0.5
  }
  // Backboard: the ball reaches its face from the shooter's side, inside its panel.
  const face = boardY(side) - f * BALL_R
  if (!b.scored && pz < BOARD_Z[1] + BALL_R) {
    const before = (py - face) * f
    const now = (b.y - face) * f
    if (before <= 0 && now > 0) {
      const t = (face - py) / (b.y - py || 1)
      const cx = px + (b.x - px) * t
      const cz = pz + (b.z - pz) * t
      const inPanel =
        Math.abs(cx - W / 2) <= BOARD_HALF + BALL_R &&
        cz >= BOARD_Z[0] - BALL_R &&
        cz <= BOARD_Z[1] + BALL_R
      if (inPanel) {
        const speed = Math.abs(b.vy)
        b.y = face
        b.vy = -b.vy * BOARD_E
        b.vx *= 0.8
        ev.push({ kind: 'board', side, x: cx, y: face, speed })
      }
    }
  }
  // Rim: crossing the rim plane from above decides it. After the sudden-death
  // basket nothing else counts, so the other ball just falls through.
  if (!b.scored && !w.golden && pz >= RIM_H && b.z < RIM_H && b.vz < 0) {
    const t = (pz - RIM_H) / (pz - b.z)
    const cx = px + (b.x - px) * t
    const cy = py + (b.y - py) * t
    const d = Math.hypot(cx - hoop.x, cy - hoop.y)
    // A ball still rattling after a few touches settles: in if it sits inside the rim.
    if (d < SWISH_R || (b.rims >= MAX_RIMS && d < RIM_R)) {
      b.scored = true
      w.score[side]++
      w.swishAt[side] = w.time
      if (w.overtime) {
        w.golden = true
        w.ended = true
      }
      ev.push({ kind: 'swish', side, x: cx, y: cy })
    } else if (d < RIM_R + BALL_R && b.rims < MAX_RIMS) {
      // The rim is a ring: a ball touching its inner edge is knocked toward the
      // middle (it can rattle in), one touching the outer edge is knocked away.
      const ux = (cx - hoop.x) / (d || 1)
      const uy = (cy - hoop.y) / (d || 1)
      const s = d < RIM_R ? -1 : 1
      const nx = ux * s
      const ny = uy * s
      const vn = b.vx * nx + b.vy * ny
      const speed = Math.abs(b.vz) + Math.hypot(b.vx, b.vy) * 0.25
      if (vn < 0) {
        b.vx -= (1 + RIM_E) * vn * nx
        b.vy -= (1 + RIM_E) * vn * ny
      }
      // Kick it off the rim line a little so the next crossing is a fresh decision.
      const off = s > 0 ? Math.max(d, RIM_R + 8) : Math.min(d, RIM_R - 14)
      b.x = hoop.x + ux * off
      b.y = hoop.y + uy * off
      b.z = RIM_H + 1
      b.vz = Math.max(140, Math.abs(b.vz) * 0.35)
      b.rims++
      ev.push({ kind: 'rim', side, x: cx, y: cy, speed })
    }
  }
  // Ground: bounce a couple of times, then the ball lies there and rolls to a stop.
  if (!b.grounded && b.z <= 0) {
    b.z = 0
    const speed = Math.max(0, -b.vz)
    b.bounces++
    if (speed > 120) ev.push({ kind: 'land', side, x: b.x, y: b.y, speed })
    if (b.bounces <= 2 && speed * ROLL_BOUNCE > 60) b.vz = speed * ROLL_BOUNCE
    else {
      b.vz = 0
      b.grounded = true
      b.landed = b.t
    }
  }
  if (b.grounded) {
    const k = Math.exp(-2.5 * h)
    b.vx *= k
    b.vy *= k
    if (b.t - b.landed > ROLL_TIME || Math.hypot(b.vx, b.vy) < 40) finish(w, side, ev)
  }
  if (b.t > MAX_FLIGHT) finish(w, side, ev)
}

function finish(w: World, side: Side, ev: Event[]): void {
  const b = w.balls[side]
  ev.push({ kind: 'out', side, x: b.x, y: b.y })
  b.state = 'wait'
  b.wait = w.ended ? 9 : RESPAWN
  b.z = 0
  b.vx = b.vy = b.vz = 0
}
