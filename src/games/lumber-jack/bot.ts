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
  /** Interval factor for a chop that needs a hop across (practice makes it cheaper). */
  hop: number
  /** Spread of the interval between chops (± share): a steadier hand on harder levels. */
  jitter: number
  /** Eases off when this many segments ahead (Infinity = never). */
  relaxAt: number
}

/**
 * Easy is a kid's pace that guesses on bare wood and slips often; normal reads
 * ahead at a brisk tempo; hard chops at a fast human pace (well under what a
 * thumb can tap), hops cleanly and almost never slips. None of them sees more
 * than a player sees: the trunk on screen.
 */
export const TUNING: Record<Difficulty, Tune> = {
  easy: {
    rate: 2.2,
    mistake: 0.12,
    react: [0.3, 0.55],
    reads: false,
    hop: 1.35,
    jitter: 0.25,
    relaxAt: 4,
  },
  normal: {
    rate: 4,
    mistake: 0.04,
    react: [0.1, 0.22],
    reads: true,
    hop: 1.25,
    jitter: 0.2,
    relaxAt: 8,
  },
  hard: {
    rate: 5.4,
    mistake: 0.012,
    react: [0.03, 0.09],
    reads: true,
    hop: 1.15,
    jitter: 0.12,
    relaxAt: Infinity,
  },
}

/** Interval factor for a chop on the same side as the last one. */
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

  constructor(
    private rng: Rng,
    d: Difficulty,
    private side: Side,
    /** The match length in segments. */
    private target = TARGET,
  ) {
    this.tune = TUNING[d]
  }

  /** The side to chop from this step (0 left, 1 right), or null. */
  step(now: number, s: State): 0 | 1 | null {
    const p = s.p[this.side]
    if (p.chops >= this.target || now < this.next) return null
    const t = this.tune
    if (now < p.stunUntil) {
      this.next = p.stunUntil + this.rng.range(t.react[0], t.react[1])
      return null
    }
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
      rate *= 1.06
      mistake *= 1.4
    } else if (lead >= t.relaxAt) rate *= 0.85
    if (b !== NONE && this.rng.chance(mistake)) from = b === 0 ? 0 : 1
    this.next = now + (1 / rate) * this.rng.range(1 - t.jitter, 1 + t.jitter) * (hop ? t.hop : STAY)
    return from
  }
}
