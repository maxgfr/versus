import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  AVENUES,
  BUFFER,
  canLaunch,
  FAST,
  LANE_BAND,
  LAUNCH_Y,
  launchSafe,
  type World,
} from './rules.ts'

interface Skill {
  /** Seconds the gap must stay safe before the bot taps (reaction). */
  react: number
  /** Safety margin (s) on each window; negative accepts near misses. */
  margin: number
  /** Timing error: each decision rolls a margin offset within ±err. */
  err: number
  /** Floors the gas to squeeze through a gap too tight at cruising speed. */
  gas: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.5, margin: 0.2, err: 0.25, gas: false },
  normal: { react: 0.22, margin: 0.1, err: 0.08, gas: false },
  hard: { react: 0.1, margin: 0.05, err: 0.03, gas: true },
}

/** Distance from the launch line to past the far avenue: once a car is that far, it is through. */
function clearOf(side: Side): number {
  const far = side === 0 ? (AVENUES[0] as number) : (AVENUES[AVENUES.length - 1] as number)
  return Math.abs(LAUNCH_Y[side] - far) + LANE_BAND
}

/**
 * The computer driver: taps Go once the crossing is clear for its car, judging
 * only the cross traffic already on the road, as a player sees it. Its
 * judgement drifts by a difficulty-scaled timing error, so easy sometimes
 * launches into a near miss. Hard also uses the gas: when a gap is too tight
 * at cruising speed but open at full throttle, it launches and holds Go until
 * that car is through.
 */
export class CrossBot {
  private ready = 0
  private slack = 0
  private sk: Skill
  /** Id of the car it is flooring through the crossing (-1: none). */
  private floored = -1
  private flooredAt = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
    this.roll()
  }

  private roll(): void {
    this.slack = this.rng.range(-this.sk.err, this.sk.err)
  }

  /** True while the bot holds Go down as the gas pedal. */
  gas(w: World, side: Side): boolean {
    if (this.floored < 0) return false
    const car = w.racers[side].cars.find((c) => c.id === this.floored)
    // Not launched yet (the tap is waiting for the lane): keep the pedal down a moment.
    if (!car && w.nextId <= this.floored && w.t - this.flooredAt < BUFFER + 0.1) return true
    if (!car || car.prog > clearOf(side)) {
      this.floored = -1
      return false
    }
    return true
  }

  /** True on the step the bot wants to tap Go. */
  decide(w: World, side: Side, dt: number): boolean {
    if (!canLaunch(w, side) || this.floored >= 0) {
      this.ready = 0
      return false
    }
    const m = this.sk.margin + this.slack
    const cruise = launchSafe(w, side, w.t, m, undefined, true)
    // Full throttle is not instant: judge it at a bit under top speed.
    const floor = !cruise && this.sk.gas && launchSafe(w, side, w.t, m, FAST * 0.9, true)
    if (cruise || floor) {
      this.ready += dt
      if (this.ready >= this.sk.react) {
        this.ready = 0
        this.roll()
        // The car about to launch gets the next id.
        if (floor) {
          this.floored = w.nextId
          this.flooredAt = w.t
        }
        return true
      }
    } else {
      this.ready = 0
    }
    return false
  }
}
