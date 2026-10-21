/**
 * Runner engine: split-screen scrollers where each player owns a lane.
 *
 * How to build a game on it:
 * - Extend `RunnerGame<S>`. Your state holds one runner per side (position,
 *   velocity, distance…); keep it JSON-serializable.
 * - Work in lane-local coordinates: x grows forward (left → right on the
 *   player's screen), y grows toward the player's own edge; the lane is
 *   `LANE_W` × `LANE_H` (the player's half). Blue's lane is turned 180° in local
 *   2P and online, upright in 1P — the frame does it, never your code.
 * - Generate obstacles with `hash01(seed, i, k)` from `ctx.seed`: the course is a
 *   pure function of (seed, index), so both lanes (and both phones) see the very
 *   same course and snapshots never need to carry it.
 * - Implement `stepRunner(side, dt)` (physics + collisions for one lane; read
 *   `this.taps(side)` for this step's presses) and `renderLane(g, side, view)`
 *   (draw one lane in local coords; `view` is the visible local rect including
 *   letterbox bleed). The base steps both lanes, draws them clipped to their
 *   halves, and draws the divider.
 * - Physics helpers: `fall` / `flap` for gravity bodies, `circleRect` for hits.
 *   Backdrops: `repeatX` for parallax layers, `laneHud` for the lane's counter.
 * - Bots set intent through the same path humans use: `this.bot[side]` taps
 *   (`botTap(side)`) are merged into `this.taps(side)`.
 */
import { BaseGame, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type Frame, halfFrame, inFrame, localView } from './frame.ts'

export * from './frame.ts'

export const LANE_W = W
export const LANE_H = MID

/** Deterministic hash → [0, 1). Same (seed, i, k) on every device, forever. */
export function hash01(seed: number, i: number, k = 0): number {
  let h = (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(k + 7, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export interface Faller {
  y: number
  vy: number
}

/** Integrate gravity with a terminal velocity. */
export function fall(b: Faller, dt: number, gravity: number, maxFall = Infinity): void {
  b.vy = Math.min(maxFall, b.vy + gravity * dt)
  b.y += b.vy * dt
}

/** Set an upward (toward local y = 0) velocity. */
export function flap(b: Faller, impulse: number): void {
  b.vy = -impulse
}

/** Circle vs axis-aligned rect overlap. */
export function circleRect(
  cx: number,
  cy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const nx = Math.max(x, Math.min(cx, x + w))
  const ny = Math.max(y, Math.min(cy, y + h))
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r
}

/**
 * Call `fn(x)` for every repeat of a pattern of width `period` that is visible
 * between x0 and x1, scrolled by `scroll` (parallax: pass scroll × factor).
 */
export function repeatX(
  scroll: number,
  period: number,
  x0: number,
  x1: number,
  fn: (x: number, i: number) => void,
): void {
  const first = Math.floor((x0 + scroll) / period)
  const last = Math.ceil((x1 + scroll) / period)
  for (let i = first; i <= last; i++) fn(i * period - scroll, i)
}

/** The lane's counter (distance, score…) as a pill centred on (x, y): big value, small label. */
export function laneHud(
  g: Draw,
  side: Side,
  value: string | number,
  label: string,
  x = LANE_W / 2,
  y = 70,
): void {
  const vw = g.measure(String(value), 60, 700)
  const lw = g.measure(label, 30, 600)
  const w = vw + lw + 84
  g.rrect(x - w / 2, y - 44, w, 88, 44, alpha(C.ink, 0.62))
  g.text(value, x - w / 2 + 34, y + 3, { size: 60, weight: 700, align: 'left', color: C.white })
  g.text(label, x - w / 2 + 50 + vw, y + 4, {
    size: 30,
    weight: 600,
    align: 'left',
    color: SIDE[side].light,
  })
}

export abstract class RunnerGame<S extends object> extends BaseGame<S> {
  frames!: [Frame, Frame]
  private botTaps: [number, number] = [0, 0]

  override init(ctx: Parameters<BaseGame<S>['init']>[0]): void {
    this.frames = [halfFrame(0, ctx.mode), halfFrame(1, ctx.mode)]
    super.init(ctx)
  }

  /** Bot: press once on the next step. */
  protected botTap(side: Side): void {
    this.botTaps[side]++
  }

  /** Presses for a side this step (human fingers + bot taps). */
  protected taps(side: Side): number {
    return this.ctx.input.player(side).downs.length + this.botTaps[side]
  }

  /** Human fingers currently down on a side (hold-to-act games). */
  protected held(side: Side): Ptr | undefined {
    return this.ctx.input.player(side).first()
  }

  protected abstract stepRunner(side: Side, dt: number): void

  protected abstract renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void

  /** Drawn once over both lanes (round banners, etc.). */
  protected renderOver(_g: Draw): void {}

  /** Shared logic before the lanes step (round phases, the clock…). Return false to skip the lanes this step. */
  protected stepWorld(_dt: number): boolean {
    return true
  }

  protected step(dt: number): void {
    if (this.stepWorld(dt)) {
      this.stepRunner(0, dt)
      this.stepRunner(1, dt)
    }
    this.botTaps = [0, 0]
  }

  render(g: Draw): void {
    g.fillView(C.ink)
    for (const side of [1, 0] as Side[]) {
      const f = this.frames[side]
      inFrame(g, f, () => this.renderLane(g, side, localView(g, f)))
    }
    // Divider: a chunky band with the team colours meeting.
    g.rect(g.stage.view.x - 2, MID - 9, g.stage.view.w + 4, 18, C.ink)
    g.rect(g.stage.view.x - 2, MID - 9, g.stage.view.w + 4, 4, alpha(SIDE[1].main, 0.8))
    g.rect(g.stage.view.x - 2, MID + 5, g.stage.view.w + 4, 4, alpha(SIDE[0].main, 0.8))
    this.renderOver(g)
  }
}
