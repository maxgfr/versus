import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { CATCH, FUMBLE, incoming, type Potato } from './rules.ts'

interface Tune {
  /**
   * Delay after the potato becomes catchable, seconds [min, max]. The moment
   * is predictable (the midline crossing plus the fixed catch delay), so a
   * sharp player times the tap instead of reacting to it: hard does the same.
   */
  react: [number, number]
  /** Chance of a hesitation, and how long it adds [min, max]. */
  slip: number
  hesitate: [number, number]
  /** Chance to grab too soon (a fumble) on an incoming potato. */
  fumble: number
  /** Flick force range behind a throw. */
  force: [number, number]
}

export const TUNING: Record<Difficulty, Tune> = {
  // Welcoming: slow, often hesitant, burns its fingers now and then, soft throws.
  easy: {
    react: [0.3, 0.6],
    slip: 0.15,
    hesitate: [0.15, 0.35],
    fumble: 0.2,
    force: [0, 0.25],
  },
  // A real challenge: quick hands and firm flicks, the odd slip.
  normal: {
    react: [0.08, 0.18],
    slip: 0.06,
    hesitate: [0.1, 0.25],
    fumble: 0.04,
    force: [0.5, 0.85],
  },
  // Near-optimal: throws as soon as the rules allow, flicks at full force.
  hard: {
    react: [0.02, 0.07],
    slip: 0.02,
    hesitate: [0.1, 0.2],
    fumble: 0,
    force: [0.85, 1],
  },
}

/** A bot's touch this step: tap or not, and the flick force behind it. */
export interface BotTouch {
  tap: boolean
  force: number
}

const NONE: BotTouch = { tap: false, force: 0 }

/**
 * Computer holder, playing by the real rules. When the potato becomes its
 * problem it waits out the catch delay plus a difficulty-scaled reaction, then
 * throws with a difficulty-scaled flick. Easier bots sometimes grab too soon
 * and burn their fingers. After any tap that did not get rid of the potato
 * (a fumble), it re-plans for when its fingers have cooled, so it can never
 * get stuck holding. Not part of the snapshot (bots only run on the host).
 */
export class PotatoBot {
  private tune: Tune
  /** The arrival (enteredAt) the current plan was made for, -1 for none. */
  private armed = -1
  private tapAt = 0
  private force = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.tune = TUNING[d]
  }

  private reaction(): number {
    const { react, slip, hesitate } = this.tune
    let t = this.rng.range(react[0], react[1])
    if (this.rng.chance(slip)) t += this.rng.range(hesitate[0], hesitate[1])
    return t
  }

  /** This step's touch for `side`. `lock` is the game time its fingers are burnt until. */
  drive(now: number, pot: Potato, side: Side, lock = -Infinity): BotTouch {
    if (!incoming(pot, side)) {
      this.armed = -1
      return NONE
    }
    if (this.armed !== pot.enteredAt) {
      this.armed = pot.enteredAt
      this.force = this.rng.range(this.tune.force[0], this.tune.force[1])
      this.tapAt = this.rng.chance(this.tune.fumble)
        ? pot.enteredAt + this.rng.range(0.04, CATCH - 0.03)
        : pot.enteredAt + CATCH + this.reaction()
    }
    if (now < this.tapAt) return NONE
    // Plan a retry in case this tap is a fumble; a throw makes the potato
    // someone else's problem and the plan is dropped next step.
    this.tapAt = Math.max(now + FUMBLE, lock) + this.reaction()
    return { tap: true, force: this.force }
  }
}
