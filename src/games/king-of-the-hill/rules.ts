import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import {
  collideDynamic,
  collideWalls,
  type Disc,
  integrate,
  rink,
} from '../../engines/puck/index.ts'

/**
 * King of the Hill: a rounded arena with a crown zone that jumps to a new spot
 * every few seconds. Each player's blob steers toward their finger and shoves
 * the rival. Standing alone in the zone fills your crown meter; when both
 * blobs are in it, nothing fills. First to the match length of crown seconds
 * wins. Pure: no DOM, no Math.random.
 */

export const ARENA = rink({ x0: 60, y0: 170, x1: W - 60, y1: 1630, corner: 150, goal: 0 })
export const BLOB_R = 66
export const ZONE_R = 170
/** Seconds between the crown jumping to a new spot. */
export const ZONE_EVERY = 8
const MAX_SPEED = 780
const STEER_GAIN = 6
const STEER_RATE = 8
const DRAG = 1.6
const E_BLOB = 0.85
const E_WALL = 0.6
const SUB = 3
/** A shove harder than this sends the blob that was hit reeling. */
const SHOVE_MIN = 220
/** Extra push given to the blob that was hit, per unit of closing speed. */
const SHOVE_PUSH = 0.7
/** Safety net: after this long the side with more crown seconds wins. */
export const LIMIT = 150

export interface Blob extends Disc {
  side: Side
  /** Seconds left reeling from a shove: no steering until it wears off. */
  stun: number
}

export interface World {
  blobs: [Blob, Blob]
  zone: { x: number; y: number; t: number }
  /** Where the crown jumps next (telegraphed before the move), once picked. */
  next: { x: number; y: number } | null
  /** Where the crown jumped from, and when: drives the hop animation. */
  from: { x: number; y: number; at: number }
  /** Seconds of crown time per side. */
  crown: [number, number]
  /** Seconds of match time. */
  t: number
  /** Crown seconds needed to win. */
  target: number
  /** Which side (if any) holds the zone alone this step: 0, 1, or null for nobody/contested. */
  holder: Side | null
}

export type Event =
  | { kind: 'hit'; x: number; y: number; speed: number }
  | { kind: 'shove'; side: Side; x: number; y: number; speed: number }
  | { kind: 'wall'; x: number; y: number; speed: number }
  | { kind: 'zone'; x: number; y: number }
  | { kind: 'tick'; side: Side; x: number; y: number; n: number }

/** Where each blob is steered this step (world), or null to coast. */
export type Targets = [{ x: number; y: number } | null, { x: number; y: number } | null]

export function newWorld(target: number): World {
  return {
    blobs: [
      { side: 0, x: W / 2, y: 1400, vx: 0, vy: 0, r: BLOB_R, stun: 0 },
      { side: 1, x: W / 2, y: 400, vx: 0, vy: 0, r: BLOB_R, stun: 0 },
    ],
    zone: { x: W / 2, y: MID, t: ZONE_EVERY },
    next: null,
    from: { x: W / 2, y: MID, at: -10 },
    crown: [0, 0],
    t: 0,
    target,
    holder: null,
  }
}

/** A spot for the crown, away from the walls (and, given `away`, a good hop from it). */
export function pickZone(rng: Rng, away?: { x: number; y: number }): { x: number; y: number } {
  let best = { x: W / 2, y: MID }
  let bd = -1
  for (let i = 0; i < 6; i++) {
    const p = {
      x: rng.range(ARENA.x0 + ZONE_R + 20, ARENA.x1 - ZONE_R - 20),
      y: rng.range(ARENA.y0 + ZONE_R + 20, ARENA.y1 - ZONE_R - 20),
    }
    const d = away ? Math.hypot(p.x - away.x, p.y - away.y) : Infinity
    if (d > bd) {
      best = p
      bd = d
    }
    if (d > 420) break
  }
  return best
}

export const inZone = (b: Blob, z: { x: number; y: number }): boolean =>
  Math.hypot(b.x - z.x, b.y - z.y) < ZONE_R

/** Advance one step. */
export function step(w: World, dt: number, targets: Targets, rng: Rng): Event[] {
  const events: Event[] = []
  w.t += dt
  w.zone.t -= dt
  if (!w.next) w.next = pickZone(rng, w.zone)
  if (w.zone.t <= 0) {
    const z = w.next
    w.from = { x: w.zone.x, y: w.zone.y, at: w.t }
    w.next = pickZone(rng, z)
    w.zone.x = z.x
    w.zone.y = z.y
    w.zone.t = ZONE_EVERY
    events.push({ kind: 'zone', x: z.x, y: z.y })
  }

  const h = dt / SUB
  for (let s = 0; s < SUB; s++) {
    w.blobs.forEach((b, i) => {
      const tgt = b.stun > 0 ? null : targets[i]
      if (tgt) {
        const dx = tgt.x - b.x
        const dy = tgt.y - b.y
        const d = Math.hypot(dx, dy)
        const want = Math.min(MAX_SPEED, d * STEER_GAIN)
        const wx = d > 1e-6 ? (dx / d) * want : 0
        const wy = d > 1e-6 ? (dy / d) * want : 0
        const k = Math.min(1, STEER_RATE * h)
        b.vx += (wx - b.vx) * k
        b.vy += (wy - b.vy) * k
      }
      integrate(b, h, DRAG)
      const c = collideWalls(b, ARENA, E_WALL)
      if (c && c.speed > 120) events.push({ kind: 'wall', x: c.x, y: c.y, speed: c.speed })
    })
    const [a, b] = w.blobs
    // Who is charging whom, measured before the bounce.
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const nx = dx / d
    const ny = dy / d
    const ca = a.vx * nx + a.vy * ny
    const cb = -(b.vx * nx + b.vy * ny)
    const c = collideDynamic(a, b, 1, 1, E_BLOB)
    if (c && c.speed > 60) {
      events.push({ kind: 'hit', x: c.x, y: c.y, speed: c.speed })
      if (c.speed > SHOVE_MIN) {
        // The blob that was charged harder reels away from the charger.
        const victim = ca >= cb ? b : a
        const s = victim === b ? 1 : -1
        victim.vx += nx * s * c.speed * SHOVE_PUSH
        victim.vy += ny * s * c.speed * SHOVE_PUSH
        victim.stun = Math.max(victim.stun, Math.min(0.55, c.speed / 1400))
        events.push({ kind: 'shove', side: victim.side, x: victim.x, y: victim.y, speed: c.speed })
      }
    }
  }
  for (const b of w.blobs) b.stun = Math.max(0, b.stun - dt)

  // Crown: alone in the zone fills your meter; contested or empty fills nothing.
  const inside = w.blobs.map((b) => inZone(b, w.zone))
  w.holder = null
  if (inside[0] !== inside[1]) {
    const side: Side = inside[0] ? 0 : 1
    const before = Math.floor(w.crown[side])
    w.crown[side] = Math.min(w.target, w.crown[side] + dt)
    w.holder = side
    const after = Math.floor(w.crown[side])
    if (after !== before) {
      const b = w.blobs[side]
      events.push({ kind: 'tick', side, x: b.x, y: b.y, n: after })
    }
  }
  return events
}

/** The side that has the crown seconds to win, or null. */
export function winner(w: World): Side | 'draw' | null {
  if (w.crown[0] >= w.target) return 0
  if (w.crown[1] >= w.target) return 1
  if (w.t >= LIMIT) {
    if (w.crown[0] === w.crown[1]) return 'draw'
    return w.crown[0] > w.crown[1] ? 0 : 1
  }
  return null
}
