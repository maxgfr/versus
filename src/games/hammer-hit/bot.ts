import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Computer strongman: each round it picks a point a little short of the peak
 * (its error) and stops the needle once it swings past that point. Harder
 * bots pick points closer to the top.
 */
export class HammerBot {
  /** Needle value (0..1) to stop at this round. */
  target = 1

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {
    this.newRound()
  }

  /** Plan the stop for the next round. */
  newRound(): void {
    const error = this.d === 'easy' ? 0.28 : this.d === 'normal' ? 0.13 : 0.04
    this.target = 1 - this.rng.range(0, error)
  }

  /** Stop now? The needle is at or past the planned point. */
  wantsStop(value: number): boolean {
    return value >= this.target
  }
}
