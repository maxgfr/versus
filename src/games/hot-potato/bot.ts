import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Computer holder. When the potato lands in its half, it waits out a
 * difficulty-scaled reaction and throws it back. It never throws before the
 * catch delay (its reactions are always longer than that).
 */
export class PotatoBot {
  /** The arrival (enteredAt) the current reaction was planned for. */
  private armed = -1
  private react = 0

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** Throw this step? `holder` is whose half the potato is in, `enteredAt` when it got there. */
  drive(now: number, holder: Side, enteredAt: number, side: Side): boolean {
    if (holder !== side) {
      this.armed = -1
      return false
    }
    if (this.armed !== enteredAt) {
      this.armed = enteredAt
      const [lo, hi] =
        this.d === 'easy' ? [0.55, 0.8] : this.d === 'normal' ? [0.38, 0.55] : [0.25, 0.4]
      this.react = enteredAt + this.rng.range(lo, hi)
    }
    if (now >= this.react) {
      this.armed = -1
      return true
    }
    return false
  }
}
