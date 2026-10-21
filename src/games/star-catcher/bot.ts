import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BASKET_SPEED, BASKET_Y, type Sky } from './rules.ts'

/**
 * Computer catcher. It follows the next star due to land in its sky, but only
 * re-aims every `lag` seconds, so it trails the sky a little. Easy catchers
 * are slow to slide, hard ones keep up.
 */

const CFG: Record<Difficulty, { lag: number; speed: number }> = {
  easy: { lag: 0.8, speed: 420 },
  normal: { lag: 0.35, speed: 850 },
  hard: { lag: 0.1, speed: 1400 },
}

export class StarBot {
  private aim = 500
  private timer = 0

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** The basket speed this bot can manage, world units per second. */
  get speed(): number {
    return Math.min(BASKET_SPEED, CFG[this.d].speed)
  }

  /** Basket target (sky x) this step. */
  step(s: Sky, dt: number): number {
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = CFG[this.d].lag
      this.aim = this.choose(s)
    }
    return this.aim
  }

  /** The star that lands next, with a little human wobble on the aim. */
  private choose(s: Sky): number {
    let next: { x: number; y: number } | null = null
    for (const it of s.items) {
      if (it.y > BASKET_Y - 20) continue
      if (!next || it.y > next.y) next = it
    }
    if (!next) return s.basket
    const wobble = this.d === 'hard' ? 0 : this.rng.range(-30, 30)
    return next.x + wobble
  }
}
