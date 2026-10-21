import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { Touch, Phase } from './rules.ts'

/**
 * Computer hands. As attacker it presses at random, mostly for real slaps and
 * sometimes for a quick fake. As defender it waits for the slap to commit and
 * pulls away after a difficulty-scaled reaction, and now and then flinches on
 * a fake.
 */
export class SlapBot {
  /** Seconds before the next press (attacker). */
  private wait = 0.5
  /** Wind-up time at which the attacker lets go: Infinity for a real slap. */
  private release = Infinity
  /** Defender: the attack's reaction has been planned. */
  private armed = false
  private react = 0
  private flinch = false
  private tapped = false

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** This step's touch, given the duel as it stands. */
  drive(dt: number, role: 'att' | 'def', v: { phase: Phase; t: number; cool?: number }): Touch {
    return role === 'att' ? this.attack(dt, v) : this.defend(v)
  }

  private attack(dt: number, v: { phase: Phase; t: number; cool?: number }): Touch {
    const none: Touch = { press: false, held: false, tap: false }
    if (v.phase === 'rest') {
      this.wait -= dt
      if ((v.cool ?? 0) > 0 || this.wait > 0) return none
      const real = this.rng.chance(this.d === 'easy' ? 0.5 : this.d === 'normal' ? 0.6 : 0.7)
      this.release = real ? Infinity : this.rng.range(0.03, 0.12)
      this.wait = this.rng.range(0.2, 0.9)
      return { press: true, held: true, tap: false }
    }
    if (v.phase === 'wind') return { press: false, held: v.t < this.release, tap: false }
    return none
  }

  private defend(v: { phase: Phase; t: number }): Touch {
    const none: Touch = { press: false, held: false, tap: false }
    if (v.phase === 'rest' || v.phase === 'wind') {
      this.armed = false
      this.tapped = false
      return none
    }
    if (!this.armed) {
      this.armed = true
      this.tapped = false
      if (v.phase === 'strike') {
        // Human-ish reaction: a slow bot often gets caught by the slap.
        const [lo, hi] =
          this.d === 'easy' ? [0.34, 0.5] : this.d === 'normal' ? [0.26, 0.4] : [0.24, 0.42]
        this.react = v.t + this.rng.range(lo, hi)
      } else {
        // A fake: only a careless bot flinches, and only sometimes.
        this.flinch = this.rng.chance(this.d === 'easy' ? 0.12 : this.d === 'normal' ? 0.04 : 0)
        this.react = v.t + this.rng.range(0.15, 0.3)
      }
    }
    if (this.tapped) return none
    if (v.phase === 'fake' && !this.flinch) return none
    if (v.t >= this.react) {
      this.tapped = true
      return { press: false, held: false, tap: true }
    }
    return none
  }
}
