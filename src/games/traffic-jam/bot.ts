import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { canLaunch, launchSafe, type World } from './rules.ts'

interface Skill {
  /** Seconds the gap must stay safe before the bot taps (reaction). */
  react: number
  /** Safety margin (s) on each window; negative accepts near misses. */
  margin: number
  /** Timing error: each decision rolls a margin offset within ±err. */
  err: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.5, margin: 0.2, err: 0.25 },
  normal: { react: 0.35, margin: 0.12, err: 0.12 },
  hard: { react: 0.2, margin: 0.06, err: 0.04 },
}

/**
 * The computer driver: taps Go once the crossing is clear for its car, as it
 * reads the cross traffic (the schedule is deterministic, so it can look ahead).
 * Its judgement drifts by a difficulty-scaled timing error, so easy sometimes
 * launches into a near miss.
 */
export class CrossBot {
  private ready = 0
  private slack = 0
  private sk: Skill

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

  /** True on the step the bot wants to tap Go. */
  decide(w: World, side: Side, dt: number): boolean {
    if (!canLaunch(w, side)) {
      this.ready = 0
      return false
    }
    if (launchSafe(w, side, w.t, this.sk.margin + this.slack)) {
      this.ready += dt
      if (this.ready >= this.sk.react) {
        this.ready = 0
        this.roll()
        return true
      }
    } else {
      this.ready = 0
    }
    return false
  }
}
