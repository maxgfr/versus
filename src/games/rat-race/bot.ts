import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BEAT } from './rules.ts'

/** Grid the bot taps on: eighth notes. Even grid points are on the beat. */
const GRID = BEAT / 2
/** Chance to tap each grid point. */
const CADENCE: Record<Difficulty, number> = { easy: 0.55, normal: 0.8, hard: 0.95 }
/** Timing error (s, one standard deviation about the grid point). */
const JITTER: Record<Difficulty, number> = { easy: 0.08, normal: 0.04, hard: 0.02 }

/**
 * Computer runner: taps the eighth-note grid at a difficulty cadence, with
 * timing jitter. Beat taps land inside the perfect window more often on harder settings.
 */
export class RhythmBot {
  private last = -1
  private pending: number[] = []

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** Taps to make this step (0 or 1). */
  step(now: number): number {
    const idx = Math.floor(now / GRID)
    if (idx > this.last) {
      this.last = idx
      if (this.rng.chance(CADENCE[this.d])) {
        const j = JITTER[this.d]
        // A triangular spread (sum of two uniforms) reads as human timing.
        const err = (this.rng.next() + this.rng.next() - 1) * j * 1.7
        this.pending.push(idx * GRID + err)
      }
    }
    let n = 0
    this.pending = this.pending.filter((t) => {
      if (t <= now) {
        n++
        return false
      }
      return true
    })
    return n
  }
}
