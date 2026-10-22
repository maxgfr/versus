import type { Side } from '../../core/game.ts'

/**
 * Frozen Penguins rules: two penguins slide on a round ice floe that melts a
 * little every second. Momentum carries them; a dash gives a burst with a
 * cooldown. A penguin whose centre passes the floe's edge falls in. The last
 * penguin on the ice wins the round. Pure functions, no DOM, no randomness.
 */

export const FLOE = { cx: 500, cy: 900 }
/** The floe's radius at the start, and how fast it melts (units / s). */
export const R0 = 450
export const SHRINK = 5.2
export const PR = 30
const ACCEL = 1250
const MAXV = 560
/** Low friction: a penguin keeps sliding (per second, exponential). */
const FRICTION = 0.7
export const DASH_V = 900
export const DASH_T = 0.2
export const DASH_CD = 2.4
/**
 * A dash's burst follows how hard the stick is pushed: a nudge is a short hop
 * (this share of a full dash), a full push the whole burst.
 */
export const DASH_MIN = 0.55

export interface Penguin {
  x: number
  y: number
  vx: number
  vy: number
  /** Facing (rad): the way it is moving. */
  a: number
  /** Dashing until this time (-9 = no). */
  dash: number
  /** Dash ready again at this time. */
  ready: number
  /** Time it fell into the sea (-1 = still on the ice). */
  fell: number
  /** Distance walked, for the waddle. */
  walk: number
  /** Time of the last bump (-9 = none), for the knocked look. */
  bumpT: number
}

export interface World {
  /** Seconds since the round began. */
  t: number
  p: [Penguin, Penguin]
}

export interface Drive {
  jx: number
  jy: number
  /** Dash button pressed this step. */
  press: boolean
}

export type Ev =
  /** `power` 0..1: how much of a full dash it was. */
  | { k: 'dash'; side: Side; x: number; y: number; power: number }
  | { k: 'bump'; x: number; y: number; speed: number }
  | { k: 'fall'; side: Side; x: number; y: number }

/**
 * The melt speeds up as the round goes on (units / s²), so a cautious round
 * still ends: the floe is gone a little after a minute instead of 86 s.
 */
export const MELT_ACC = 0.04

/** The floe's radius at round time t. */
export const floeR = (t: number): number => Math.max(0, R0 - SHRINK * t - MELT_ACC * t * t)

/** How far from the floe's centre a penguin is. */
export const distC = (p: { x: number; y: number }): number =>
  Math.hypot(p.x - FLOE.cx, p.y - FLOE.cy)

const spawn = (side: Side): Penguin => ({
  x: FLOE.cx,
  y: side === 0 ? FLOE.cy + 230 : FLOE.cy - 230,
  vx: 0,
  vy: 0,
  a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
  dash: -9,
  ready: 0,
  fell: -1,
  walk: 0,
  bumpT: -9,
})

export function newWorld(): World {
  return { t: 0, p: [spawn(0), spawn(1)] }
}

/** Advance the round by `dt`. `drives[side]` steers that penguin. Events go to `ev`. */
export function stepWorld(w: World, drives: readonly Drive[], dt: number, ev: Ev[]): void {
  w.t += dt
  const t = w.t
  for (const side of [0, 1] as Side[]) {
    const p = w.p[side]
    if (p.fell >= 0) continue
    const d = drives[side] ?? { jx: 0, jy: 0, press: false }
    const m = Math.min(1, Math.hypot(d.jx, d.jy))
    const len = Math.hypot(d.jx, d.jy) || 1
    const ux = m > 0.05 ? d.jx / len : 0
    const uy = m > 0.05 ? d.jy / len : 0
    if (d.press && t >= p.ready) {
      // The dash goes where the stick points, else where the penguin is moving.
      const sp = Math.hypot(p.vx, p.vy)
      const dx = m > 0.3 ? ux : sp > 20 ? p.vx / sp : Math.cos(p.a)
      const dy = m > 0.3 ? uy : sp > 20 ? p.vy / sp : Math.sin(p.a)
      // No stick at all: a full dash the way it slides (or faces).
      const power = m > 0.3 ? DASH_MIN + (1 - DASH_MIN) * Math.min(1, (m - 0.3) / 0.6) : 1
      p.vx += dx * DASH_V * power
      p.vy += dy * DASH_V * power
      p.dash = t + DASH_T
      p.ready = t + DASH_CD
      ev.push({ k: 'dash', side, x: p.x, y: p.y, power })
    }
    if (m > 0.05) {
      p.vx += ux * m * ACCEL * dt
      p.vy += uy * m * ACCEL * dt
    }
    const k = Math.exp(-FRICTION * dt)
    p.vx *= k
    p.vy *= k
    const cap = t < p.dash ? MAXV + DASH_V : MAXV
    const sp = Math.hypot(p.vx, p.vy)
    if (sp > cap) {
      p.vx *= cap / sp
      p.vy *= cap / sp
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    const v = Math.hypot(p.vx, p.vy)
    if (v > 25) p.a = Math.atan2(p.vy, p.vx)
    p.walk += v * dt
  }

  // Penguins bump each other (equal masses, springy).
  const [a, b] = w.p
  if (a.fell < 0 && b.fell < 0) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy)
    const min = PR * 2
    if (dist < min && dist > 0.001) {
      const nx = dx / dist
      const ny = dy / dist
      const push = (min - dist) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (vn < 0) {
        const j = -(1 + 0.9) * vn * 0.5
        a.vx -= j * nx
        a.vy -= j * ny
        b.vx += j * nx
        b.vy += j * ny
        a.bumpT = t
        b.bumpT = t
        ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed: -vn })
      }
    }
  }

  // The ice gives way under anyone whose middle is past the edge.
  const r = floeR(t)
  for (const side of [0, 1] as Side[]) {
    const p = w.p[side]
    if (p.fell >= 0) continue
    if (distC(p) > r + PR * 0.25) {
      p.fell = t
      ev.push({ k: 'fall', side, x: p.x, y: p.y })
    }
  }
}

/**
 * The round's winner: the penguin still on the ice. Both gone in the same
 * step is a draw. Null while both still stand.
 */
export function roundWinner(w: World): Side | 'draw' | null {
  const [a, b] = w.p
  const onA = a.fell < 0
  const onB = b.fell < 0
  if (onA && onB) return null
  if (!onA && !onB) return Math.abs(a.fell - b.fell) < 1e-9 ? 'draw' : a.fell > b.fell ? 0 : 1
  return onA ? 0 : 1
}
