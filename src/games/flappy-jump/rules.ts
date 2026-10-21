import type { Side } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules, lane-local units (a lane is 1000 × 900). Heights are world units
 * above the start platform; `BASE_Y` is where that platform sits on screen
 * while the camera is at 0. The camera only ever rises, so a climber that
 * sinks below it falls out of the bottom of its half.
 */

/** Screen y (lane-local) of height 0 while the camera is still at 0. */
export const BASE_Y = 780
/** The camera follows once the climber is this far above the start. */
export const FOLLOW = 380
/** Out once the feet are this far below the camera's floor. */
export const OUT_BELOW = 160
export const GRAV = 1900
export const BOUNCE = 1200
/** A landing dead centre adds this much to the bounce; a landing on the edge adds none. */
export const CENTRE_BONUS = 0.12
/** Horizontal speed when steering flat out, and how quickly it is reached. */
export const SPEED_X = 460
export const ACCEL = 9
/** Half-width of the kangaroo's feet. */
export const CW = 30
export const PLAT_W = 150
export const PLAT_GAP = 240
/** A broken platform crumbles this long after the first bounce on it. */
export const CRUMBLE = 0.25
/** The match is decided by height after this long. */
export const ROUND_T = 60

export type PlatKind = 'solid' | 'move' | 'break'

export interface Plat {
  i: number
  /** Top surface height. */
  h: number
  /** Centre x (at time 0 for moving platforms; see platX). */
  x: number
  amp: number
  phase: number
  kind: PlatKind
}

export interface Climber {
  /** Feet height above the start platform. */
  h: number
  vh: number
  /** Lane x of the centre, wrapped to 0..1000. */
  x: number
  vx: number
  /** Highest point reached. */
  top: number
  /** Highest platform index reached: a new one is a milestone. */
  best: number
  /** Camera floor: the view never sinks below it. */
  cam: number
  /** Breaking platforms bounced on, and when. */
  crumble: [number, number][]
  alive: boolean
  landAt: number
  deadAt: number
  /** When the last new platform was reached (the counter bumps). */
  scoreAt: number
}

export type ClimbEvent = 'bounce' | 'crumble' | 'best' | 'out'

export function newClimber(x = 500): Climber {
  return {
    h: 0,
    vh: 0,
    x,
    vx: 0,
    top: 0,
    best: 0,
    cam: 0,
    crumble: [],
    alive: true,
    landAt: -10,
    deadAt: -1,
    scoreAt: -10,
  }
}

export function wrapX(x: number): number {
  return ((x % 1000) + 1000) % 1000
}

/** Signed horizontal distance from b to a, the short way round the wrap. */
export function wrapDelta(a: number, b: number): number {
  return ((((a - b) % 1000) + 1500) % 1000) - 500
}

/**
 * Centre x of platform i: a smooth wave with a little jitter, so that two
 * platforms in a row are never far apart across the lane (a bounce can always
 * reach the next one).
 */
function courseX(seed: number, i: number): number {
  const phase = hash01(seed, 0, 4) * Math.PI * 2
  const wave = 280 * Math.sin(i * 0.6 + phase)
  const jitter = (hash01(seed, i, 4) * 2 - 1) * 60
  return Math.max(180, Math.min(820, 500 + wave + jitter))
}

export function platformAt(seed: number, i: number): Plat {
  if (i === 0) return { i, h: 0, x: 500, amp: 0, phase: 0, kind: 'solid' }
  const h = i * PLAT_GAP + (hash01(seed, i, 3) * 2 - 1) * 40
  const roll = hash01(seed, i, 2)
  // The first few are always solid, so the climb starts fair.
  const kind: PlatKind = i < 3 ? 'solid' : roll < 0.15 ? 'move' : roll < 0.3 ? 'break' : 'solid'
  const amp = kind === 'move' ? 60 + hash01(seed, i, 5) * 90 : 0
  return {
    i,
    h,
    x: courseX(seed, i),
    amp,
    phase: hash01(seed, i, 8) * Math.PI * 2,
    kind,
  }
}

/** Centre x of a platform at time `t`. */
export function platX(p: Plat, t: number): number {
  return p.kind === 'move' ? p.x + p.amp * Math.sin(t * 0.9 + p.phase) : p.x
}

/** Platforms whose top lies within [h0, h1]. */
export function platformsBetween(seed: number, h0: number, h1: number): Plat[] {
  const out: Plat[] = []
  const i0 = Math.max(0, Math.floor(h0 / PLAT_GAP) - 1)
  const i1 = Math.max(0, Math.ceil(h1 / PLAT_GAP) + 1)
  for (let i = i0; i <= i1; i++) {
    const p = platformAt(seed, i)
    if (p.h >= h0 && p.h <= h1) out.push(p)
  }
  return out
}

/** Is the platform still there for landing? A broken one is gone once it has crumbled. */
export function solidFor(c: Climber, p: Plat, now: number): boolean {
  if (p.kind !== 'break') return true
  return !c.crumble.some(([i, t]) => i === p.i && now - t >= CRUMBLE)
}

/** Feet below the camera's floor by more than OUT_BELOW. */
export function fellOut(c: Climber): boolean {
  return c.h - c.cam < -OUT_BELOW
}

/** A dead kangaroo drops out of the bottom of the view. */
export function fallDead(c: Climber, dt: number): void {
  c.vh -= GRAV * dt
  c.h += c.vh * dt
}

/** Steering: `dir` in [-1, 1], from a held finger or a bot. */
export function stepClimber(
  seed: number,
  c: Climber,
  dt: number,
  now: number,
  dir: number,
): ClimbEvent[] {
  const ev: ClimbEvent[] = []
  if (!c.alive) {
    fallDead(c, dt)
    return ev
  }
  const steer = Math.max(-1, Math.min(1, dir))
  c.vx += (steer * SPEED_X - c.vx) * Math.min(1, ACCEL * dt)
  c.x = wrapX(c.x + c.vx * dt)
  const prev = c.h
  c.vh -= GRAV * dt
  c.h += c.vh * dt
  if (c.vh < 0) {
    for (const p of platformsBetween(seed, c.h - 20, prev + 20)) {
      if (!(prev >= p.h && c.h <= p.h)) continue
      const off = Math.abs(wrapDelta(c.x, platX(p, now))) / (PLAT_W / 2 + CW)
      if (off > 1) continue
      if (!solidFor(c, p, now)) continue
      c.h = p.h
      c.vh = BOUNCE * (1 + CENTRE_BONUS * (1 - off))
      c.landAt = now
      ev.push('bounce')
      if (p.kind === 'break') {
        c.crumble.push([p.i, now])
        c.crumble = c.crumble.filter(([, t]) => now - t < 2)
        ev.push('crumble')
      }
      if (p.i > c.best) {
        c.best = p.i
        c.scoreAt = now
        ev.push('best')
      }
      break
    }
  }
  c.top = Math.max(c.top, c.h)
  c.cam = Math.max(c.cam, c.h - FOLLOW)
  if (fellOut(c)) {
    c.alive = false
    c.deadAt = now
    c.vh = Math.min(c.vh, 0)
    ev.push('out')
  }
  return ev
}

/** Metres, for the HUD and the result (a platform is 24 m). */
export function metres(c: Climber): number {
  return Math.floor(c.top / 10)
}

/**
 * Decide the match once something is settled: a climber out (the other one
 * wins), or the time is up (highest wins). Null while both still climb.
 * `limit` is the match length in seconds (the chosen one, else `ROUND_T`).
 */
export function judge(a: Climber, b: Climber, t: number, limit = ROUND_T): Side | 'draw' | null {
  if (!a.alive && !b.alive) {
    if (a.top === b.top) return 'draw'
    return a.top > b.top ? 0 : 1
  }
  if (!a.alive) return 1
  if (!b.alive) return 0
  if (t >= limit) {
    if (a.top === b.top) return 'draw'
    return a.top > b.top ? 0 : 1
  }
  return null
}
