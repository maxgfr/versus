import type { Side } from '../../core/game.ts'
import { collideDynamic, type Disc } from '../../engines/puck/index.ts'

/**
 * Sumo: heavy wrestlers in a round ring. Each one accelerates toward the
 * finger held for it; collisions shove, a double tap dashes. Out of the ring
 * loses the round. Pure physics and rules, no DOM.
 */

/** The ring (dohyo) in world units. */
export const RING = { x: 500, y: 900, r: 400 }
export const WRESTLER_R = 84
const MASS = 3
/** Top speed of a wrestler steered by a finger or the computer (world units / s). */
export const VMAX = 560
/** How quickly a wrestler turns its velocity toward the one it wants (per second). */
const STEER = 6
/** Glide: a wrestler that is not steered slows down slowly. */
const GLIDE = 1.6
export const DASH_SPEED = 950
export const DASH_COOL = 1.2
/** After this many seconds of fighting, the ring starts closing in, so no round can stall forever. */
export const SHRINK_AT = 12
export const SHRINK_RATE = 16
const SUB = 4
export const FRAME = 1 / 60

export interface Wrestler extends Disc {
  side: Side
  /** 2 vs 2: which lane of the side this wrestler owns (0 left, 1 right). */
  lane: 0 | 1
  /** Game time when the next dash is ready. */
  cool: number
}

export interface Pt {
  x: number
  y: number
}

/** Where a wrestler wants to go; null means no steering this frame. */
export type Target = Pt | null

export type Event =
  | { kind: 'hit'; speed: number; x: number; y: number }
  | { kind: 'dash'; side: Side; x: number; y: number; power: number }
  | { kind: 'out'; side: Side; x: number; y: number }

/** The ring's radius some seconds into a round. */
export function ringAt(fightTime: number): number {
  return Math.max(0, RING.r - Math.max(0, fightTime - SHRINK_AT) * SHRINK_RATE)
}

/** Wrestlers stand near their own edge, facing the middle: one each, or two each in 2 vs 2. */
export function spawn(lanes: 1 | 2): Wrestler[] {
  const out: Wrestler[] = []
  for (const side of [0, 1] as Side[]) {
    for (let lane = 0; lane < lanes; lane++) {
      const x = lanes === 1 ? RING.x : RING.x + (lane === 0 ? -150 : 150)
      const y = side === 0 ? RING.y + 200 : RING.y - 200
      out.push({ x, y, vx: 0, vy: 0, r: WRESTLER_R, side, lane: lane as 0 | 1, cool: 0 })
    }
  }
  return out
}

/** Index of the wrestler a side controls on a lane (sides own consecutive blocks of the array). */
export function indexOf(w: readonly Wrestler[], side: Side, lane: 0 | 1): number {
  const per = w.length / 2
  return side * per + (per === 2 ? lane : 0)
}

const norm = (x: number, y: number): Pt => {
  const d = Math.hypot(x, y)
  return d > 1e-6 ? { x: x / d, y: y / d } : { x: 0, y: 0 }
}

/** Dash power a plain request (`true`, a double tap) gets: exactly DASH_SPEED. */
export const DASH_PLAIN = 7 / 11

/** Launch speed of a dash of power 0..1 (a soft flick 65% of DASH_SPEED, a hard one 120%). */
export const dashSpeed = (power: number): number =>
  DASH_SPEED * (0.65 + 0.55 * Math.max(0, Math.min(1, power)))

/**
 * Advance the bout by one frame. `targets[i]` steers wrestler i, `dashes[i]`
 * asks it to dash this frame (true, or a power 0..1 from how hard the flick
 * was). Returns the sides that had a wrestler leave the ring this frame (any
 * out loses the round for that side).
 */
export function step(
  w: Wrestler[],
  dt: number,
  time: number,
  ring: number,
  targets: readonly Target[],
  dashes: readonly (boolean | number)[],
  ev?: Event[],
): Side[] {
  const outs: Side[] = []
  const h = dt / SUB
  for (let i = 0; i < SUB; i++) {
    for (let k = 0; k < w.length; k++) {
      const a = w[k] as Wrestler
      const t = targets[k]
      if (t) {
        const dx = t.x - a.x
        const dy = t.y - a.y
        const d = Math.hypot(dx, dy)
        const u = norm(dx, dy)
        const want = Math.min(VMAX, d * 2.6)
        const f = 1 - Math.exp(-STEER * h)
        a.vx += (u.x * want - a.vx) * f
        a.vy += (u.y * want - a.vy) * f
      }
      const ask = dashes[k]
      if (i === 0 && ask && time >= a.cool) {
        const power = ask === true ? DASH_PLAIN : ask
        // Dash toward the finger if there is one, otherwise where it was going.
        const dir = t ? norm(t.x - a.x, t.y - a.y) : norm(a.vx, a.vy)
        const along = dir.x === 0 && dir.y === 0 ? { x: 0, y: a.side === 0 ? -1 : 1 } : dir
        const v = dashSpeed(power)
        a.vx += along.x * v
        a.vy += along.y * v
        a.cool = time + DASH_COOL
        ev?.push({ kind: 'dash', side: a.side, x: a.x, y: a.y, power })
      }
      const g = Math.exp(-GLIDE * h)
      a.vx *= g
      a.vy *= g
      a.x += a.vx * h
      a.y += a.vy * h
    }
    for (let p = 0; p < w.length; p++) {
      for (let q = p + 1; q < w.length; q++) {
        const a = w[p] as Wrestler
        const b = w[q] as Wrestler
        const c = collideDynamic(a, b, MASS, MASS, 0.5)
        if (c && c.speed > 80) ev?.push({ kind: 'hit', speed: c.speed, x: c.x, y: c.y })
      }
    }
    for (const a of w) {
      if (Math.hypot(a.x - RING.x, a.y - RING.y) > ring && !outs.includes(a.side)) {
        outs.push(a.side)
        ev?.push({ kind: 'out', side: a.side, x: a.x, y: a.y })
      }
    }
  }
  return outs
}
