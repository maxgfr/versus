import type { Side } from '../../core/game.ts'
import type { BodySnap, Shape } from '../../engines/ragdoll/index.ts'
import { extent, reach } from '../../engines/ragdoll/index.ts'
import { hash01 } from '../../engines/runner/index.ts'

/** Pure rules for Brainrot Stack: the cast table, the island, and who toppled what. */

export interface Piece {
  glyph: string
  shape: Shape
  color: string
}

/**
 * The cast: odd-shaped, emoji-printed pieces. Long sneakers, round coconuts and
 * a tall moai on purpose. The outline is the hitbox, the emoji is what you see.
 */
export const PIECES: readonly Piece[] = [
  { glyph: '🗿', shape: { kind: 'rect', w: 118, h: 230, round: 40 }, color: '#c9ccd6' },
  { glyph: '🦈', shape: { kind: 'rect', w: 230, h: 96, round: 44 }, color: '#8fb3d9' },
  { glyph: '👟', shape: { kind: 'rect', w: 250, h: 84, round: 30 }, color: '#ff8fb1' },
  { glyph: '🍝', shape: { kind: 'poly', sides: 8, r: 66 }, color: '#ffd45c' },
  { glyph: '🐊', shape: { kind: 'rect', w: 260, h: 70, round: 22 }, color: '#7ed957' },
  { glyph: '☕', shape: { kind: 'rect', w: 124, h: 136, round: 16 }, color: '#c9a27e' },
  { glyph: '🥥', shape: { kind: 'poly', sides: 12, r: 66 }, color: '#e8e1d2' },
  { glyph: '🪿', shape: { kind: 'trap', w: 170, h: 120, slope: 0.6 }, color: '#f4f1ea' },
  { glyph: '🧃', shape: { kind: 'rect', w: 96, h: 150, round: 12 }, color: '#ffb36b' },
  { glyph: '🦩', shape: { kind: 'poly', sides: 5, r: 70 }, color: '#ff7aa8' },
]

/** The island the tower stands on: top surface at y = TOP, centred on x. */
export const ISLAND = { x: 500, top: 1340, w: 560, h: 70 }
/** Drop pieces this far above the current tower top. */
export const HOVER_GAP = 150
/** A piece whose centre is this far below the island top has fallen off. */
export const FALL_LINE = ISLAND.top + 60
/** Where the stage keeps the hovering piece (scene → screen, before camera). */
export const HOVER_SCREEN_Y = 360

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
