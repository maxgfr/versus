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
 * Chance of an extra sixteenth-note tap between grid points when it matters
 * (behind, or on the final lap). Stays well under the mash limit.
 */
const FILL: Record<Difficulty, number> = { easy: 0, normal: 0.3, hard: 0.65 }

/**
 * Computer runner: taps the eighth-note grid at a difficulty cadence, with
 * timing jitter. Beat taps land inside the perfect window more often on harder
 * settings. When behind or on the final lap, normal and hard bots also fill in
 * sixteenth notes to push.
 */
export class RhythmBot {
  private last = -1
  private pending: number[] = []

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /**
   * Taps to make this step. `lead` is this rat's angle minus the rival's
   * (negative = behind), `final` whether it is on its last lap.
   */
  step(now: number, lead = 0, final = false): number {
    const idx = Math.floor(now / GRID)
    if (idx > this.last) {
      this.last = idx
      const j = JITTER[this.d]
      if (this.rng.chance(CADENCE[this.d])) {
        // A triangular spread (sum of two uniforms) reads as human timing.
        const err = (this.rng.next() + this.rng.next() - 1) * j * 1.7
        this.pending.push(idx * GRID + err)
      }
      // Push: a sixteenth between this grid point and the next.
      if ((lead < -0.4 || final) && this.rng.chance(FILL[this.d])) {
        const err = (this.rng.next() + this.rng.next() - 1) * j
        this.pending.push(idx * GRID + GRID / 2 + err)
      }
    }
    let n = 0
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if ((this.pending[i] as number) <= now) {
        n++
        this.pending.splice(i, 1)
      }
    }
    return n
  }
}
