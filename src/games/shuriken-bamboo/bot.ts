import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Aim, originX, type State, targets, THROW_Y, canThrow } from './rules.ts'

/**
 * The computer's swipe. When its arm is ready it waits a reaction delay, picks
 * one of the most valuable stalks it can see, and swipes at it with some error.
 * Every level sometimes swipes wide on purpose.
 */

const LEVEL: Record<Difficulty, { react: number; err: number; miss: number }> = {
  easy: { react: 1.5, err: 0.12, miss: 0.3 },
  normal: { react: 0.9, err: 0.06, miss: 0.12 },
  hard: { react: 0.5, err: 0.025, miss: 0.03 },
}

export class Bot {
  /** Seconds to wait before the next swipe; null while the arm is recovering. */
  private think: number | null = null

  constructor(
    private readonly d: Difficulty,
    private readonly rng: Rng,
  ) {}

  /** Returns the swipe on the step the bot throws, else null. */
  tick(s: State, side: Side, dt: number): Aim | null {
    const lv = LEVEL[this.d]
    if (!canThrow(s, side)) {
      this.think = null
      return null
    }
    if (this.think === null) this.think = lv.react * this.rng.range(0.75, 1.3)
    this.think -= dt
    if (this.think > 0) return null
    const pool = targets(s).slice(0, 4)
    if (pool.length === 0) {
      this.think = 0.25
      return null
    }
    const st = pool[this.rng.int(0, pool.length - 1)] ?? pool[0]
    if (!st) return null
    this.think = null
    const ty = THROW_Y[side] ?? 0
    const x = originX(st.x + this.rng.range(-200, 200))
    const len = Math.hypot(st.x - x, st.y - ty) || 1
    const wide = this.rng.chance(lv.miss)
    const e = wide ? this.rng.range(-0.4, 0.4) : this.rng.range(-lv.err, lv.err)
    const bx = (st.x - x) / len
    const by = (st.y - ty) / len
    return {
      x,
      dx: bx * Math.cos(e) - by * Math.sin(e),
      dy: bx * Math.sin(e) + by * Math.cos(e),
    }
  }
}
