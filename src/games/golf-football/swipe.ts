import type { Side } from '../../core/game.ts'
import type { PlayerInput, Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, SIDE } from '../../core/render/palette.ts'
import { forwardY, loftOf, type Swing, SWIPE_MAX, SWIPE_MIN } from './rules.ts'

/**
 * A swipe toward the posts: its direction is the kick's angle, its length the
 * power, and (when given) its speed the loft.
 */
export function swipeShot(side: Side, vx: number, vy: number, speed?: number): Swing | null {
  const len = Math.hypot(vx, vy)
  if (len < SWIPE_MIN) return null
  // Within 60° of the kicker's forward; a swipe back toward the kicker is no kick.
  if (vy * forwardY(side) < len * 0.5) return null
  const shot: Swing = { dx: vx / len, dy: vy / len, power: Math.min(1, len / SWIPE_MAX) }
  if (speed !== undefined) shot.loft = loftOf(speed)
  return shot
}

/** Swipe up to kick: press anywhere, swipe toward the posts, let go. Bots set the shot directly. */
export class Swipe {
  /** The kick the swipe would make right now (for the preview). */
  aim: Swing | null = null
  /** Set for exactly one step when released with a valid swipe. */
  shot: Swing | null = null
  private ptr: Ptr | null = null
  private botShot: Swing | null = null
  /** The finger's recent peak speed (world units/s), decaying: the swipe's snap. */
  private snap = 0

  constructor(readonly side: Side) {}

  /** Bot control: fire this shot on the next update. */
  fire(shot: Swing): void {
    this.botShot = shot
  }

  update(input: PlayerInput, dt = 1 / 60): void {
    this.shot = null
    if (this.botShot) {
      this.shot = this.botShot
      this.botShot = null
      this.aim = null
      return
    }
    if (!this.ptr) this.ptr = input.downs[0] ?? null
    const p = this.ptr
    if (!p) {
      this.aim = null
      this.snap = 0
      return
    }
    // A peak that decays, so a swipe that slows a beat before letting go still counts as snappy.
    const inst = Math.hypot(p.x - p.px, p.y - p.py) / dt
    this.snap = Math.max(inst, this.snap * Math.exp(-dt / 0.09))
    const shot = swipeShot(this.side, p.x - p.x0, p.y - p.y0, this.snap)
    if (!input.held.has(p.id)) {
      this.ptr = null
      this.aim = null
      if (shot) this.shot = shot
      return
    }
    this.aim = shot
  }

  cancel(): void {
    this.ptr = null
    this.aim = null
    this.snap = 0
  }

  render(g: Draw): void {
    const p = this.ptr
    if (!p || !this.aim) return
    const col = SIDE[this.side]
    g.line(p.x0, p.y0, p.x, p.y, alpha(col.light, 0.6), 10)
    g.circle(p.x0, p.y0, 14, col.light)
    g.circle(p.x, p.y, 26, alpha(col.main, 0.85))
  }
}
