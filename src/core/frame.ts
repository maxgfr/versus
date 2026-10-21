import type { GameContext, Side } from './game.ts'
import type { Draw } from './render/draw.ts'
import { H, W } from './stage.ts'

/**
 * Per-side layout frames. Write a layout once, as red sees it (red's half is
 * the bottom of the world), and place it for blue by rotating 180° about the
 * stage centre. Positions are identical on every device (online taps land
 * where they are drawn); only text turns to face whoever reads it.
 */

/** Angle of a side's layout frame: red as-is, blue rotated 180° about the stage centre. */
export const frameAngle = (side: Side): number => (side === 1 ? Math.PI : 0)

/** Red-frame coordinates (as red sees the bottom half) → world, for `side`. */
export function frame(side: Side, x: number, y: number): { x: number; y: number } {
  return side === 0 ? { x, y } : { x: W - x, y: H - y }
}

/** World → red-frame coordinates for `side` (the inverse of `frame`). */
export const toLocal = frame

/**
 * Extra rotation for text and glyphs drawn inside a side's frame so they read
 * upright for whoever is looking (the player in local 2P, the viewer otherwise).
 */
export function textAngle(g: Draw, side: Side): number {
  return g.orient(side) - frameAngle(side)
}

/** Same as `textAngle` but from game logic, where there is no Draw. */
export function viewerFlipped(ctx: GameContext, side: Side): boolean {
  const orient = ctx.mode === '2p' ? frameAngle(side) : ctx.stage.rot
  return Math.abs(orient - frameAngle(side)) > 1
}

/** Run `fn` in `side`'s frame: origin at world (0,0) of the red layout. */
export function inFrame(g: Draw, side: Side, fn: () => void): void {
  if (side === 0) fn()
  else g.at(W, H, Math.PI, fn)
}
