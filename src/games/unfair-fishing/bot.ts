import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MashBot } from '../../engines/reflex/index.ts'
import { FISH, NO_TAPS, POND, type Phase, type Rod, SURGE_MUL, type Taps } from './rules.ts'

/**
 * Computer angler. It casts after a short pause, hooks a bite after a reaction
 * delay, then mashes at a difficulty-capped rate, steering the line toward the
 * middle of the green band. Easy anglers cannot out-mash a big fish; hard ones
 * can, but they still get knocked around by surges.
 */

/** Hardest mash rate (taps per second) by difficulty. */
const MAX_RATE: Record<Difficulty, number> = { easy: 6, normal: 7.9, hard: 9.4 }
/** Reaction to a bite, seconds. */
const REACT: Record<Difficulty, [number, number]> = {
  easy: [0.5, 0.8],
  normal: [0.3, 0.5],
  hard: [0.18, 0.3],
}

export class FishBot {
  private cool = 0.8
  private react = 0.4
  private biteT = 0
  private prev: Phase = 'idle'
  private mash: MashBot

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {
    this.mash = new MashBot(rng.fork(), 4)
  }

  /** The taps this step, given the rod's state. */
  act(r: Rod, dt: number): Taps {
    if (r.phase !== this.prev) {
      this.prev = r.phase
      // Easy dawdles between casts; hard casts again straight away.
      if (r.phase === 'idle')
        this.cool =
          this.rng.range(0.7, 1.5) * (this.d === 'hard' ? 0.4 : this.d === 'normal' ? 0.7 : 1)
      if (r.phase === 'bite') {
        const [a, b] = REACT[this.d]
        this.react = this.rng.range(a, b)
        this.biteT = 0
      }
    }
    switch (r.phase) {
      case 'idle': {
        this.cool -= dt
        if (this.cool > 0) return NO_TAPS
        // Cast somewhere in the pond, in front of the rod.
        return {
          n: 1,
          at: {
            x: this.rng.range(220, 780),
            y: this.rng.range(POND.y0 + 80, POND.y1 - 40),
          },
        }
      }
      case 'bite': {
        this.biteT += dt
        return this.biteT >= this.react ? { n: 1, at: null } : NO_TAPS
      }
      case 'reel': {
        const s = (FISH[r.kind] as (typeof FISH)[number]).strength
        // Near snapping, mash harder (that slackens the line); when slack, ease off.
        const err = r.tension - 0.5
        // Hard reads a surge: the fish pulls SURGE_MUL harder, so it mashes harder to match.
        const surge = this.d === 'hard' && r.surge > 0 ? SURGE_MUL : 1
        const want = Math.min(MAX_RATE[this.d], 6 * s * surge * (1 + 1.2 * err))
        this.mash.rate = Math.max(0.5, want)
        return { n: this.mash.step(dt), at: null }
      }
      default:
        return NO_TAPS
    }
  }
}
