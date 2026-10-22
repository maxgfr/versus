import type { GameContext, Mode, Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { H, MID, W } from '../../core/stage.ts'

/**
 * A player's own frame: a rectangle of the world with its own local
 * coordinates, upright for the player who owns it. Split-screen games (runner
 * lanes, puzzle races) draw each side in local coords and let the frame place
 * and rotate it.
 *
 * The angle depends only on the side and the mode, never on the device, so the
 * online host maps the guest's touches exactly as the guest sees them: blue's
 * frame is turned 180° in local 2P and online (the guest's screen is itself
 * rotated, so it reads upright there), and upright in 1P where nobody sits at
 * the top. Drawing goes through `viewFrame`, which turns the rival's half
 * upright too when nobody sits across the table (online).
 */
export interface Frame {
  side: Side
  /** World centre. */
  cx: number
  cy: number
  /** Local size. */
  w: number
  h: number
  angle: number
}

export function ownerAngle(side: Side, mode: Mode): number {
  return side === 1 && mode !== '1p' ? Math.PI : 0
}

/** The side's half of the stage (or the whole stage when `solo`). */
export function halfFrame(side: Side, mode: Mode, solo = false): Frame {
  if (solo) return { side, cx: W / 2, cy: MID, w: W, h: H, angle: 0 }
  return {
    side,
    cx: W / 2,
    cy: side === 0 ? MID + MID / 2 : MID / 2,
    w: W,
    h: MID,
    angle: ownerAngle(side, mode),
  }
}

/**
 * The frame as this screen shows it. Local 2P keeps blue's half turned to the
 * player across the table; everywhere else every half reads upright for the
 * viewer (online, the rival's half would otherwise be upside down).
 */
export function viewFrame(g: Draw, f: Frame): Frame {
  const angle = g.flipTop ? f.angle : g.stage.rot
  return angle === f.angle ? f : { ...f, angle }
}

/**
 * Effects are spawned in world coords through the play frames. A half this
 * screen shows turned (see `viewFrame`) gets them mirrored about its centre so
 * they land where they are drawn. Set once the frames are known.
 */
export function mirrorFx(ctx: GameContext, frames: readonly Frame[]): void {
  const rot = ctx.stage.rot
  const turned = ctx.mode === '2p' ? [] : frames.filter((f) => f.h < H && f.angle !== rot)
  ctx.fx.remap = turned.length
    ? (x, y) => {
        const f = turned.find((t) => y < MID === t.cy < MID)
        return f ? [2 * f.cx - x, 2 * f.cy - y] : null
      }
    : null
}

/** World → frame-local. */
export function toLocal(f: Frame, x: number, y: number): { x: number; y: number } {
  const dx = x - f.cx
  const dy = y - f.cy
  const c = Math.cos(-f.angle)
  const s = Math.sin(-f.angle)
  return { x: dx * c - dy * s + f.w / 2, y: dx * s + dy * c + f.h / 2 }
}

/** Frame-local → world. */
export function toWorld(f: Frame, x: number, y: number): { x: number; y: number } {
  const dx = x - f.w / 2
  const dy = y - f.h / 2
  const c = Math.cos(f.angle)
  const s = Math.sin(f.angle)
  return { x: f.cx + dx * c - dy * s, y: f.cy + dx * s + dy * c }
}

/**
 * Draw inside a frame. The clip covers the frame's world rect extended to the
 * visible edges (letterbox), so local drawing may bleed past 0..w / 0..h: draw
 * the ground below `h` and the sky above 0 and it fills the screen.
 */
export function inFrame(g: Draw, frame: Frame, fn: () => void, clip = true): void {
  const f = viewFrame(g, frame)
  const c = g.ctx
  c.save()
  if (clip) {
    const v = g.stage.view
    const top = f.cy - f.h / 2
    const bottom = f.cy + f.h / 2
    // Extend the clip to the visible edge on the sides that touch it.
    const y0 = top <= 0.5 ? v.y - 2 : top
    const y1 = bottom >= H - 0.5 ? v.y + v.h + 2 : bottom
    c.beginPath()
    c.rect(v.x - 2, y0, v.w + 4, y1 - y0)
    c.clip()
  }
  c.translate(f.cx, f.cy)
  if (f.angle) c.rotate(f.angle)
  c.translate(-f.w / 2, -f.h / 2)
  fn()
  c.restore()
}

/**
 * The part of local space that is visible inside the frame's clip (letterbox
 * included), so backdrops can fill it: sky above 0, ground below h, and so on.
 */
export function localView(
  g: Draw,
  frame: Frame,
): { x0: number; y0: number; x1: number; y1: number } {
  const f = viewFrame(g, frame)
  const v = g.stage.view
  const top = f.cy - f.h / 2
  const bottom = f.cy + f.h / 2
  const y0 = top <= 0.5 ? v.y : top
  const y1 = bottom >= H - 0.5 ? v.y + v.h : bottom
  const pts = [
    toLocal(f, v.x, y0),
    toLocal(f, v.x + v.w, y0),
    toLocal(f, v.x, y1),
    toLocal(f, v.x + v.w, y1),
  ]
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    x1: Math.max(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    y1: Math.max(...pts.map((p) => p.y)),
  }
}
