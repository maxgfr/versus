import type { BodySnap, Shape } from '../../engines/ragdoll/index.ts'
import { extent, reach } from '../../engines/ragdoll/index.ts'
import { hash01 } from '../../engines/runner/index.ts'

/** Pure rules for Animal Stack: the piece table, the island, and who toppled what. */

export interface Piece {
  glyph: string
  shape: Shape
  color: string
}

/** Wooden animal blocks. The block outline is the hitbox; the animal is printed on it. */
export const PIECES: readonly Piece[] = [
  { glyph: '🐘', shape: { kind: 'rect', w: 170, h: 120, round: 22 }, color: '#b9c2d6' },
  { glyph: '🐷', shape: { kind: 'poly', sides: 8, r: 64 }, color: '#ffb3c4' },
  { glyph: '🐢', shape: { kind: 'trap', w: 180, h: 80, slope: 0.4 }, color: '#8fd694' },
  { glyph: '🐼', shape: { kind: 'rect', w: 120, h: 120, round: 30 }, color: '#e9e4f0' },
  { glyph: '🦒', shape: { kind: 'rect', w: 86, h: 190, round: 20 }, color: '#ffd27a' },
  { glyph: '🐸', shape: { kind: 'poly', sides: 6, r: 68 }, color: '#9be07a' },
  { glyph: '🦛', shape: { kind: 'rect', w: 190, h: 96, round: 26 }, color: '#c7b3e6' },
  { glyph: '🐧', shape: { kind: 'rect', w: 92, h: 140, round: 34 }, color: '#a9d3ff' },
  { glyph: '🦔', shape: { kind: 'trap', w: 150, h: 90, slope: 0.5 }, color: '#d9b08c' },
  { glyph: '🐻', shape: { kind: 'poly', sides: 8, r: 66 }, color: '#d8a47f' },
  { glyph: '🐳', shape: { kind: 'rect', w: 210, h: 84, round: 36 }, color: '#8fc8ff' },
  { glyph: '🐔', shape: { kind: 'poly', sides: 5, r: 66 }, color: '#ffe08a' },
  { glyph: '🐑', shape: { kind: 'rect', w: 140, h: 110, round: 44 }, color: '#f4f1ea' },
  { glyph: '🦊', shape: { kind: 'trap', w: 150, h: 110, slope: 0.7 }, color: '#ffb27a' },
]

/** The island the tower stands on: top surface at y = TOP, centred on x. */
export const ISLAND = { x: 500, top: 1340, w: 560, h: 70 }
/** Drop pieces this far above the current tower top. */
export const HOVER_GAP = 150
/** A piece whose centre is this far below the island top has fallen off. */
export const FALL_LINE = ISLAND.top + 60
/** Where the stage keeps the hovering piece (scene → screen, before camera). */
export const HOVER_SCREEN_Y = 360

/** Deterministic piece sequence from the game seed: same for both phones. */
export function pieceAt(seed: number, n: number): number {
  return Math.floor(hash01(seed, n, 42) * PIECES.length)
}

export function shapeOf(k: number): Shape {
  return (PIECES[k] ?? PIECES[0])!.shape
}

/** Highest point of the tower (smallest y), or the island top when empty. */
export function towerTop(bodies: readonly BodySnap[]): number {
  let top = ISLAND.top
  for (const b of bodies) {
    if (b.y > FALL_LINE) continue
    top = Math.min(top, b.y - reach(shapeOf(b.k)))
  }
  return top
}

/** Y at which the next piece hovers before it drops. */
export function hoverY(bodies: readonly BodySnap[], k: number): number {
  return towerTop(bodies) - HOVER_GAP - extent(shapeOf(k)).hh
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
  const hw = reach(shapeOf(k))
  const lo = ISLAND.x - ISLAND.w / 2 - 120 + hw * 0.3
  const hi = ISLAND.x + ISLAND.w / 2 + 120 - hw * 0.3
  return Math.max(lo, Math.min(hi, x))
}
