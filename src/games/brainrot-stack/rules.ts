import type { Side } from '../../core/game.ts'
import type { BodySnap } from '../../engines/ragdoll/index.ts'
import { hash01 } from '../../engines/runner/index.ts'
import { CAST } from './cast.ts'
import { bottomOf, topIn, topOf, type Toy } from './toy.ts'

/** Pure rules for Brainrot Stack: the cast, the island, the claw, and who toppled what. */

export const PIECES: readonly Toy[] = CAST

/** The island the tower stands on: top surface at y = TOP, centred on x. */
export const ISLAND = { x: 500, top: 1340, w: 560, h: 70 }
/** Drop pieces this far above the current tower top. */
export const HOVER_GAP = 90
/** A piece whose centre is this far below the island top has fallen off. */
export const FALL_LINE = ISLAND.top + 60
/** Where the stage keeps the hovering piece (scene → screen, before camera). */
export const HOVER_SCREEN_Y = 360
/** Seconds a player has to drop before the claw lets go by itself (no stalled match). */
export const TURN_T = 15

/** Seed of round `r` of a match: round 0 is the game seed, later rounds deal their own pieces. */
export const roundSeed = (seed: number, r: number): number => seed + r * 7919

/** The side that has won `goal` rounds, if any (wins red first). */
export function matchWinner(wins: readonly number[], goal: number): Side | null {
  if ((wins[0] ?? 0) >= goal) return 0
  if ((wins[1] ?? 0) >= goal) return 1
  return null
}

/** Deterministic piece sequence from the game seed: same for both phones. */
export function pieceAt(seed: number, n: number): number {
  return Math.floor(hash01(seed, n, 42) * PIECES.length)
}

export function toyOf(k: number): Toy {
  return (PIECES[k] ?? PIECES[0]) as Toy
}

/** Highest point of the tower (smallest y), or the island top when empty. */
export function towerTop(bodies: readonly BodySnap[]): number {
  let top = ISLAND.top
  for (const b of bodies) {
    if (b.y > FALL_LINE) continue
    top = Math.min(top, topOf(toyOf(b.k), b.x, b.y, b.a))
  }
  return top
}

/** Y at which the next piece hovers before it drops (clear of the tower whatever its turn). */
export function hoverY(bodies: readonly BodySnap[], k: number): number {
  return towerTop(bodies) - HOVER_GAP - toyOf(k).radius
}

/** Camera offset (added to scene y) that keeps the hovering piece at a steady screen height. */
export function cameraFor(hover: number): number {
  return Math.max(0, HOVER_SCREEN_Y - hover)
}

/** True when any block has dropped off the island. */
export function anyFallen(bodies: readonly BodySnap[]): boolean {
  return bodies.some((b) => b.y > FALL_LINE)
}

/** How far the hovering piece may be dragged: a little past the island edges. */
export function clampHover(x: number, k: number): number {
  const hw = toyOf(k).radius
  const lo = ISLAND.x - ISLAND.w / 2 - 120 + hw * 0.3
  const hi = ISLAND.x + ISLAND.w / 2 + 120 - hw * 0.3
  return Math.max(lo, Math.min(hi, x))
}

/**
 * The claw sways the hanging piece side to side, wider and quicker as the
 * tower grows: the drop lands at hover x plus this. `n` is the number of
 * pieces dropped so far, `t` the seconds since the turn began.
 */
export function swayOf(n: number, t: number): number {
  const amp = Math.min(90, Math.max(0, n - 2) * 8)
  const w = 1.4 + Math.min(1.2, n * 0.06)
  return amp * Math.sin(w * t)
}

/** The horizontal extent of a toy turned by `a`, as offsets from its centre. */
export function spanOf(t: Toy, a: number): { x0: number; x1: number } {
  const s = Math.sin(a)
  const c = Math.cos(a)
  let x0 = Infinity
  let x1 = -Infinity
  for (const part of t.parts)
    for (let i = 0; i < part.pts.length; i += 2) {
      const x = (part.pts[i] as number) * c - (part.pts[i + 1] as number) * s
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
  return { x0, x1 }
}

/**
 * Where piece `k`, let go at x turned by `a`, would first touch down if it fell
 * straight: the centre height at which its lowest point meets the tower (or the
 * island). Null when nothing is under it (it would fall into the sea). A
 * preview only: the real fall can still slide and tip.
 */
export function landingOf(
  bodies: readonly BodySnap[],
  k: number,
  x: number,
  a: number,
): number | null {
  const t = toyOf(k)
  const span = spanOf(t, a)
  const x0 = x + span.x0
  const x1 = x + span.x1
  let surface = Infinity
  for (const b of bodies) {
    if (b.y > FALL_LINE) continue
    surface = Math.min(surface, topIn(toyOf(b.k), b.x, b.y, b.a, x0, x1))
  }
  const onIsland = x1 > ISLAND.x - ISLAND.w / 2 && x0 < ISLAND.x + ISLAND.w / 2
  if (onIsland) surface = Math.min(surface, ISLAND.top)
  if (!Number.isFinite(surface)) return null
  return surface - bottomOf(t, 0, 0, a)
}
