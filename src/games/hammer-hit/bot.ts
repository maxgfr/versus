import { STEP, type Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { swingStopped, type Swing } from './rules.ts'

/** Timing error (s) either side of the peak, and the chance of a nervous early strike. */
export const BOT_TUNING: Record<Difficulty, { span: number; flinch: number }> = {
  easy: { span: 0.26, flinch: 0.15 },
  normal: { span: 0.12, flinch: 0.05 },
  hard: { span: 0.05, flinch: 0 },
}

/** A human needs this long after the needle starts to see the first peak coming. */
const SEE = 0.45

/**
 * Computer strongman. It reads the gauge like a player does: it predicts when
 * the needle will next peak (the triangle wave tops out at phase ½ of every
 * sweep) and strikes at that moment plus a human timing error. The error is in
 * seconds, so a faster gauge (later rounds) costs it height just like it does
 * a person. Easy sometimes flinches early or lets a peak go by.
 */
export class HammerBot {
  /** Gauge time (`gauge.t`) at which to strike this round, -1 until planned. */
  plan = -1
  private tune: { span: number; flinch: number }

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.tune = BOT_TUNING[d]
  }

  /** Forget the plan: the next round has a new gauge speed. */
  newRound(): void {
    this.plan = -1
  }

  /** Gauge time of the peak to aim for, given the gauge speed. */
  private peak(speed: number): number {
    let k = 0
    while ((k + 0.5) / speed < SEE) k++
    // Easy is not always ready for the first peak.
    if (this.tune.flinch > 0.1 && this.rng.chance(0.25)) k++
    return (k + 0.5) / speed
  }

  /** Strike now? Call once per step while the gauge is live. */
  wantsStop(sw: Swing): boolean {
    if (swingStopped(sw)) return false
    if (this.plan < 0) {
      const { span, flinch } = this.tune
      // Triangular error: most strikes land near the peak, a few well off it.
      let err = (this.rng.next() + this.rng.next() - 1) * span
      if (this.rng.chance(flinch)) err = -this.rng.range(span, span * 2.5)
      this.plan = Math.max(STEP, this.peak(sw.gauge.speed) + err)
    }
    // Strike on the step whose gauge time is closest to the plan.
    return sw.gauge.t + STEP / 2 >= this.plan
  }
}
