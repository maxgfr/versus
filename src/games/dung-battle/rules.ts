import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Dung Battle physics: two beetles push dung balls around an oval dish. Pure
 * functions of the world, no DOM and no Math.random (the rng only lays out
 * the pellets). Events are returned so the game can play sounds and effects.
 */

/** The dish: an ellipse inside the arena strip (x 0–1000, y 300–1500). */
export const FIELD = { cx: 500, cy: 900, a: 470, b: 570 }
export const BEETLE_R = 34
export const BALL_R0 = 40
export const BALL_RMAX = 118
/** Radius gained for each pellet eaten. */
export const GROW = 3.2
/** Pellets a ball can eat before it stops growing. */
export const NMAX = Math.ceil((BALL_RMAX - BALL_R0) / GROW)
export const PELLETS = 26
export const PELLET_R = 14
/** Seconds before an eaten pellet is back on the floor. */
export const RESPAWN = 12
/** Seconds a round lasts; then the bigger ball takes it (equal = draw). */
export const ROUND_T = 40
/** A ball must be more than 15% bigger (by radius) to flatten the other beetle. */
export const FLATTEN = 1.15
/** Beetle top speed at the smallest ball (world units / s). */
export const TOP = 300
/** Seconds the flatten animation takes (render only). */
export const FLAT_T = 0.45

const ACCEL = 4.5
const TURN = 4.2
/** Spring that keeps a ball in front of its beetle, and the damping that matches it to the beetle. */
const SPRING = 26
const DAMP = 5.5

export interface Beetle {
  x: number
  y: number
  vx: number
  vy: number
  /** Heading (rad). The ball sits in front of it. */
  a: number
  /** Distance walked, for the leg animation. */
  walk: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  /** Pellets eaten. */
  n: number
  r: number
  /** World time of the last pellet (-1 = none). Breaks a level time-out. */
  eat: number
  /** Accumulated roll angle, for the surface speckles. */
  roll: number
}

export interface Pellet {
  x: number
  y: number
  on: boolean
  /** World time the pellet comes back (when off). */
  back: number
}

export interface Bug {
  side: Side
  beetle: Beetle
  ball: Ball
}

export interface World {
  /** Seconds of play. */
  t: number
  bugs: [Bug, Bug]
  pellets: Pellet[]
  /** The side whose beetle was flattened, or null while the round goes on. */
  flattened: Side | null
  /** World time of the flattening (-1 = none). */
  flatT: number
}

export interface Drive {
  jx: number
  jy: number
}

export type Ev =
  | { k: 'eat'; side: Side; x: number; y: number; n: number }
  | { k: 'bump'; x: number; y: number; speed: number }
  | { k: 'clash'; x: number; y: number; speed: number }
  | { k: 'wall'; x: number; y: number; speed: number }
  | { k: 'flatten'; side: Side; x: number; y: number }

export const ballRadius = (n: number): number => Math.min(BALL_RMAX, BALL_R0 + n * GROW)

/** Heavier balls drive their beetle more slowly. */
export const topSpeed = (r: number): number =>
  TOP * (1 - (0.08 * (r - BALL_R0)) / (BALL_RMAX - BALL_R0))

/** How far behind its ball the beetle rides: just behind it, head down against the ball. */
export const tether = (r: number): number => r + BEETLE_R * 0.55

/** A ball's inertia: bigger balls are heavier. */
export const massOf = (r: number): number => (r / BALL_R0) ** 2

/** Is `r` the flattening size against `small`? */
export const flattens = (big: number, small: number): boolean => big > small * FLATTEN

const spawnY = (side: Side): number => (side === 0 ? FIELD.cy + 285 : FIELD.cy - 285)

/** Lay out the pellets: spaced out inside the dish, clear of the starting beetles. */
function layPellets(rng: Rng): Pellet[] {
  const out: Pellet[] = []
  for (let tries = 0; tries < 6000 && out.length < PELLETS; tries++) {
    const a = rng.range(0, Math.PI * 2)
    const d = Math.sqrt(rng.next()) * 0.86
    const x = FIELD.cx + Math.cos(a) * d * FIELD.a
    const y = FIELD.cy + Math.sin(a) * d * FIELD.b
    const clearOfStart = [0, 1].every((s) => Math.hypot(x - FIELD.cx, y - spawnY(s as Side)) > 170)
    if (!clearOfStart) continue
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 96)) continue
    out.push({ x, y, on: true, back: 0 })
  }
  return out
}

function bugAt(side: Side): Bug {
  const a = side === 0 ? -Math.PI / 2 : Math.PI / 2
  const beetle: Beetle = { x: FIELD.cx, y: spawnY(side), vx: 0, vy: 0, a, walk: 0 }
  const d = tether(BALL_R0)
  const ball: Ball = {
    x: beetle.x + Math.cos(a) * d,
    y: beetle.y + Math.sin(a) * d,
    vx: 0,
    vy: 0,
    n: 0,
    r: BALL_R0,
    eat: -1,
    roll: 0,
  }
  return { side, beetle, ball }
}

export function newWorld(rng: Rng): World {
  return { t: 0, bugs: [bugAt(0), bugAt(1)], pellets: layPellets(rng), flattened: null, flatT: -1 }
}

/** Keep a body inside the dish (for radius r). Bounces it off the rim. Returns the impact speed. */
export function confine(
  p: { x: number; y: number; vx: number; vy: number },
  r: number,
  e = 0.5,
): number {
  const A = FIELD.a - r
  const B = FIELD.b - r
  const dx = p.x - FIELD.cx
  const dy = p.y - FIELD.cy
  const k = Math.hypot(dx / A, dy / B)
  if (k <= 1) return 0
  const bx = dx / k
  const by = dy / k
  p.x = FIELD.cx + bx
  p.y = FIELD.cy + by
  // Outward normal of the ellipse at the contact point.
  const nx0 = bx / (A * A)
  const ny0 = by / (B * B)
  const len = Math.hypot(nx0, ny0) || 1
  const nx = nx0 / len
  const ny = ny0 / len
  const vn = p.vx * nx + p.vy * ny
  if (vn <= 0) return 0
  p.vx -= (1 + e) * vn * nx
  p.vy -= (1 + e) * vn * ny
  return vn
}

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

/** Two discs push each other apart; masses share the push and the bounce. Returns the impact speed (0 = apart). */
export function bump(
  a: Body,
  b: Body,
  ra: number,
  rb: number,
  ma: number,
  mb: number,
  e: number,
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const min = ra + rb
  const d2 = dx * dx + dy * dy
  if (d2 >= min * min) return 0
  const d = Math.sqrt(d2) || 0.0001
  const nx = dx / d
  const ny = dy / d
  const overlap = min - d
  const share = mb / (ma + mb)
  a.x -= nx * overlap * share
  a.y -= ny * overlap * share
  b.x += nx * overlap * (1 - share)
  b.y += ny * overlap * (1 - share)
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn >= 0) return 0
  const j = (-(1 + e) * vn) / (1 / ma + 1 / mb)
  a.vx -= (j / ma) * nx
  a.vy -= (j / ma) * ny
  b.vx += (j / mb) * nx
  b.vy += (j / mb) * ny
  return -vn
}

function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Advance the world by `dt`. `drives[side]` steers that beetle. Events are appended to `ev`. */
export function stepWorld(w: World, drives: readonly Drive[], dt: number, ev: Ev[]): void {
  w.t += dt
  if (w.flattened !== null) return
  for (const p of w.pellets) if (!p.on && w.t >= p.back) p.on = true

  // Beetles walk towards the stick at a speed set by their ball's weight.
  for (const bug of w.bugs) {
    const b = bug.beetle
    const d = drives[bug.side]
    const m = Math.min(1, Math.hypot(d?.jx ?? 0, d?.jy ?? 0))
    const len = Math.hypot(d?.jx ?? 0, d?.jy ?? 0) || 1
    const sp = m * topSpeed(bug.ball.r)
    const tx = m > 0 ? ((d?.jx ?? 0) / len) * sp : 0
    const ty = m > 0 ? ((d?.jy ?? 0) / len) * sp : 0
    const k = Math.min(1, ACCEL * dt)
    b.vx += (tx - b.vx) * k
    b.vy += (ty - b.vy) * k
    b.x += b.vx * dt
    b.y += b.vy * dt
    const v = Math.hypot(b.vx, b.vy)
    if (v > 25)
      b.a += Math.max(-TURN * dt, Math.min(TURN * dt, angleTo(b.a, Math.atan2(b.vy, b.vx))))
    b.walk += v * dt
  }

  // Each ball rides in front of its beetle on a damped spring.
  for (const bug of w.bugs) {
    const b = bug.beetle
    const c = bug.ball
    const dd = tether(c.r)
    const px = b.x + Math.cos(b.a) * dd
    const py = b.y + Math.sin(b.a) * dd
    const inv = 1 / massOf(c.r)
    c.vx += ((px - c.x) * SPRING + (b.vx - c.vx) * DAMP) * inv * dt
    c.vy += ((py - c.y) * SPRING + (b.vy - c.vy) * DAMP) * inv * dt
    c.x += c.vx * dt
    c.y += c.vy * dt
    c.roll += (Math.hypot(c.vx, c.vy) * dt) / c.r
  }

  for (const bug of w.bugs) {
    const sb = confine(bug.beetle, BEETLE_R, 0.3)
    if (sb > 90) ev.push({ k: 'wall', x: bug.beetle.x, y: bug.beetle.y, speed: sb })
    const sc = confine(bug.ball, bug.ball.r, 0.6)
    if (sc > 90) ev.push({ k: 'wall', x: bug.ball.x, y: bug.ball.y, speed: sc })
  }

  // Pellets under a ball are eaten and make it bigger.
  for (const bug of w.bugs) {
    if (bug.ball.n >= NMAX) continue
    for (const p of w.pellets) {
      if (!p.on || bug.ball.n >= NMAX) continue
      if (Math.hypot(p.x - bug.ball.x, p.y - bug.ball.y) > bug.ball.r * 0.9) continue
      p.on = false
      p.back = w.t + RESPAWN
      bug.ball.n++
      bug.ball.r = ballRadius(bug.ball.n)
      bug.ball.eat = w.t
      ev.push({ k: 'eat', side: bug.side, x: p.x, y: p.y, n: bug.ball.n })
    }
  }

  // Beetles bump each other and shove rival balls aside (never their own ball).
  const [A, B] = w.bugs
  const s1 = bump(A.beetle, B.beetle, BEETLE_R, BEETLE_R, 1, 1, 0.4)
  if (s1 > 60)
    ev.push({
      k: 'bump',
      x: (A.beetle.x + B.beetle.x) / 2,
      y: (A.beetle.y + B.beetle.y) / 2,
      speed: s1,
    })
  for (const [me, foe] of [
    [A, B],
    [B, A],
  ] as const) {
    const s = bump(me.beetle, foe.ball, BEETLE_R, foe.ball.r, 1, massOf(foe.ball.r), 0.5)
    if (s > 60) ev.push({ k: 'bump', x: me.beetle.x, y: me.beetle.y, speed: s })
  }

  // Ball against ball: a much bigger ball flattens the other beetle, otherwise they bounce.
  const dist = Math.hypot(A.ball.x - B.ball.x, A.ball.y - B.ball.y)
  if (dist < A.ball.r + B.ball.r) {
    const mx = (A.ball.x + B.ball.x) / 2
    const my = (A.ball.y + B.ball.y) / 2
    const small = A.ball.r <= B.ball.r ? A : B
    const big = small === A ? B : A
    if (flattens(big.ball.r, small.ball.r)) {
      w.flattened = small.side
      w.flatT = w.t
      ev.push({ k: 'flatten', side: small.side, x: mx, y: my })
      return
    }
    const s = bump(A.ball, B.ball, A.ball.r, B.ball.r, massOf(A.ball.r), massOf(B.ball.r), 0.8)
    if (s > 60) ev.push({ k: 'clash', x: mx, y: my, speed: s })
  }
}

/**
 * The side that won the round, null while it goes on. A flattening decides at
 * once. At the time limit the bigger ball wins; a level dish goes to the ball
 * that grew last, and only a dead heat (nothing eaten) is a 'draw'.
 */
export function roundWinner(w: World): Side | 'draw' | null {
  if (w.flattened !== null) return other(w.flattened)
  if (w.t < ROUND_T) return null
  const [a, b] = w.bugs
  if (Math.abs(a.ball.r - b.ball.r) >= 0.5) return a.ball.r > b.ball.r ? 0 : 1
  if (a.ball.eat === b.ball.eat) return 'draw'
  return a.ball.eat > b.ball.eat ? 0 : 1
}
