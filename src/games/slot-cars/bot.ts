import type { Difficulty } from '../../core/game.ts'
import { type Car, DRAG, limitAt, track } from './rules.ts'

interface Skill {
  /**
   * How far above the safe speed the computer is willing to go into a bend
   * (fraction). Positive overshoots and crashes now and then; negative keeps
   * a margin.
   */
  overshoot: number
  /** How far ahead the throttle profile looks (units). */
  look: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { overshoot: 0.05, look: 360 },
  normal: { overshoot: -0.1, look: 360 },
  hard: { overshoot: -0.02, look: 360 },
}

/** Distance step of the look-ahead (units). */
const STEP = 8

/**
 * The computer driver for one lane. It holds the throttle while coasting from
 * here would still keep the car under the speed each bend ahead allows, and
 * lifts as soon as it would not. Coasting loses speed at a known rate
 * (dv/ds = -DRAG), so the lift point is exact.
 */
export class SlotBot {
  constructor(private sk: Skill) {}

  static of(d: Difficulty): SlotBot {
    return new SlotBot(SKILL[d])
  }

  /** Hold the throttle this step? */
  throttle(c: Car): boolean {
    if (c.st !== 'run' || c.finishT >= 0) return false
    const tr = track()
    for (let d = 0; d <= this.sk.look; d += STEP) {
      const limit = limitAt(tr, c.side, c.s + d) * (1 + this.sk.overshoot)
      if (c.v - DRAG * d > limit) return false
    }
    return true
  }
}
