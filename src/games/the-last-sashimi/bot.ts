import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { reactionRange, slipChance } from './rules.ts'

/**
 * Computer chopsticks. Answers the real bell after a difficulty-scaled
 * reaction (220-550 ms). Now and then, on easier levels, it falls for a decoy
 * flash and taps too soon.
 */
export class SashimiBot {
  private react = 0
  private fooledAt = -1
  private tapped = false

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** Plan a new round, given the decoy flash times. */
  newRound(decoys: number[]): void {
    const [lo, hi] = reactionRange(this.d)
    this.react = this.rng.range(lo, hi)
    this.tapped = false
    const fall = decoys.length > 0 && this.rng.chance(slipChance(this.d))
    this.fooledAt = fall ? this.rng.pick(decoys) + this.rng.range(0.18, 0.3) : -1
  }

  /**
   * Tap this step? `phase` and `t` are the signal's own: time since the wait
   * began, or since the real bell rang.
   */
  act(phase: 'wait' | 'live' | 'done', t: number): boolean {
    if (this.tapped) return false
    if (phase === 'wait') {
      if (this.fooledAt >= 0 && t >= this.fooledAt) {
        this.tapped = true
        return true
      }
      return false
    }
    if (phase === 'live' && t >= this.react) {
      this.tapped = true
      return true
    }
    return false
  }
}
