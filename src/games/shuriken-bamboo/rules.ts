import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'

/**
 * Pure shuriken bamboo. Stalks grow in a band across the middle, sway, and can
 * be sliced by a shuriken flying at shuriken height: the top falls, the stump
 * stays and the stalk grows back. Golden stalks are worth three. Each player
 * swipes from their own edge; the swipe's direction is the throw. No DOM.
 */

export const MATCH = 45
/** Seconds between one player's throws. */
export const COOL = 0.7
/** Flight speed of a medium throw; a lazy swipe flies at 70% of it, a hard flick at 130%. */
export const SHURI_SPEED = 1500
/** A flick at least this hard cuts clean through its first stalk and flies on to a second. */
export const PIERCE = 0.8

/** Flight speed for a throw of this power (0..1). */
export function speedOf(power: number): number {
  return SHURI_SPEED * (0.7 + 0.6 * Math.max(0, Math.min(1, power)))
}
/** Height the shuriken flies at (world units above the ground). */
export const SHURI_Z = 110
/** A stalk must be at least this tall for a shuriken to slice it. */
export const HIT_H = 150
/** Stump height after a slice (the shuriken's height, so the cut is clean). */
export const STUMP = SHURI_Z
/** Full height and the seconds it takes to grow there. */
export const FULL = 600
export const GROW_TIME = 3.4
/** Seconds a stump waits before the stalk grows back. */
export const REGROW = 2.0
/** Ground radius of a stalk for collisions. */
export const HIT_R = 24
/** Share of regrowing stalks that come up golden. */
export const GOLD = 0.16
/** The last seconds of a match are a bamboo rush: faster growth, quicker regrowth, more gold. */
export const RUSH = 12
export const RUSH_GROW = 1.7
export const RUSH_GOLD = 0.3
/** Where each side's shurikens leave from: a line at its own end. */
export const THROW_Y: readonly number[] = [1560, 240]
/** Stalk positions: a staggered band across the middle; the clock sits in the gap. */
export const SLOTS: readonly { x: number; y: number }[] = [
  { x: 170, y: 660 },
  { x: 400, y: 660 },
  { x: 630, y: 660 },
  { x: 860, y: 660 },
  { x: 260, y: 900 },
  { x: 740, y: 900 },
  { x: 140, y: 1140 },
  { x: 370, y: 1140 },
  { x: 600, y: 1140 },
  { x: 830, y: 1140 },
]

export interface Stalk {
  x: number
  y: number
  h: number
  gold: boolean
  /** growing: rising to FULL. up: full height. stump: cut, waiting to regrow. */
  state: 'grow' | 'up' | 'stump'
  /** Seconds left in the stump state. */
  wait: number
  /** Phase of the sway. */
  ph: number
}

export interface Shuri {
  side: Side
  x: number
  y: number
  dx: number
  dy: number
  spin: number
  /** Seconds in flight. */
  t: number
  /** Flight speed (units/s); SHURI_SPEED when absent. */
  v?: number
  /** Stalks it may still cut through and keep flying (a hard flick). */
  pierce?: number
  /** Stalks it has sliced so far. */
  cuts?: number
}

/** A top that was sliced off, falling away from the shuriken's path. */
export interface Fallen {
  x: number
  y: number
  /** Height the cut happened at, and the full height of the piece. */
  from: number
  to: number
  fx: number
  fy: number
  gold: boolean
  t: number
  /** Who sliced it (the slash is drawn in their colour). */
  side: Side
}

export interface State {
  /** Seconds left in the match. */
  left: number
  /** Seconds since the start. */
  t: number
  stalks: Stalk[]
  shuris: Shuri[]
  fallen: Fallen[]
  /** Points for each side. */
  score: [number, number]
  /** Seconds until each side may throw again. */
  cool: [number, number]
  /** The swipe each side is holding right now (drawn as a preview). */
  aiming: [Preview | null, Preview | null]
  /** Where each ninja stands on its line, where it dashed from, and when (match time). */
  at: [number, number]
  from: [number, number]
  moveT: [number, number]
  /** Match time of each side's last throw (for the flick). */
  throwT: [number, number]
}

/** A swipe in progress: where it starts on the thrower's line, and its unit direction. */
export interface Preview {
  x: number
  dx: number
  dy: number
  /** How hard the finger is moving right now (0..1). */
  power?: number
}

/** A throw: where it leaves the thrower's line, the unit direction it flies, and how hard (0..1, default 0.5). */
export interface Aim {
  x: number
  dx: number
  dy: number
  power?: number
}

export type Event =
  | { kind: 'throw'; side: Side; x: number; y: number; power: number }
  | {
      kind: 'slice'
      side: Side
      x: number
      y: number
      gold: boolean
      points: number
      /** 1 for the first stalk this shuriken cut, 2 for the second (a pierce). */
      combo: number
      power: number
    }
  | { kind: 'miss'; side: Side; x: number; y: number }
  | { kind: 'tick'; left: number }
  | { kind: 'rush' }

export function newState(rng: Rng, seconds = MATCH): State {
  return {
    left: seconds,
    t: 0,
    // Start mid-growth, so the band is never empty at the first swipe.
    stalks: SLOTS.map((p) => ({
      x: p.x + rng.range(-24, 24),
      y: p.y + rng.range(-24, 24),
      h: rng.range(0, FULL * 0.9),
      gold: rng.chance(GOLD),
      state: 'grow' as const,
      wait: 0,
      ph: rng.range(0, Math.PI * 2),
    })),
    shuris: [],
    fallen: [],
    score: [0, 0],
    cool: [0, 0],
    aiming: [null, null],
    at: [W / 2, W / 2],
    from: [W / 2, W / 2],
    moveT: [-9, -9],
    throwT: [-9, -9],
  }
}

/** Is a stalk in a state where a shuriken can slice it? */
export function sliceable(st: Stalk): boolean {
  return st.state !== 'stump' && st.h >= HIT_H
}

/** Points one slice of this stalk is worth. */
export function valueOf(st: Stalk): number {
  return st.gold ? 3 : 1
}

/** Clamp a throw's origin to the stretch of the line the player can reach. */
export function originX(x: number): number {
  return Math.max(120, Math.min(W - 120, x))
}

export function canThrow(s: State, side: Side): boolean {
  return s.left > 0 && (s.cool[side] ?? 0) <= 0
}

/**
 * Advance one step. `aims[side]`, when given, is a throw by that side this step;
 * it only leaves when the side's cooldown is over and the match still runs.
 */
export function advance(
  s: State,
  dt: number,
  aims: readonly [Aim | null, Aim | null],
  rng: Rng,
): Event[] {
  const ev: Event[] = []
  if (s.left <= 0) return ev
  const before = Math.ceil(s.left)
  s.left = Math.max(0, s.left - dt)
  s.t += dt
  if (s.left > 0 && Math.ceil(s.left) < before && s.left <= 5) {
    ev.push({ kind: 'tick', left: Math.ceil(s.left) })
  }
  const rush = s.left <= RUSH
  if (rush && s.left + dt > RUSH) ev.push({ kind: 'rush' })
  for (const st of s.stalks) growStalk(st, dt, rng, rush)
  for (const side of [0, 1] as Side[]) {
    s.cool[side] = Math.max(0, s.cool[side] - dt)
    const aim = aims[side]
    if (aim && canThrow(s, side)) {
      const y = THROW_Y[side] ?? 0
      const power = Math.max(0, Math.min(1, aim.power ?? 0.5))
      s.shuris.push({
        side,
        x: originX(aim.x),
        y,
        dx: aim.dx,
        dy: aim.dy,
        spin: 0,
        t: 0,
        v: speedOf(power),
        pierce: power >= PIERCE ? 1 : 0,
        cuts: 0,
      })
      s.cool[side] = COOL
      const x = originX(aim.x)
      if (Math.abs(x - s.at[side]) > 1) {
        s.from[side] = s.at[side]
        s.at[side] = x
        s.moveT[side] = s.t
      }
      s.throwT[side] = s.t
      ev.push({ kind: 'throw', side, x, y, power })
    }
  }
  // Two substeps, each swept along the shuriken's path: a fast one never skips a stalk.
  for (let k = 0; k < 2; k++) {
    for (let i = s.shuris.length - 1; i >= 0; i--) {
      const sh = s.shuris[i]
      if (!sh) continue
      const h = dt / 2
      const v = sh.v ?? SHURI_SPEED
      const x0 = sh.x
      const y0 = sh.y
      sh.x += sh.dx * v * h
      sh.y += sh.dy * v * h
      sh.spin += 26 * h * (v / SHURI_SPEED)
      sh.t += h
      const hit = stalkOnPath(s, x0, y0, sh.x, sh.y)
      if (hit) {
        const pts = valueOf(hit)
        const top = hit.h
        s.fallen.push({
          x: hit.x,
          y: hit.y,
          from: STUMP,
          to: top,
          fx: sh.dx,
          fy: sh.dy,
          gold: hit.gold,
          t: 0,
          side: sh.side,
        })
        hit.state = 'stump'
        hit.h = STUMP
        hit.wait = REGROW
        s.score[sh.side] += pts
        sh.cuts = (sh.cuts ?? 0) + 1
        ev.push({
          kind: 'slice',
          side: sh.side,
          x: hit.x,
          y: hit.y,
          gold: hit.gold,
          points: pts,
          combo: sh.cuts,
          power: (v / SHURI_SPEED - 0.7) / 0.6,
        })
        // A hard flick cuts clean through and flies on; otherwise it sticks.
        if ((sh.pierce ?? 0) > 0) sh.pierce = (sh.pierce ?? 0) - 1
        else {
          s.shuris.splice(i, 1)
          continue
        }
      }
      if (sh.x < -120 || sh.x > W + 120 || sh.y < -120 || sh.y > 1920) {
        ev.push({ kind: 'miss', side: sh.side, x: sh.x, y: sh.y })
        s.shuris.splice(i, 1)
      }
    }
  }
  for (let i = s.fallen.length - 1; i >= 0; i--) {
    const f = s.fallen[i]
    if (!f) continue
    f.t += dt
    if (f.t > 0.9) s.fallen.splice(i, 1)
  }
  return ev
}

function growStalk(st: Stalk, dt: number, rng: Rng, rush = false): void {
  st.ph += dt
  const k = rush ? RUSH_GROW : 1
  if (st.state === 'grow') {
    st.h += (FULL / GROW_TIME) * k * dt
    if (st.h >= FULL) {
      st.h = FULL
      st.state = 'up'
    }
  } else if (st.state === 'stump') {
    st.wait -= dt * k
    if (st.wait <= 0) {
      st.state = 'grow'
      st.h = 0
      st.gold = rng.chance(rush ? RUSH_GOLD : GOLD)
    }
  }
}

/** Distance from (px, py) to the segment a-b, and how far along it (0..1) the nearest point is. */
function segHit(px: number, py: number, ax: number, ay: number, bx: number, by: number): number[] {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return [Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t]
}

/** The first sliceable stalk the segment a-b passes through, nearest a first. */
function stalkOnPath(s: State, ax: number, ay: number, bx: number, by: number): Stalk | null {
  let best: Stalk | null = null
  let bt = Infinity
  for (const st of s.stalks) {
    if (!sliceable(st)) continue
    const [d = Infinity, t = 0] = segHit(st.x, st.y, ax, ay, bx, by)
    if (d < HIT_R && t < bt) {
      bt = t
      best = st
    }
  }
  return best
}

/**
 * The stalks a throw would cut as the table stands now, in order (one, or two
 * for a piercing flick), and how long until the first is reached (s).
 */
export function pathOf(
  s: State,
  side: Side,
  aim: Aim,
  /** Start the flight here instead of the thrower's line (a shuriken already in the air). */
  from?: { x: number; y: number },
): { cut: Stalk[]; eta: number } {
  const power = Math.max(0, Math.min(1, aim.power ?? 0.5))
  const x0 = from ? from.x : originX(aim.x)
  const y0 = from ? from.y : (THROW_Y[side] ?? 0)
  const far = 2400
  const hits: { st: Stalk; t: number }[] = []
  for (const st of s.stalks) {
    if (!sliceable(st)) continue
    const [d = Infinity, t = 0] = segHit(st.x, st.y, x0, y0, x0 + aim.dx * far, y0 + aim.dy * far)
    if (d < HIT_R && t > 0) hits.push({ st, t })
  }
  hits.sort((a, b) => a.t - b.t)
  const cut = hits.slice(0, power >= PIERCE ? 2 : 1).map((h) => h.st)
  const eta = hits[0] ? (hits[0].t * far) / speedOf(power) : Infinity
  return { cut, eta }
}

/** Sway of a stalk's top, in world units, for drawing only. */
export function swayOf(st: Stalk, t: number): number {
  return Math.sin(t * 1.3 + st.ph) * 14 * Math.min(1, st.h / FULL)
}

/** Points each side has; the leader, or null when tied. */
export function leader(s: State): Side | null {
  const [r, b] = s.score
  if (r === b) return null
  return r > b ? 0 : 1
}

/** Bamboo still standing that a shuriken could slice right now, most valuable first. */
export function targets(s: State): Stalk[] {
  return s.stalks.filter(sliceable).sort((a, b) => valueOf(b) - valueOf(a))
}
