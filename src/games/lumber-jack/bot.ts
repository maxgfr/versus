import { other, type Difficulty, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { NONE, plan, TARGET, type State } from './rules.ts'

interface Tune {
  /** Chops per second on a straight run (no hop). */
  rate: number
  /** Odds of chopping into a branch by mistake (more after a hop, less on a run). */
  mistake: number
  /** Seconds to get going again once a stun ends [min, max]. */
  react: [number, number]
  /** Reads the next branches so bare segments need no hop. */
  reads: boolean
}

export const TUNING: Record<Difficulty, Tune> = {
  easy: { rate: 2.4, mistake: 0.12, react: [0.25, 0.5], reads: false },
  normal: { rate: 3.4, mistake: 0.05, react: [0.12, 0.3], reads: true },
  hard: { rate: 4.6, mistake: 0.02, react: [0.04, 0.14], reads: true },
}

/** Interval factor for a chop that needs a hop across, and for one on the same side. */
const HOP = 1.3
const STAY = 0.88

/**
 * Computer lumberjack. Reads the segment about to be cut and chops away from
 * its branch, like a person: a run on one side is quick, a hop across costs
 * time and is where slips happen. Normal and hard also look up the trunk so a
 * bare segment is cut from the side the next branch needs. Under pressure
 * (well behind) it rushes and slips more; well ahead, easy and normal ease off.
 */
export class ChopBot {
  /** Game time of the next chop. */
  private next = 0.6
  private tune: Tune
  /** Eases off when well ahead (not on hard). */
  private relax: boolean

  constructor(
    private rng: Rng,
    d: Difficulty,
    private side: Side,
    /** The match length in segments. */
    private target = TARGET,
  ) {
    this.tune = TUNING[d]
    this.relax = d !== 'hard'
  }

  /** The side to chop from this step (0 left, 1 right), or null. */
  step(now: number, s: State): 0 | 1 | null {
    const p = s.p[this.side]
    if (p.chops >= this.target || now < this.next) return null
    if (now < p.stunUntil) {
      const [a, b] = this.tune.react
      this.next = p.stunUntil + this.rng.range(a, b)
      return null
    }
    const t = this.tune
    const b = s.seq[p.chops] ?? NONE
    let from: 0 | 1 = t.reads
      ? plan(s.seq, p.chops, p.from)
      : b === NONE
        ? this.rng.chance(0.5)
          ? 0
          : 1
        : b === 0
          ? 1
          : 0
    const hop = p.from >= 0 && from !== p.from
    const lead = p.chops - s.p[other(this.side)].chops
    let rate = t.rate
    let mistake = t.mistake * (hop ? 1.6 : 0.6)
    if (lead <= -4) {
      rate *= 1.08
      mistake *= 1.5
    } else if (this.relax && lead >= 6) rate *= 0.88
    if (b !== NONE && this.rng.chance(mistake)) from = b === 0 ? 0 : 1
    this.next = now + (1 / rate) * this.rng.range(0.78, 1.22) * (hop ? HOP : STAY)
    return from
  }
}
