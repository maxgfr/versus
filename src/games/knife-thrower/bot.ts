import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  angleIn,
  arrivalPhi,
  blocked,
  circDist,
  FLY,
  frontOf,
  KNIFE_W,
  type State,
  throwKnife,
} from './rules.ts'

/** Seconds the computer takes between noticing a free gap and throwing. */
export function reaction(d: Difficulty, rng: Rng): number {
  return (d === 'easy' ? 0.7 : d === 'normal' ? 0.36 : 0.2) * rng.range(0.8, 1.25)
}

/** Timing error: the throw leaves up to this many seconds after the bot saw its gap (s). */
export const TIMING: Record<Difficulty, number> = { easy: 0.17, normal: 0.035, hard: 0.018 }

/** Extra clearance (rad) the computer wants beside a stuck knife before it throws. */
export const MARGIN: Record<Difficulty, number> = { easy: 0.03, normal: 0.08, hard: 0.06 }

/**
 * Whether it reads the log's pattern ahead (a flip due mid-flight, the wobble)
 * or assumes the spin it sees right now just carries on.
 */
export const LOOKAHEAD: Record<Difficulty, boolean> = { easy: false, normal: true, hard: true }

/**
 * The computer for one log. Each step it asks whether a knife thrown now would
 * arrive in a clear gap (with a margin, by difficulty), and if so throws after a
 * small timing error. It is a real player: it sees only the log and the knives.
 */
export class KnifeBot {
  private wait = 0
  private delay: number | null = null

  constructor(
    readonly side: Side,
    readonly difficulty: Difficulty,
  ) {}

  /** Advance the bot by `dt`. Returns true on the step it throws. */
  step(s: State, dt: number, rng: Rng): boolean {
    const l = s.logs[this.side]
    if (s.ended || l.pause > 0) {
      this.delay = null
      return false
    }
    if (this.delay !== null) {
      // Committed: the thumb is already moving, so a late tap can still clip a knife.
      this.delay -= dt
      if (this.delay > 0) return false
      this.delay = null
      this.wait = reaction(this.difficulty, rng)
      return throwKnife(s, this.side)
    }
    this.wait -= dt
    if (this.wait > 0 || l.cool > 0) return false
    if (this.free(s)) this.delay = rng.range(0, TIMING[this.difficulty])
    else this.wait = 0.03
    return false
  }

  /** Is the gap where a knife thrown now would land still clear, with margin? */
  private free(s: State): boolean {
    const l = s.logs[this.side]
    const margin = MARGIN[this.difficulty]
    // Aim for the middle of its timing window, reading the pattern ahead if it can.
    const lead = FLY + TIMING[this.difficulty] / 2
    const ahead = (dt: number): number =>
      LOOKAHEAD[this.difficulty] ? angleIn(l, dt) : l.a + l.w * dt
    const phi = LOOKAHEAD[this.difficulty] ? arrivalPhi(l, lead) : frontOf(ahead(lead))
    if (blocked(l, phi, margin)) return false
    for (const f of s.flying) {
      if (f.side !== this.side) continue
      const p = frontOf(ahead(f.at - s.now))
      if (circDist(p, phi) < KNIFE_W + margin) return false
    }
    return true
  }
}
