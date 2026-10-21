import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { safeSide, TARGET, type State } from './rules.ts'

/** Chops per second. */
const RATE: Record<Difficulty, number> = { easy: 1.7, normal: 2.4, hard: 3 }
/** Odds of chopping into a branch by mistake. */
const MISTAKE: Record<Difficulty, number> = { easy: 0.2, normal: 0.07, hard: 0.02 }

/**
 * Computer lumberjack: reads the next segment's branch, chops on the safe side
 * at a difficulty rate, and now and then picks the wrong side.
 */
export class ChopBot {
  /** Game time of the next chop. */
  private next = 0.6

  constructor(
    private rng: Rng,
    private d: Difficulty,
    private side: Side,
    /** The match length in segments. */
    private target = TARGET,
  ) {}

  /** The side to chop from this step (0 left, 1 right), or null. */
  step(now: number, s: State): 0 | 1 | null {
    const p = s.p[this.side]
    if (p.chops >= this.target || now < this.next) return null
    if (now < p.stunUntil) {
      this.next = p.stunUntil + 0.05
      return null
    }
    const from = safeSide(s.seq, p.chops, this.rng, MISTAKE[this.d])
    this.next = now + (1 / RATE[this.d]) * this.rng.range(0.7, 1.3)
    return from
  }
}
