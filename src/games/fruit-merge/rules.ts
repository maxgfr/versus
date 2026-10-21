import { Rng } from '../../core/rng.ts'

/**
 * Drop-and-merge jars, pure physics and rules. Each jar is a box that fruit fall
 * into: circles under gravity that bounce a little and collide with each other
 * and with the walls. Two touching fruit of the same kind fuse into the next
 * kind. A fruit resting with its top above the danger line for two seconds ends
 * its jar. Coordinates are panel-local (1000 wide). `sc` scales a jar and its
 * fruit; the solo jar is a little bigger.
 */

/** Fruit kinds, smallest (cherry) to largest (watermelon). */
export const KINDS = 10
/** Radius per kind at scale 1. */
export const RADII = [27, 33, 40, 47, 55, 63, 71, 80, 90, 101]
/** Points for the fruit a merge creates, indexed by the new kind. */
export const POINTS = [2, 4, 8, 14, 22, 32, 46, 62, 82, 110]
/** Two watermelons fuse into a bonus instead of a fruit. */
export const BONUS = 150
/** Kinds dropped by the sequence, with their weights. */
const SPAWN_WEIGHTS = [34, 27, 17, 10, 7, 5]
export const SPAWN_KINDS = SPAWN_WEIGHTS.length
export const TIME_LIMIT = 120
export const DANGER_TIME = 2

const GRAVITY = 2600
const REST = 0.12
const SUBSTEPS = 6
const AIR = 0.4
/** Impacts softer than this make no sound and no squash. */
const IMPACT = 180

export interface Geo {
  /** Scale of the jar and its fruit. */
  sc: number
  left: number
  right: number
  /** Opening of the jar (fruit are dropped above it). */
  top: number
  /** A fruit resting with its top above this line is in danger. */
  danger: number
  /** Floor of the jar. */
  floor: number
  /** Height of the panel's header band. */
  header: number
}

/** Geometry of a jar in a panel of w × h. `solo` is the whole stage. */
export function geometry(w: number, h: number, solo: boolean, header: number): Geo {
  const sc = solo ? 1.1 : 1
  const width = 680 * sc
  const left = (w - width) / 2
  const top = header + 170 * sc
  return {
    sc,
    left,
    right: left + width,
    top,
    danger: top + 70 * sc,
    floor: h - 60 * sc,
    header,
  }
}

export const radius = (k: number, geo: Geo): number => (RADII[k] ?? 0) * geo.sc

export interface Body {
  k: number
  x: number
  y: number
  vx: number
  vy: number
  /** Seconds resting with the top above the danger line. */
  hi: number
  /** Squash after a hard impact (0..1, decays). */
  sq: number
  /** Game time it was made (pop-in after a merge). */
  born: number
}

export interface Jar {
  bodies: Body[]
  score: number
  over: boolean
}

export const newJar = (): Jar => ({ bodies: [], score: 0, over: false })

/** Height at which a fruit of kind `k` waits above the jar before it is dropped. */
export function previewY(geo: Geo, k: number): number {
  const r = radius(k, geo)
  return Math.max(geo.top - 26 * geo.sc - r, geo.header + 6 + r)
}

/** Keep a fruit of kind `k` fully inside the jar's walls at x. */
export function clampX(geo: Geo, k: number, x: number): number {
  const r = radius(k, geo)
  return Math.min(geo.right - r, Math.max(geo.left + r, x))
}

/** Drop a fruit of kind `k` at x. */
export function drop(jar: Jar, geo: Geo, x: number, k: number, time: number): void {
  jar.bodies.push({
    k,
    x: clampX(geo, k, x),
    y: previewY(geo, k),
    vx: 0,
    vy: 0,
    hi: 0,
    sq: 0,
    born: time,
  })
}

/**
 * Where the centre of a fruit of kind `k` dropped at x would come to rest on
 * what is already in the jar.
 */
export function landingY(jar: Jar, geo: Geo, x: number, k: number): number {
  const r = radius(k, geo)
  let y = geo.floor - r
  for (const b of jar.bodies) {
    const rb = radius(b.k, geo) + r
    const dx = Math.abs(b.x - x)
    if (dx >= rb) continue
    const cy = b.y - Math.sqrt(rb * rb - dx * dx)
    if (cy < y) y = cy
  }
  return y
}

export interface Merge {
  x: number
  y: number
  /** Kind created; `KINDS` for a watermelon bonus. */
  k: number
  points: number
}

export interface Tick {
  merges: Merge[]
  /** Hard contacts this tick (sound and squash). */
  hits: number
  /** Strongest contact speed this tick. */
  impact: number
  /** The jar ended on this tick (or earlier). */
  over: boolean
}

function impact(out: Tick, b: Body, speed: number): void {
  if (speed < IMPACT) return
  out.hits++
  out.impact = Math.max(out.impact, speed)
  b.sq = Math.min(1, b.sq + speed / 900)
}

/** Gravity, air and motion for one substep. */
function integrate(jar: Jar, h: number): void {
  const drag = Math.max(0, 1 - AIR * h)
  for (const b of jar.bodies) {
    b.vy += GRAVITY * h
    b.vx *= drag
    b.vy *= drag
    b.x += b.vx * h
    b.y += b.vy * h
  }
}

/** Keep fruit inside the walls and on the floor, bouncing off them. */
function confine(jar: Jar, geo: Geo, out: Tick): void {
  for (const b of jar.bodies) {
    const r = radius(b.k, geo)
    if (b.x - r < geo.left) {
      b.x = geo.left + r
      if (b.vx < 0) {
        impact(out, b, -b.vx)
        b.vx = -b.vx * REST
      }
    }
    if (b.x + r > geo.right) {
      b.x = geo.right - r
      if (b.vx > 0) {
        impact(out, b, b.vx)
        b.vx = -b.vx * REST
      }
    }
    if (b.y + r > geo.floor) {
      b.y = geo.floor - r
      if (b.vy > 0) {
        impact(out, b, b.vy)
        b.vy = -b.vy * REST
        b.vx *= 0.92
      }
    }
  }
}

/** Separate overlapping fruit (mass ∝ area) and exchange a little bounce. */
function separate(jar: Jar, geo: Geo, out: Tick): void {
  const bs = jar.bodies
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i] as Body
      const b = bs[j] as Body
      const ra = radius(a.k, geo)
      const rb = radius(b.k, geo)
      const min = ra + rb
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 >= min * min) continue
      if (d2 < 1e-6) {
        dx = 0
        dy = -1
        d2 = 1
      }
      const d = Math.sqrt(d2)
      const nx = dx / d
      const ny = dy / d
      const wa = 1 / (ra * ra)
      const wb = 1 / (rb * rb)
      const ws = wa + wb
      const pen = min - d
      a.x -= nx * pen * (wa / ws)
      a.y -= ny * pen * (wa / ws)
      b.x += nx * pen * (wb / ws)
      b.y += ny * pen * (wb / ws)
      const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (rvn < 0) {
        const p = (-(1 + REST) * rvn) / ws
        a.vx -= p * wa * nx
        a.vy -= p * wa * ny
        b.vx += p * wb * nx
        b.vy += p * wb * ny
        impact(out, a, -rvn)
        impact(out, b, -rvn)
      }
    }
  }
}

/** Two touching fruit of the same kind, as indices, or null. */
function findTouching(jar: Jar, geo: Geo): [number, number] | null {
  const bs = jar.bodies
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i] as Body
      const b = bs[j] as Body
      if (a.k !== b.k) continue
      const min = radius(a.k, geo) + radius(b.k, geo) + 2
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (dx * dx + dy * dy <= min * min) return [i, j]
    }
  }
  return null
}

function merge(jar: Jar, i: number, j: number, time: number, out: Tick): void {
  const a = jar.bodies[i] as Body
  const b = jar.bodies[j] as Body
  const x = (a.x + b.x) / 2
  const y = (a.y + b.y) / 2
  const vx = (a.vx + b.vx) / 2
  const vy = (a.vy + b.vy) / 2
  jar.bodies.splice(j, 1)
  jar.bodies.splice(i, 1)
  let k = a.k + 1
  let points: number
  if (k >= KINDS) {
    k = KINDS
    points = BONUS
  } else {
    points = POINTS[k] ?? 0
    jar.bodies.push({ k, x, y, vx, vy, hi: 0, sq: 1, born: time })
  }
  jar.score += points
  out.merges.push({ x, y, k, points })
}

/** Advance a jar by `dt` seconds (split into substeps). Frozen once it is over. */
export function tick(jar: Jar, geo: Geo, dt: number, time: number): Tick {
  const out: Tick = { merges: [], hits: 0, impact: 0, over: jar.over }
  if (jar.over) return out
  const h = dt / SUBSTEPS
  for (let s = 0; s < SUBSTEPS; s++) {
    integrate(jar, h)
    confine(jar, geo, out)
    separate(jar, geo, out)
    separate(jar, geo, out)
    confine(jar, geo, out)
    for (let pair = findTouching(jar, geo); pair; pair = findTouching(jar, geo)) {
      merge(jar, pair[0], pair[1], time, out)
    }
  }
  let over = false
  for (const b of jar.bodies) {
    const r = radius(b.k, geo)
    const speed = Math.hypot(b.vx, b.vy)
    b.hi = b.y - r < geo.danger && speed < 90 ? b.hi + dt : 0
    if (b.hi >= DANGER_TIME) over = true
    // Flew out over the top of the jar: no point waiting for the timer.
    if (b.y < geo.top - 110 * geo.sc) over = true
    b.sq = Math.max(0, b.sq - dt * 4)
  }
  if (over) {
    jar.over = true
    out.over = true
  }
  return out
}

/** The fruit kinds dropped, in order, for a seed. Both players get the same sequence. */
export function kindSequence(seed: number, length = 400): number[] {
  const rng = new Rng((seed ^ 0x51ed270b) >>> 0)
  const total = SPAWN_WEIGHTS.reduce((a, b) => a + b, 0)
  return Array.from({ length }, () => {
    let t = rng.next() * total
    for (let k = 0; k < SPAWN_WEIGHTS.length; k++) {
      t -= SPAWN_WEIGHTS[k] ?? 0
      if (t < 0) return k
    }
    return 0
  })
}
