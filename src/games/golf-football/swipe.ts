import type { Side } from '../../core/game.ts'
import type { PlayerInput, Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, SIDE } from '../../core/render/palette.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { forwardY, SWIPE_MAX, SWIPE_MIN } from './rules.ts'

/** A swipe toward the posts: its direction is the kick's angle, its length the power. */
export function swipeShot(side: Side, vx: number, vy: number): ShotParams | null {
  const len = Math.hypot(vx, vy)
  if (len < SWIPE_MIN) return null
  // Within 60° of the kicker's forward; a swipe back toward the kicker is no kick.
  if (vy * forwardY(side) < len * 0.5) return null
  return { dx: vx / len, dy: vy / len, power: Math.min(1, len / SWIPE_MAX) }
}

/** Swipe up to kick: press anywhere, swipe toward the posts, let go. Bots set the shot directly. */
export class Swipe {
  /** The kick the swipe would make right now (for the preview). */
  aim: ShotParams | null = null
  /** Set for exactly one step when released with a valid swipe. */
  shot: ShotParams | null = null
  private ptr: Ptr | null = null
  private botShot: ShotParams | null = null

  constructor(readonly side: Side) {}

  /** Bot control: fire this shot on the next update. */
  fire(shot: ShotParams): void {
    this.botShot = shot
  }

  update(input: PlayerInput): void {
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
      return
    }
    const shot = swipeShot(this.side, p.x - p.x0, p.y - p.y0)
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
