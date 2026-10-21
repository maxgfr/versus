import type { Side } from '../../core/game.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  collideDynamic,
  collideKinematic,
  collideWalls,
  type Contact,
  type Disc,
  integrate,
  rink,
} from '../../engines/puck/index.ts'

/**
 * Sling Puck: one table, split by a midline wall with a gap in the middle.
 * Each side has an elastic band stretched across its end of the table. Grab
 * one of your pucks, drag it back against your band, stretch it and let go:
 * the band fires the puck forward, angled toward the middle when you pull off
 * centre. Pucks only cross through the gap, and a puck belongs to the side
 * whose half it rests in. A side with no pucks in its half wins.
 *
 * Band geometry is written in red's frame (red's band near the bottom edge)
 * and mirrored for blue. Pure: no DOM, no Math.random.
 */

export const PUCK_R = 54
/** Width of the gap in the midline wall. */
export const GAP = 260
/** Thickness of the midline wall. */
export const WALL_T = 26
/** Exponential table friction: a shot at speed v travels about v / DRAG. */
export const DRAG = 1.25
export const SHOT_V = 2900
/** Red frame: the band's rest line and its two anchor posts. */
export const BAND_Y = 1490
export const BAND_X0 = 70
export const BAND_X1 = W - 70
/** How far behind its rest line the band stretches at most. */
export const MAX_PULL = 210
/** Stretch (as a fraction of MAX_PULL) below which letting go just drops the puck. */
export const MIN_POWER = 0.14
export const GRAB_R = 100
const E_PUCK = 0.9
const E_BAND = 0.85
const SUB = 4
/** Safety net against endless stalls: after this many seconds the side with fewer pucks wins. */
export const SAFETY_TIME = 120

export interface Puck extends Disc {
  /** Being dragged by a player: moved by the finger, not by physics. */
  held: boolean
  /** The half the puck is on right now (0 = red, bottom). Ownership follows it. */
  half: Side
}

export interface Aim {
  idx: number
  /** Pointer id of the finger holding the puck, or -1 for the computer. */
  ptr: number
  /** Puck centre minus finger at the grab, so the puck does not jump under the finger. */
  ox: number
  oy: number
}

export interface Table {
  pucks: Puck[]
  aims: [Aim | null, Aim | null]
  t: number
  /** Last shot per side (game time and power), for the band's twang animation. */
  shots: [{ at: number; power: number; x: number }, { at: number; power: number; x: number }]
}

export type Event =
  | { kind: 'grab'; side: Side; x: number; y: number }
  | { kind: 'shot'; side: Side; x: number; y: number; power: number }
  | { kind: 'hit'; x: number; y: number; speed: number }
  | { kind: 'wall'; x: number; y: number; speed: number }
  | { kind: 'post'; x: number; y: number; speed: number }
  | { kind: 'band'; side: Side; x: number; y: number; speed: number }
  | { kind: 'cross'; to: Side; x: number; y: number }

/** What a side does this step: grab a puck, move the finger, let go. */
export interface Cmd {
  grab?: { idx: number; ptr: number; x?: number; y?: number }
  finger?: { x: number; y: number }
  release?: boolean
}

const arena = rink({ x0: 0, y0: 0, x1: W, y1: H, corner: 0, goal: 0 })
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/** World ↔ red-frame coordinates for `side` (blue is rotated 180° about the centre). */
export const local = (side: Side, x: number, y: number): { x: number; y: number } =>
  side === 0 ? { x, y } : { x: W - x, y: H - y }

/** Line the puck centre rests against when it touches the band (red frame). */
const restY = (r: number) => BAND_Y - r

/** How far a puck at red-frame y stretches the band, 0 when it does not touch it. */
export const stretchAt = (y: number, r = PUCK_R): number => Math.max(0, y - restY(r))

/**
 * Where the band would fire a puck held at red-frame (x, y): the sum of the
 * pulls toward its two anchors (so an off-centre pull angles toward the middle),
 * and the power 0..1 from the stretch.
 */
export function shotFrom(
  x: number,
  y: number,
  r = PUCK_R,
): { dx: number; dy: number; power: number } {
  const ax = BAND_X0 - x
  const bx = BAND_X1 - x
  const ay = BAND_Y - y
  const la = Math.hypot(ax, ay) || 1
  const lb = Math.hypot(bx, ay) || 1
  let dx = ax / la + bx / lb
  let dy = ay / la + ay / lb
  const m = Math.hypot(dx, dy)
  if (m < 1e-6) {
    dx = 0
    dy = -1
  } else {
    dx /= m
    dy /= m
  }
  return { dx, dy, power: Math.min(1, stretchAt(y, r) / MAX_PULL) }
}

/** Bottom-of-world positions for red's pucks, mirrored for blue. */
export function newTable(n: number, rng?: { next(): number }): Table {
  const pucks: Puck[] = []
  const top = Math.ceil(n / 2)
  for (const side of [0, 1] as Side[]) {
    for (let i = 0; i < n; i++) {
      const row = i < top ? 0 : 1
      const k = row === 0 ? i : i - top
      const count = row === 0 ? top : n - top
      const jitter = rng ? (rng.next() - 0.5) * 24 : 0
      const spread = Math.min(180, 820 / Math.max(1, count))
      const x = W / 2 + (k - (count - 1) / 2) * spread + jitter
      const y0 = row === 0 ? 1170 : 1340
      const p = local(side, x, y0)
      pucks.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: PUCK_R, held: false, half: side })
    }
  }
  const shot = { at: -10, power: 0, x: W / 2 }
  return { pucks, aims: [null, null], t: 0, shots: [{ ...shot }, { ...shot }] }
}

/** Pucks a side owns: those resting on its half. */
export const owned = (t: Table, side: Side): number => t.pucks.filter((p) => p.half === side).length

/** The side's puck nearest (x, y) within the grab radius, not already held. */
export function grabIndex(t: Table, side: Side, x: number, y: number): number {
  let best = -1
  let bd = GRAB_R * GRAB_R
  t.pucks.forEach((p, i) => {
    if (p.half !== side || p.held) return
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d <= bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** Keep a held puck in its owner's half: clear of the midline wall, at most a full stretch back. */
function clampHeld(p: Puck, side: Side): void {
  const l = local(side, p.x, p.y)
  l.y = clamp(l.y, MID + p.r + WALL_T / 2, restY(p.r) + MAX_PULL)
  // While the band is stretched the puck stays between its anchors.
  const lo = l.y > restY(p.r) ? BAND_X0 + p.r * 0.6 : p.r
  const hi = l.y > restY(p.r) ? BAND_X1 - p.r * 0.6 : W - p.r
  l.x = clamp(l.x, lo, hi)
  const w = local(side, l.x, l.y)
  p.x = w.x
  p.y = w.y
}

export function startAim(
  t: Table,
  side: Side,
  idx: number,
  ptr: number,
  events: Event[],
  at?: { x: number; y: number },
): void {
  const p = t.pucks[idx]
  if (!p || p.half !== side || p.held || t.aims[side]) return
  p.held = true
  p.vx = 0
  p.vy = 0
  const f = at ?? { x: p.x, y: p.y }
  t.aims[side] = { idx, ptr, ox: p.x - f.x, oy: p.y - f.y }
  events.push({ kind: 'grab', side, x: p.x, y: p.y })
}

/** The finger moved: the held puck follows it (velocity kept for kinematic pushes). */
export function moveAim(t: Table, side: Side, fx: number, fy: number, dt = 0): void {
  const aim = t.aims[side]
  const p = aim ? t.pucks[aim.idx] : undefined
  if (!aim || !p) return
  const x0 = p.x
  const y0 = p.y
  p.x = fx + aim.ox
  p.y = fy + aim.oy
  clampHeld(p, side)
  if (dt > 0) {
    p.vx = (p.x - x0) / dt
    p.vy = (p.y - y0) / dt
  }
}

/** Let go: a stretched band fires the puck, otherwise it is just set down. */
export function releaseAim(t: Table, side: Side, events: Event[]): void {
  const aim = t.aims[side]
  if (!aim) return
  t.aims[side] = null
  const p = t.pucks[aim.idx]
  if (!p) return
  p.held = false
  p.vx = 0
  p.vy = 0
  const l = local(side, p.x, p.y)
  const shot = shotFrom(l.x, l.y, p.r)
  if (shot.power < MIN_POWER) {
    // Set down in front of the band.
    l.y = Math.min(l.y, restY(p.r))
    const w = local(side, l.x, l.y)
    p.x = w.x
    p.y = w.y
    return
  }
  const d = local(side, shot.dx + W / 2, shot.dy + H / 2)
  fire(t, side, aim.idx, d.x - W / 2, d.y - H / 2, shot.power, events)
}

/** Launch a puck in a world unit direction at a power in 0..1. */
export function fire(
  t: Table,
  side: Side,
  idx: number,
  dx: number,
  dy: number,
  power: number,
  events: Event[],
): void {
  const p = t.pucks[idx]
  if (!p) return
  const v = SHOT_V * clamp(power, 0, 1)
  p.held = false
  p.vx = dx * v
  p.vy = dy * v
  t.shots[side] = { at: t.t, power, x: local(side, p.x, p.y).x }
  events.push({ kind: 'shot', side, x: p.x, y: p.y, power })
}

export function applyCmd(t: Table, side: Side, cmd: Cmd, events: Event[], dt = 0): void {
  if (cmd.grab && !t.aims[side]) {
    const at =
      cmd.grab.x !== undefined && cmd.grab.y !== undefined
        ? { x: cmd.grab.x, y: cmd.grab.y }
        : undefined
    startAim(t, side, cmd.grab.idx, cmd.grab.ptr, events, at)
  }
  if (t.aims[side] && cmd.finger) moveAim(t, side, cmd.finger.x, cmd.finger.y, dt)
  if (t.aims[side] && cmd.release) releaseAim(t, side, events)
}

/** Midline wall: solid except the gap; its two ends are round posts. */
function collideMidline(p: Puck, events: Event[]): void {
  const band = p.r + WALL_T / 2
  const gapL = W / 2 - GAP / 2
  const gapR = W / 2 + GAP / 2
  for (const px of [gapL, gapR]) {
    const post: Disc = { x: px, y: MID, vx: 0, vy: 0, r: WALL_T / 2 }
    const c = collideKinematic(p, post, 0.8)
    if (c) events.push({ kind: 'post', x: c.x, y: c.y, speed: c.speed })
  }
  // Over the gap only the posts matter, and they were handled above.
  if (Math.abs(p.x - W / 2) < GAP / 2) return
  if (Math.abs(p.y - MID) >= band) return
  const sgn = p.y < MID ? -1 : 1
  p.y = MID + sgn * band
  if (p.vy * sgn < 0) {
    const speed = Math.abs(p.vy)
    p.vy = -p.vy * 0.8
    if (speed > 60) events.push({ kind: 'wall', x: p.x, y: p.y, speed })
  }
}

/** A free puck bounces off either band, which keeps it in front of the band. */
function collideBands(p: Puck, events: Event[]): void {
  for (const side of [0, 1] as Side[]) {
    const l = local(side, p.x, p.y)
    const lim = restY(p.r)
    if (l.y <= lim) continue
    // Local velocity: blue's frame is rotated, so both components flip.
    const s = side === 0 ? 1 : -1
    const vy = p.vy * s
    l.y = lim
    const w = local(side, l.x, l.y)
    p.y = w.y
    if (vy > 0) {
      p.vy = -p.vy * E_BAND
      if (vy > 80) events.push({ kind: 'band', side, x: p.x, y: p.y, speed: vy })
    }
  }
}

/** Advance the table by dt. */
export function step(t: Table, dt: number, events: Event[]): void {
  t.t += dt
  const h = dt / SUB
  for (let s = 0; s < SUB; s++) {
    for (const p of t.pucks) {
      if (p.held) continue
      integrate(p, h, DRAG)
      if (p.vx * p.vx + p.vy * p.vy < 16) {
        p.vx = 0
        p.vy = 0
      }
    }
    for (const p of t.pucks) {
      if (p.held) continue
      const c: Contact | null = collideWalls(p, arena, 0.8)
      if (c && c.speed > 60) events.push({ kind: 'wall', x: c.x, y: c.y, speed: c.speed })
      collideMidline(p, events)
      collideBands(p, events)
    }
    for (let i = 0; i < t.pucks.length; i++) {
      for (let j = i + 1; j < t.pucks.length; j++) {
        const a = t.pucks[i]
        const b = t.pucks[j]
        if (!a || !b || (a.held && b.held)) continue
        const c = a.held
          ? collideKinematic(b, a, 0.9)
          : b.held
            ? collideKinematic(a, b, 0.9)
            : collideDynamic(a, b, 1, 1, E_PUCK)
        if (c && c.speed > 80) events.push({ kind: 'hit', x: c.x, y: c.y, speed: c.speed })
      }
    }
  }
  for (const p of t.pucks) {
    if (p.held) {
      // A held puck pushes others with its finger speed only for this step.
      p.vx = 0
      p.vy = 0
      continue
    }
    const half: Side = p.y > MID ? 0 : 1
    if (half !== p.half) {
      p.half = half
      events.push({ kind: 'cross', to: half, x: p.x, y: p.y })
    }
  }
}

/** The side that has emptied its half, if any. */
export function winner(t: Table): Side | 'draw' | null {
  const red = owned(t, 0)
  const blue = owned(t, 1)
  if (red === 0 && blue === 0) return 'draw'
  if (red === 0) return 0
  if (blue === 0) return 1
  if (t.t >= SAFETY_TIME) {
    if (red !== blue) return red < blue ? 0 : 1
    return 'draw'
  }
  return null
}
