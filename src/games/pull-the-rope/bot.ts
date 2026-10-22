import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MashBot, mashRate } from '../../engines/reflex/index.ts'
import { HAUL, OVERTIME } from './rules.ts'

/**
 * Computer puller: mashes at a difficulty rate with human jitter, throws in a
 * haul now and then (stronger bots haul harder), digs in when the knot nears
 * its own line and, below hard, eases off a little when comfortably ahead (so
 * games stay close).
 */
export class RopeBot {
  private mash: MashBot
  /** Extra pull (in taps) of this step's hauls, read after `step`. */
  extra = 0

  constructor(
    private rng: Rng,
    private d: Difficulty,
    private side: Side,
  ) {
    this.mash = new MashBot(rng, mashRate(d))
  }

  /** Taps this step, given the knot position (+1 = red's line) and the round clock. */
  step(dt: number, pos: number, roundT = 0): number {
    // Lead from this bot's point of view: 1 = about to win.
    const lead = this.side === 1 ? -pos : pos
    // Easier bots relax when comfortably ahead, which keeps games close.
    const relax = this.d === 'hard' ? 0 : this.d === 'normal' ? 0.08 : 0.2
    // Everyone digs in near their own line; hard also closes out and grinds overtime.
    const dig = lead < -0.55 ? (this.d === 'easy' ? 0.06 : 0.12) : 0
    const close = this.d === 'hard' && (lead > 0.6 || roundT > OVERTIME) ? 0.08 : 0
    // Normal and hard pull above the engine's base rates (hard near a fast human's pace).
    const pace = this.d === 'easy' ? 1 : this.d === 'normal' ? 1.1 : 1.07
    this.mash.rate = mashRate(this.d) * pace * (1 - Math.max(0, lead - 0.4) * relax + dig + close)
    const n = this.mash.step(dt)
    // Some taps are hauls: a fraction of the human maximum, by difficulty.
    const haul = this.d === 'easy' ? 0 : this.d === 'normal' ? 0.25 : 0.4
    this.extra = 0
    for (let i = 0; i < n; i++)
      if (this.rng.chance(haul)) this.extra += HAUL * this.rng.range(0.3, 0.8)
    return n
  }
}
