import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Racing Cars, pure rules: a procedural closed track (a Catmull-Rom spline
 * through control points drawn from the seed), cars that accelerate on their
 * own, steer toward the stick with some drift, and slow down on the grass.
 *
 * Nothing here draws or uses the browser. The track is rebuilt from the
 * control points in the state, so the online guest gets the same circuit.
 */

export interface Pt {
  x: number
  y: number
}

/** The table's centre and the track's base size (world units). */
const CX = 500
const CY = 900
const RX = 330
const RY = 640
/** Control points near mid-height stay right of this x, so the road misses the pause button. */
const PAUSE_X = 235
const PAUSE_DY = 430
/** Control points around the loop. */
const N_CTRL = 9
/** Samples per control segment. */
const PER_SEG = 40
export const TRACK_W = 150
/** Half-width of the car's footprint, for car-to-car bumps. */
export const CAR_R = 34
/** Bounciness of car-to-car bumps (0 = dead stop, 1 = perfect bounce). */
export const BUMP = 0.3
/** Top speed on the track (units / s). */
export const TOP = 560
/** Top speed on the grass, as a fraction of TOP. */
export const GRASS = 0.46
/** Forward acceleration (auto) and braking when above the target speed (units / s²). */
export const ACCEL = 260
export const BRAKE = 420
/** Turn rate (rad / s) at full speed; slower speeds turn a bit less sharply. */
export const TURN = 3.4
/** How fast sideways speed dies out (1/s): low = drift. */
export const GRIP = 9
export const GRIP_GRASS = 4
/** Sliding is when steering hard at speed: the grip is cut to this share. */
export const DRIFT = 0.45
/** Above this sideways speed the car leaves skid marks (units / s). */
export const SKID = 150

/** Seconds of countdown before the cars can move. */
export const COUNT = 3

export interface Track {
  pts: Pt[]
  /** Heading of each sample (rad), direction of travel. */
  hd: number[]
  /** Distance along the track to each sample (units). */
  cum: number[]
  /** Curvature of each sample, 0..1 relative to the sharpest bend on the track. */
  kap: number[]
  len: number
  n: number
}

/** Drive for one car in one step: stick direction and strength, and a speed factor for the bots. */
export interface Drive {
  jx: number
  jy: number
  /** Stick strength 0..1. Below 0.2 the car holds its heading. */
  m: number
  /** Multiplier on the cruising speed (the computer's speed control). */
  mul: number
}

export interface Car {
  side: Side
  x: number
  y: number
  /** Heading (rad): where the nose points. */
  h: number
  vx: number
  vy: number
  /** Position on the track (units), 0..len, nearest sample. */
  arc: number
  /** Distance travelled from the start line (units); can start negative (grid). */
  dist: number
  /** Time it crossed the finish, -1 until then. */
  finishT: number
  onTrack: boolean
  /** Recent skid marks, oldest first. */
  marks: { x: number; y: number; t: number }[]
}

export type Ev =
  | { k: 'drift'; side: Side; x: number; y: number }
  | { k: 'grass'; side: Side; x: number; y: number }
  | { k: 'lap'; side: Side; x: number; y: number; lap: number }
  | { k: 'bump'; x: number; y: number }

/**
 * Control points of a loop around the table, drawn from the seed. Angles and
 * radii are jittered a little, which keeps the loop simple (no crossings).
 */
export function controlPoints(rng: Rng): Pt[] {
  const pts: Pt[] = []
  const step = (Math.PI * 2) / N_CTRL
  for (let i = 0; i < N_CTRL; i++) {
    const a = i * step + rng.range(-0.3, 0.3) * step
    const r = rng.range(0.9, 1.08)
    const x = CX + Math.cos(a) * RX * r
    const y = CY + Math.sin(a) * RY * r
    // Keep the road clear of the pause button (left edge, mid-height).
    pts.push({ x: Math.abs(y - CY) < PAUSE_DY ? Math.max(x, PAUSE_X) : x, y })
  }
  return pts
}

/** Uniform Catmull-Rom through the closed loop, sampled, with heading, arc length and curvature. */
export function buildTrack(ctrl: readonly Pt[]): Track {
  const m = ctrl.length
  const pts: Pt[] = []
  for (let i = 0; i < m; i++) {
    const p0 = ctrl[(i - 1 + m) % m] as Pt
    const p1 = ctrl[i] as Pt
    const p2 = ctrl[(i + 1) % m] as Pt
    const p3 = ctrl[(i + 2) % m] as Pt
    for (let k = 0; k < PER_SEG; k++) {
      const t = k / PER_SEG
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      pts.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  const n = pts.length
  const cum: number[] = [0]
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1] as Pt
    const b = pts[i] as Pt
    cum.push((cum[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const len =
    (cum[n - 1] ?? 0) +
    Math.hypot((pts[0] as Pt).x - (pts[n - 1] as Pt).x, (pts[0] as Pt).y - (pts[n - 1] as Pt).y)
  const at = (i: number) => pts[(i + n) % n] as Pt
  const hd = pts.map((_, i) => {
    const a = at(i - 2)
    const b = at(i + 2)
    return Math.atan2(b.y - a.y, b.x - a.x)
  })
  // Turning per unit length over a few samples; the sharpest bend sets the scale.
  const raw = hd.map((h, i) => {
    const h2 = hd[(i + 3) % n] ?? h
    const h1 = hd[(i - 3 + n) % n] ?? h
    const span = Math.max(1, (cum[(i + 3) % n] ?? 0) - (cum[(i - 3 + n) % n] ?? 0))
    return Math.abs(angleDiff(h2, h1)) / span
  })
  const kmax = Math.max(1e-9, ...raw)
  return { pts, hd, cum, kap: raw.map((k) => k / kmax), len, n }
}

/** Shortest signed difference a → b, in (-π, π]. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** Sample index nearest to (x, y), and its distance. */
export function nearest(tr: Track, x: number, y: number): { i: number; d: number } {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < tr.n; i++) {
    const p = tr.pts[i] as Pt
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return { i: best, d: Math.sqrt(bestD) }
}

/** The track position `arc` units along from the start line (wrapping), as a sample index. */
export function sampleAt(tr: Track, arc: number): number {
  const a = ((arc % tr.len) + tr.len) % tr.len
  let lo = 0
  let hi = tr.n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((tr.cum[mid] ?? 0) <= a) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** The grid slot for a car: `lane` offsets it sideways from the start line, `back` puts it behind. */
export function gridCar(tr: Track, side: Side, lane: number): Car {
  const back = -40
  const i = sampleAt(tr, back)
  const p = tr.pts[i] as Pt
  const h = tr.hd[i] ?? 0
  // Left of the direction of travel is (-sin, cos).
  const off = side === 0 ? lane : -lane
  const x = p.x - Math.sin(h) * off
  const y = p.y + Math.cos(h) * off
  return {
    side,
    x,
    y,
    h,
    vx: 0,
    vy: 0,
    arc: tr.cum[i] ?? 0,
    dist: back,
    finishT: -1,
    onTrack: true,
    marks: [],
  }
}

/**
 * Advance every car one step. Cars wait for the countdown (`now < go`). Returns
 * the events for the feedback layer. Cars that cross the goal get `finishT`.
 */
export function stepRace(
  cars: Car[],
  tr: Track,
  drives: readonly Drive[],
  dt: number,
  now: number,
  go: number,
  goal: number,
  ev: Ev[],
): void {
  const racing = now >= go
  for (const c of cars) {
    const d = drives[c.side] ?? { jx: 0, jy: 0, m: 0, mul: 1 }
    const near = nearest(tr, c.x, c.y)
    const wasOn = c.onTrack
    c.onTrack = near.d <= TRACK_W / 2
    if (wasOn && !c.onTrack) ev.push({ k: 'grass', side: c.side, x: c.x, y: c.y })
    if (racing && c.finishT < 0) driveCar(c, d, near.d, dt, now, ev)
    else if (c.finishT >= 0) coast(c, dt)
    // Progress along the track, counting wrap-arounds as small steps.
    const arcNow = tr.cum[near.i] ?? 0
    let step = arcNow - c.arc
    if (step < -tr.len / 2) step += tr.len
    if (step > tr.len / 2) step -= tr.len
    const before = Math.floor(c.dist / tr.len)
    c.dist += step
    c.arc = arcNow
    const after = Math.floor(c.dist / tr.len)
    if (after > before && after > 0) ev.push({ k: 'lap', side: c.side, x: c.x, y: c.y, lap: after })
    if (c.finishT < 0 && c.dist >= goal) c.finishT = now
  }
  // Cars bump each other: they are pushed apart, and only the part of their
  // speed that is aimed at each other is traded (a softer bump, not a brake).
  const [a, b] = cars
  if (a && b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dd = Math.hypot(dx, dy)
    const min = CAR_R * 2
    if (dd < min && dd > 1e-6) {
      const nx = dx / dd
      const ny = dy / dd
      const push = (min - dd) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (closing < 0) {
        const j = (-(1 + BUMP) * closing) / 2
        a.vx -= nx * j
        a.vy -= ny * j
        b.vx += nx * j
        b.vy += ny * j
        // Only a real knock gets the sparks, not two cars resting side by side.
        if (closing < -40) ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
  }
}

function driveCar(c: Car, d: Drive, off: number, dt: number, now: number, ev: Ev[]): void {
  const steer = d.m > 0.2
  const want = steer ? Math.atan2(d.jy, d.jx) : c.h
  const diff = steer ? angleDiff(c.h, want) : 0
  const speed = Math.hypot(c.vx, c.vy)
  const rate = TURN * (0.45 + 0.55 * Math.min(1, speed / TOP))
  c.h += Math.max(-rate * dt, Math.min(rate * dt, diff))
  // Forward and sideways parts of the velocity, against the nose.
  const fx = Math.cos(c.h)
  const fy = Math.sin(c.h)
  const nx = -fy
  const ny = fx
  let fwd = c.vx * fx + c.vy * fy
  let lat = c.vx * nx + c.vy * ny
  // Cruising speed: full on the track, slower on the grass, and easing off when the stick turns hard.
  const onTrack = off <= TRACK_W / 2
  const base = (onTrack ? 1 : GRASS) * TOP * d.mul
  const scrub = steer ? Math.abs(diff) / Math.PI : 0
  const target = base * (1 - 0.3 * scrub)
  if (fwd < target) fwd = Math.min(target, fwd + ACCEL * dt)
  else fwd = Math.max(target, fwd - BRAKE * dt)
  const sliding = steer && Math.abs(diff) > 0.45 && speed > 0.55 * TOP
  const grip = (onTrack ? GRIP : GRIP_GRASS) * (sliding ? DRIFT : 1)
  lat *= Math.exp(-grip * dt)
  c.vx = fx * fwd + nx * lat
  c.vy = fy * fwd + ny * lat
  c.x += c.vx * dt
  c.y += c.vy * dt
  wall(c)
  if (Math.abs(lat) > SKID && speed > 80) {
    c.marks.push({ x: c.x, y: c.y, t: now })
    if (c.marks.length > 36) c.marks.shift()
    // Tyre smoke about ten times a second while sliding.
    const tick = Math.floor(now * 10) !== Math.floor((now - dt) * 10)
    if (Math.abs(lat) > 200 && tick) ev.push({ k: 'drift', side: c.side, x: c.x, y: c.y })
  }
}

/** Past the finish the car rolls to a stop on its own (a victory lap of sorts). */
function coast(c: Car, dt: number): void {
  const k = Math.exp(-1.4 * dt)
  c.vx *= k
  c.vy *= k
  c.x += c.vx * dt
  c.y += c.vy * dt
  wall(c)
}

/** The table's edge is a low bank: bounce back and lose speed. */
function wall(c: Car): void {
  const lo = 40
  const hix = 960
  const hiy = 1760
  if (c.x < lo || c.x > hix) {
    c.x = Math.max(lo, Math.min(hix, c.x))
    c.vx *= -0.3
  }
  if (c.y < lo || c.y > hiy) {
    c.y = Math.max(lo, Math.min(hiy, c.y))
    c.vy *= -0.3
  }
}

/** The car that crossed the goal first, or null while nobody has. */
export function winnerOf(cars: Car[]): Car | null {
  const done = cars.filter((c) => c.finishT >= 0)
  if (!done.length) return null
  return done.reduce((a, b) =>
    b.finishT < a.finishT || (b.finishT === a.finishT && b.dist > a.dist) ? b : a,
  )
}

/** Laps completed, shown as the lap the car is on (1-based, capped at the race length). */
export function lapOf(c: Car, tr: Track, laps: number): number {
  return Math.min(laps, Math.max(1, Math.floor(Math.max(0, c.dist) / tr.len) + 1))
}
