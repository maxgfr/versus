import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { aimAngle, canThrow, centreAngle, freeShot, predict, SWAY, type State } from './rules.ts'

/**
 * The computer's sword arm. Easy plans one throw at a time: an angle a little
 * off the target's centre, after a reaction delay, and taps when its sway
 * crosses it on a line that looks free right now. Normal and hard read the
 * flight instead (`predict`): each step they ask "if I let go now, where on
 * the spinning, wandering shield does it land?" and tap when it sticks clear
 * of the swords already there; hard wants a wider clearance and reacts
 * faster. Every level sometimes throws wide or a frame late.
 */

interface Level {
  react: number
  /** Aim error of the planned angle (easy only). */
  err: number
  /** Chance of a deliberately wide throw. */
  wide: number
  /** Reads the flight ahead (normal, hard). */
  read: boolean
  /** Clearance (rad) it wants from the stuck swords' clang zones. */
  margin: number
  /** Chance per step that a good moment slips by (hand lag). */
  slip: number
}

const LEVEL: Record<Difficulty, Level> = {
  easy: { react: 0.45, err: 0.3, wide: 0.25, read: false, margin: 0, slip: 0 },
  normal: { react: 0.2, err: 0, wide: 0.06, read: true, margin: 0.04, slip: 0.35 },
  hard: { react: 0.08, err: 0, wide: 0.01, read: true, margin: 0.1, slip: 0.12 },
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
    if (lv.read && !p.wide) {
      if (p.think > 0) return false
      const f = predict(s, side, sway)
      if (f.k !== 'stick' || f.margin < lv.margin) return false
      if (this.rng.chance(lv.slip)) return false
      this.plan = null
      return true
    }
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
