import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'

/**
 * Pure sword thrower. Each player sways a sword at their own edge and taps to
 * let it fly across the table. Each shield spins in the far half of the table,
 * and a sword that sticks into the rival's shield scores for the thrower. Swords
 * already stuck in a shield form a fence: a new one meeting that angle clangs
 * off. A sword that misses its target and reaches the thrower's own shield clangs
 * off that too. A shield that fills up clears: its swords tumble off and it starts
 * again. No DOM, all randomness through the passed Rng.
 */

export const MATCH = 45
export const RELOAD = 0.5
export const SPEED = 1600
/** Swords a shield holds before it clears. */
export const CAP = 8
/** Radius of a shield's face. */
export const RIM = 120
/** Distance from a shield's centre where a sword meets it (where stuck hilts sit). */
export const REACH = RIM + 66
/** Angular half-width of the clang zone around a stuck sword (radians). */
export const BLOCK = 0.2
/** Aimer sway: half-angle (radians) and angular speed. */
export const SWAY = 0.8
export const SWAY_RATE = 1.6
/** How far ahead of the pivot a sword is held, and where a thrown one begins. */
export const START = 150
/** Horizontal wander of a shield: half-width (units) and rate. */
const WANDER = 150
const WANDER_RATE = 0.42

/** Where each player's sword leaves from: side 0 is red (bottom), side 1 is blue (top). */
export const PIVOT: readonly { x: number; y: number }[] = [
  { x: W / 2, y: 1640 },
  { x: W / 2, y: 160 },
]
/** Shield k belongs to side k and sits in the far half, where the rival throws at it. */
export const SHIELD_Y: readonly number[] = [640, 1160]

export interface Stuck {
  /** Angle of the sword from the shield's centre, relative to the shield's rotation. */
  a: number
  /** Match time it stuck (for the slide-in). */
  t: number
}

export interface Shield {
  x: number
  y: number
  rot: number
  /** +1 or -1: which way it spins. */
  dir: 1 | -1
  ph: number
  stuck: Stuck[]
  /** Match time of the last sword that stuck, clanged off, or the last clear (for the punch, flash and burst). */
  hitT: number
  clangT: number
  clearT: number
}

/** How a thrower reacts to its last throw, stamped so every device animates it the same. */
export interface React {
  t: number
  k: 'stick' | 'clang' | 'own' | 'clear' | 'none'
}

export interface Sword {
  side: Side
  x: number
  y: number
  vx: number
  vy: number
  /** Not in flight any more (clanged off, or fell off a cleared shield): tumbles and fades. */
  drop: boolean
  /** Age since it stopped flying (s). */
  t: number
}

export interface State {
  /** Seconds left in the match. */
  left: number
  /** Seconds since the start. */
  t: number
  /** shields[k] belongs to side k; the rival throws at it. */
  shields: [Shield, Shield]
  swords: Sword[]
  /** Swords each side has stuck into the rival's shields in total. */
  score: [number, number]
  /** Aimer phase per side (drives the sway). */
  sway: [number, number]
  reload: [number, number]
  react: [React, React]
  /** Seconds since the final whistle (the shields spin down, loose swords settle). */
  after: number
}

export type Event =
  | { kind: 'throw'; side: Side; x: number; y: number }
  | { kind: 'stick'; side: Side; shield: Side; x: number; y: number; count: number }
  | { kind: 'clang'; side: Side; x: number; y: number; own: boolean }
  | { kind: 'clear'; shield: Side; x: number; y: number }
  | { kind: 'miss'; side: Side; x: number; y: number }
  | { kind: 'tick'; left: number }

export function newState(rng: Rng): State {
  const shield = (k: Side): Shield => ({
    x: W / 2,
    y: SHIELD_Y[k] ?? 0,
    rot: rng.range(0, Math.PI * 2),
    dir: rng.sign(),
    ph: rng.range(0, Math.PI * 2),
    stuck: [],
    hitT: -9,
    clangT: -9,
    clearT: -9,
  })
  return {
    left: MATCH,
    t: 0,
    shields: [shield(0), shield(1)],
    swords: [],
    score: [0, 0],
    sway: [rng.range(0, Math.PI * 2), rng.range(0, Math.PI * 2)],
    reload: [0, 0],
    react: [
      { t: -9, k: 'none' },
      { t: -9, k: 'none' },
    ],
    after: 0,
  }
}

/** Shield the side's swords fly at: the rival's. */
export function targetOf(s: State, side: Side): Shield {
  return s.shields[other(side)] as Shield
}

/** Wrap an angle to [-π, π). */
export function wrap(a: number): number {
  const t = (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return t - Math.PI
}

/** Unit direction of a throw at sway angle `a`. 0 points straight at the table. */
export function dirOf(side: Side, a: number): { x: number; y: number } {
  return { x: Math.sin(a), y: side === 0 ? -Math.cos(a) : Math.cos(a) }
}

export function aimAngle(s: State, side: Side): number {
  return SWAY * Math.sin(s.sway[side])
}

/** Angle that points a throw from `side`'s pivot straight at the centre of its target now. */
export function centreAngle(s: State, side: Side): number {
  const p = PIVOT[side] as { x: number; y: number }
  const c = targetOf(s, side)
  const dx = c.x - p.x
  const dy = c.y - p.y
  return Math.atan2(dx, side === 0 ? -dy : dy)
}

export function canThrow(s: State, side: Side): boolean {
  return s.left > 0 && (s.reload[side] ?? 0) <= 0
}

/**
 * Where a sword thrown at angle `a` would meet the target's outer ring, as an
 * angle from its centre; null if it misses the target.
 */
export function impactAngle(s: State, side: Side, a: number): number | null {
  const p = PIVOT[side] as { x: number; y: number }
  const d = dirOf(side, a)
  const c = targetOf(s, side)
  const ox = p.x + d.x * START - c.x
  const oy = p.y + d.y * START - c.y
  const b = 2 * (d.x * ox + d.y * oy)
  const k = ox * ox + oy * oy - REACH * REACH
  const disc = b * b - 4 * k
  if (disc < 0) return null
  const tau = (-b - Math.sqrt(disc)) / 2
  if (tau < 0) return null
  return Math.atan2(oy + d.y * tau, ox + d.x * tau)
}

/** True when a stuck sword sits at (or near) this angle of the shield's rim. */
export function clangsAt(shield: Shield, theta: number): boolean {
  return shield.stuck.some((st) => Math.abs(wrap(theta - (shield.rot + st.a))) < BLOCK)
}

/**
 * Would a sword thrown at angle `a` now stick into the rival's shield? The
 * bot's "free angle" test.
 */
export function freeShot(s: State, side: Side, a: number): boolean {
  const th = impactAngle(s, side, a)
  return th !== null && !clangsAt(targetOf(s, side), th)
}

/** Launch a sword from `side`'s pivot along the current sway. */
export function throwSword(s: State, side: Side): Event {
  const p = PIVOT[side] as { x: number; y: number }
  const d = dirOf(side, aimAngle(s, side))
  const x = p.x + d.x * START
  const y = p.y + d.y * START
  s.swords.push({ side, x, y, vx: d.x * SPEED, vy: d.y * SPEED, drop: false, t: 0 })
  s.reload[side] = RELOAD
  return { kind: 'throw', side, x, y }
}

/**
 * Advance one step. `want[side]` is true when that side tapped this step. A tap
 * only throws when the side can (match running, sword reloaded).
 */
export function advance(s: State, dt: number, want: readonly [boolean, boolean]): Event[] {
  const ev: Event[] = []
  if (s.left <= 0) return ev
  const before = Math.ceil(s.left)
  s.left = Math.max(0, s.left - dt)
  s.t += dt
  if (s.left > 0 && Math.ceil(s.left) < before && s.left <= 5) {
    ev.push({ kind: 'tick', left: Math.ceil(s.left) })
  }
  for (const side of [0, 1] as Side[]) {
    s.sway[side] += SWAY_RATE * dt
    s.reload[side] = Math.max(0, s.reload[side] - dt)
  }
  for (const sh of s.shields) {
    // Spins faster as the match goes on.
    sh.rot += sh.dir * (1.2 + 0.9 * (s.t / MATCH)) * dt
    sh.ph += WANDER_RATE * dt
    sh.x = W / 2 + WANDER * Math.sin(sh.ph)
  }
  for (const side of [0, 1] as Side[]) {
    if (want[side] && canThrow(s, side)) ev.push(throwSword(s, side))
  }
  for (let i = s.swords.length - 1; i >= 0; i--) {
    const sw = s.swords[i] as Sword
    if (sw.drop) {
      sw.t += dt
      sw.x += sw.vx * dt
      sw.y += sw.vy * dt
      sw.vx *= Math.exp(-4 * dt)
      sw.vy *= Math.exp(-4 * dt)
      if (sw.t > 0.8) s.swords.splice(i, 1)
      continue
    }
    sw.x += sw.vx * dt
    sw.y += sw.vy * dt
    if (sweep(s, i, ev)) continue
    if (sw.x < -150 || sw.x > W + 150 || sw.y < -150 || sw.y > 1950) {
      ev.push({ kind: 'miss', side: sw.side, x: sw.x, y: sw.y })
      s.swords.splice(i, 1)
    }
  }
  return ev
}

/**
 * Check a flying sword against both shields. Returns true when it stopped at one
 * (stuck, clanged), so the caller stops moving it.
 */
function sweep(s: State, i: number, ev: Event[]): boolean {
  const sw = s.swords[i] as Sword
  for (const k of [0, 1] as Side[]) {
    const sh = s.shields[k] as Shield
    const dx = sw.x - sh.x
    const dy = sw.y - sh.y
    const d = Math.hypot(dx, dy)
    if (d > REACH) continue
    const own = k === sw.side
    const theta = Math.atan2(dy, dx)
    if (own || clangsAt(sh, theta)) {
      clang(sw, dx / (d || 1), dy / (d || 1))
      sh.clangT = s.t
      s.react[sw.side] = { t: s.t, k: own ? 'own' : 'clang' }
      ev.push({ kind: 'clang', side: sw.side, x: sw.x, y: sw.y, own })
      return true
    }
    s.swords.splice(i, 1)
    sh.stuck.push({ a: theta - sh.rot, t: s.t })
    sh.hitT = s.t
    s.react[sw.side] = { t: s.t, k: 'stick' }
    s.score[sw.side]++
    ev.push({
      kind: 'stick',
      side: sw.side,
      shield: k,
      x: sw.x,
      y: sw.y,
      count: s.score[sw.side],
    })
    if (sh.stuck.length >= CAP) {
      // Full: every stuck sword tumbles off the rim and the shield starts again.
      for (const st of sh.stuck) {
        const th = sh.rot + st.a
        s.swords.push({
          side: sw.side,
          x: sh.x + Math.cos(th) * REACH,
          y: sh.y + Math.sin(th) * REACH,
          vx: Math.cos(th) * 240,
          vy: Math.sin(th) * 240,
          drop: true,
          t: 0,
        })
      }
      sh.stuck = []
      sh.clearT = s.t
      s.react[sw.side] = { t: s.t, k: 'clear' }
      ev.push({ kind: 'clear', shield: k, x: sh.x, y: sh.y })
    }
    return true
  }
  return false
}

/**
 * After the final whistle: the shields spin down, flying swords lose their
 * bite and drop, loose swords finish tumbling. Purely for the ending; no score
 * changes.
 */
export function coast(s: State, dt: number): void {
  s.after += dt
  const spin = (1.2 + 0.9) * Math.exp(-2.2 * s.after)
  for (const sh of s.shields) sh.rot += sh.dir * spin * dt
  for (let i = s.swords.length - 1; i >= 0; i--) {
    const sw = s.swords[i] as Sword
    if (!sw.drop) {
      sw.drop = true
      sw.t = 0
      sw.vx *= 0.25
      sw.vy *= 0.25
    }
    sw.t += dt
    sw.x += sw.vx * dt
    sw.y += sw.vy * dt
    sw.vx *= Math.exp(-4 * dt)
    sw.vy *= Math.exp(-4 * dt)
    if (sw.t > 0.8) s.swords.splice(i, 1)
  }
}

/** Bounce a sword off a surface with unit normal (nx, ny): reflect and damp. */
function clang(sw: Sword, nx: number, ny: number): void {
  const dot = sw.vx * nx + sw.vy * ny
  sw.vx = (sw.vx - 2 * dot * nx) * 0.35
  sw.vy = (sw.vy - 2 * dot * ny) * 0.35
  sw.drop = true
  sw.t = 0
}

/** Who has stuck the most swords when time runs out; null when tied. */
export function leader(s: State): Side | null {
  const [r, b] = s.score
  if (r === b) return null
  return r > b ? 0 : 1
}
