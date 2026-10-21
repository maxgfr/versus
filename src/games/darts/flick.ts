import type { Side } from '../../core/game.ts'
import type { PlayerInput, Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, SIDE } from '../../core/render/palette.ts'
import { STEP } from '../../core/game.ts'
import { FLICK_MIN, type Pt } from './rules.ts'

/**
 * A flick: press anywhere, fling toward the board, let go. The vector from the
 * press to the release is the throw; its peak speed sets the wobble.
 */
export class Flick {
  /** The flick being made right now (for the reticle), null when idle or too short. */
  aim: Pt | null = null
  /** Set for exactly one step when released with a real flick. */
  throwFlick: { f: Pt; speed: number } | null = null
  private ptr: Ptr | null = null
  private peak = 0

  constructor(readonly side: Side) {}

  update(input: PlayerInput): void {
    this.throwFlick = null
    if (!this.ptr) {
      const p = input.downs[0]
      if (p) {
        this.ptr = p
        this.peak = 0
      }
    }
    const p = this.ptr
    if (!p) {
      this.aim = null
      return
    }
    this.peak = Math.max(this.peak, Math.hypot(p.x - p.px, p.y - p.py) / STEP)
    const f = { x: p.x - p.x0, y: p.y - p.y0 }
    const long = Math.hypot(f.x, f.y) >= FLICK_MIN
    if (!input.held.has(p.id)) {
      this.ptr = null
      this.aim = null
      if (long) this.throwFlick = { f, speed: this.peak }
      return
    }
    this.aim = long ? f : null
  }

  cancel(): void {
    this.ptr = null
    this.aim = null
    this.throwFlick = null
  }

  render(g: Draw): void {
    const p = this.ptr
    if (!p || !this.aim) return
    const col = SIDE[this.side]
    g.line(p.x0, p.y0, p.x, p.y, alpha(col.light, 0.6), 8)
    g.circle(p.x0, p.y0, 14, col.light)
    g.circle(p.x, p.y, 24, alpha(col.main, 0.8))
  }
}
