import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { Guard, GuardPhase } from './rules.ts'

/** Reaction time (s) after each guard cue, by difficulty. */
const REACT: Record<Difficulty, [number, number]> = {
  easy: [0.62, 1.1],
  normal: [0.4, 0.74],
  hard: [0.24, 0.44],
}

/**
 * Computer thief: holds the pile while the guard naps and lets go on the
 * warning, each change coming a human-ish reaction after the cue. Slow
 * reactions (easy) get caught with the stash; fast ones (hard) almost never.
 */
export class ThiefBot {
  private phase: GuardPhase = 'sleep'
  private cueAt = 0
  private react: number

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {
    this.react = this.sample()
  }

  private sample(): number {
    const [a, b] = REACT[this.d]
    return this.rng.range(a, b)
  }

  /** Should this thief's finger be on the pile now? */
  decide(guard: Guard, time: number): boolean {
    if (guard.phase !== this.phase) {
      this.phase = guard.phase
      this.cueAt = time
      this.react = this.sample()
    }
    const since = time - this.cueAt
    if (this.phase === 'sleep') return since >= this.react
    if (this.phase === 'stir') return since < this.react
    return false
  }
}
