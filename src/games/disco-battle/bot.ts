import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BEAT, GOOD, LEAD, START, type Dancer } from './rules.ts'

/** Odds the bot hits an arrow at all. */
const ACCURACY: Record<Difficulty, number> = { easy: 0.72, normal: 0.9, hard: 0.98 }
/** Timing error, one spread unit (s). */
const JITTER: Record<Difficulty, number> = { easy: 0.085, normal: 0.045, hard: 0.02 }
/** Accuracy lost on the hard bits: chords (two pads at once) and off-beat eighths. */
const TRICKY: Record<Difficulty, number> = { easy: 0.16, normal: 0.07, hard: 0.01 }

/**
 * Computer dancer: when an arrow comes on screen it decides whether to hit it
 * (by accuracy) and when (the arrival time plus a little timing error).
 */
export class DanceBot {
  /** Per hit index: the time to press it, or -1 to let it go. */
  private plan = new Map<number, number>()

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** The lanes to press this step. */
  step(now: number, dancer: Dancer): number[] {
    const out: number[] = []
    for (let i = dancer.cursor; i < dancer.hits.length; i++) {
      const h = dancer.hits[i]
      if (!h || h.t - now > LEAD) break
      if (h.r !== 0) continue
      if (!this.plan.has(i)) {
        // Like a person, the bot fumbles chords and off-beats more than plain beats.
        const chord =
          dancer.hits[i - 1]?.t === h.t || dancer.hits[i + 1]?.t === h.t ? TRICKY[this.d] : 0
        const k = (h.t - START) / BEAT
        const offBeat = Math.abs(k - Math.round(k)) > 0.25 ? TRICKY[this.d] : 0
        const hit = this.rng.chance(ACCURACY[this.d] - chord - offBeat)
        // A triangular spread (sum of two uniforms) reads as human timing.
        // A planned hit stays inside the window (a planned miss is the miss);
        // pressing too early would be a whiff and cost the combo twice.
        const err = (this.rng.next() + this.rng.next() - 1) * JITTER[this.d] * 1.7
        const at = h.t + Math.max(-GOOD * 0.95, Math.min(GOOD * 0.95, err))
        this.plan.set(i, hit ? at : -1)
      }
      const at = this.plan.get(i) as number
      if (at >= 0 && now >= at) {
        out.push(h.lane)
        this.plan.set(i, -1)
      }
    }
    return out
  }
}
