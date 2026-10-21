import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MashBot, mashRate } from '../../engines/reflex/index.ts'

/**
 * Computer puller: mashes at a difficulty rate with human jitter and, below
 * hard, eases off a little when comfortably ahead (so games stay close).
 */
export class RopeBot {
  private mash: MashBot

  constructor(
    rng: Rng,
    private d: Difficulty,
    private side: Side,
  ) {
    this.mash = new MashBot(rng, mashRate(d))
  }

  /** Taps this step, given the knot position (+1 = red's line). */
  step(dt: number, pos: number): number {
    // Lead from this bot's point of view: 1 = about to win.
    const lead = this.side === 1 ? -pos : pos
    // Easier bots relax when comfortably ahead, which keeps games close.
    const relax = this.d === 'hard' ? 0 : this.d === 'normal' ? 0.08 : 0.2
    this.mash.rate = mashRate(this.d) * (1 - Math.max(0, lead - 0.4) * relax)
    return this.mash.step(dt)
  }
}
