import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { CATCH, FUMBLE, incoming, type Potato } from './rules.ts'

interface Tune {
  /** Reaction once the potato is catchable, seconds [min, max]. */
  react: [number, number]
  /** Chance to grab too soon (a fumble) on an incoming potato. */
  fumble: number
  /** Flick force range behind a throw. */
  force: [number, number]
}

export const TUNING: Record<Difficulty, Tune> = {
  easy: { react: [0.26, 0.5], fumble: 0.2, force: [0, 0.3] },
  normal: { react: [0.13, 0.27], fumble: 0.07, force: [0.25, 0.65] },
  hard: { react: [0.04, 0.13], fumble: 0, force: [0.6, 1] },
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
    const [lo, hi] = this.tune.react
    return this.rng.range(lo, hi)
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
