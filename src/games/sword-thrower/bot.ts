import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { aimAngle, canThrow, centreAngle, freeShot, SWAY, type State } from './rules.ts'

/**
 * The computer's sword arm. It plans one throw at a time: an angle a little off
 * the target's centre, chosen after a reaction delay. It taps the moment its sway
 * crosses that angle on a free line (no stuck sword in the way). Harder levels
 * react sooner and aim truer; every level sometimes deliberately throws wide.
 */

const LEVEL: Record<Difficulty, { react: number; err: number; wide: number }> = {
  easy: { react: 0.45, err: 0.3, wide: 0.25 },
  normal: { react: 0.28, err: 0.14, wide: 0.1 },
  hard: { react: 0.14, err: 0.05, wide: 0.02 },
}

interface Plan {
  /** Sway angle to throw at. */
  a: number
  /** Seconds before the bot may tap. */
  think: number
  /** Last sign of (sway - a), to see the crossing. */
  prev: number
  /** Deliberately wide: no free-line check. */
  wide: boolean
}

export class Bot {
  private plan: Plan | null = null

  constructor(
    private readonly d: Difficulty,
    private readonly rng: Rng,
  ) {}

  /** Returns true on the step the bot taps. */
  tick(s: State, side: Side, dt: number): boolean {
    const lv = LEVEL[this.d]
    if (!canThrow(s, side)) {
      this.plan = null
      return false
    }
    const sway = aimAngle(s, side)
    if (!this.plan) {
      const wide = this.rng.chance(lv.wide)
      const e = wide ? this.rng.range(-0.6, 0.6) : this.rng.range(-lv.err, lv.err)
      const a = clampSway(centreAngle(s, side) + e)
      this.plan = {
        a,
        think: lv.react * this.rng.range(0.75, 1.3),
        prev: sway - a,
        wide,
      }
      return false
    }
    const p = this.plan
    p.think -= dt
    const diff = sway - p.a
    const crossed = Math.sign(diff) !== Math.sign(p.prev) && p.think <= 0
    p.prev = diff
    if (!crossed) return false
    if (!p.wide && !freeShot(s, side, sway)) {
      // Blocked or off target: plan again on the next pass.
      this.plan = null
      return false
    }
    this.plan = null
    return true
  }
}

const clampSway = (a: number): number => Math.max(-SWAY + 0.02, Math.min(SWAY - 0.02, a))
