import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { COMMIT, STRIKE, type Phase, type Touch } from './rules.ts'

/** What a bot sees of the duel each step. */
export interface View {
  phase: Phase
  t: number
  cool?: number
  /** Defender tapped during the wind-up (the attacker learns from it). */
  pend?: boolean
  /** Defender flinched on the current fake. */
  flinched?: boolean
  /** Seconds from commit to impact of the current slap. */
  strike?: number
}

interface Tune {
  /** Defender reaction to a committed slap, seconds [min, max]. */
  react: [number, number]
  /** Chance a defender freezes and never pulls away. */
  freeze: number
  /** Chance a defender flinches on a fake. */
  flinch: number
  /** Base share of fakes as attacker. */
  fake: number
  /** Share of real slaps thrown as a flick, and the flick's force range. */
  flick: number
  force: [number, number]
  /** Reads the rival: adapts its fakes and pulls early on a predictable attacker. */
  learns: boolean
}

export const TUNING: Record<Difficulty, Tune> = {
  easy: {
    react: [0.32, 0.5],
    freeze: 0.08,
    flinch: 0.14,
    fake: 0.5,
    flick: 0.1,
    force: [0.4, 0.55],
    learns: false,
  },
  normal: {
    react: [0.24, 0.38],
    freeze: 0.04,
    flinch: 0.03,
    fake: 0.35,
    flick: 0.65,
    force: [0.5, 0.85],
    learns: true,
  },
  hard: {
    // A sharp human's reaction to a visible commit: fast, not superhuman. A held
    // slap rarely lands on it; a hard flick still gets through about a third of the time.
    react: [0.19, 0.29],
    freeze: 0.02,
    flinch: 0,
    fake: 0.3,
    flick: 0.95,
    force: [0.75, 1],
    learns: true,
  },
}

/**
 * Computer hands. As attacker it presses at a human rhythm and mixes real
 * slaps (held, or flicked for speed) with quick fakes; on hard it fakes more
 * against a jumpy defender and less against a patient one. As defender it
 * pulls away after a difficulty-scaled reaction to the commit (a hard flick
 * leaves it less time), sometimes flinches on a fake, and on hard pulls early
 * against an attacker who never fakes. Not part of the snapshot (bots only
 * run on the host).
 */
export class SlapBot {
  private tune: Tune
  private lastPhase: Phase = 'rest'
  // Attacker.
  /** Seconds before the next press. */
  private wait = 0.5
  /** Wind-up time at which it lets go (a fake), or flicks (a real slap). */
  private release = Infinity
  private flickAt = Infinity
  private flickForce = 0
  /** Memory of the defender: attacks resolved, and how many it jumped at. */
  private seen = 0
  private jumped = 0
  private jumpy = false
  // Defender.
  private armed = false
  private react = 0
  private flinch = false
  private tapped = false
  private earlyAt = Infinity
  /** Memory of the attacker: wind-ups resolved, and how many were fakes. */
  private attacks = 0
  private fakes = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.tune = TUNING[d]
  }

  /** This step's touch, given the duel as it stands. */
  drive(dt: number, role: 'att' | 'def', v: View): Touch {
    const out = role === 'att' ? this.attack(dt, v) : this.defend(v)
    this.lastPhase = v.phase
    return out
  }

  private attack(dt: number, v: View): Touch {
    const none: Touch = { press: false, held: false, tap: false }
    // Learn from each attack: did the defender jump at the wind-up or the fake?
    if (v.pend || v.flinched) this.jumpy = true
    if (v.phase === 'rest' && this.lastPhase !== 'rest') {
      this.seen++
      if (this.jumpy) this.jumped++
      this.jumpy = false
    }
    if (v.phase === 'rest') {
      this.wait -= dt
      if ((v.cool ?? 0) > 0 || this.wait > 0) return none
      let fake = this.tune.fake
      if (this.tune.learns && this.seen >= 3) {
        // Fake a jumpy defender; just slap one who never bites.
        const rate = this.jumped / this.seen
        fake = Math.min(0.65, Math.max(0.12, 0.15 + rate * 0.8))
      }
      const real = !this.rng.chance(fake)
      this.release = real ? Infinity : this.rng.range(0.03, 0.12)
      this.flickAt =
        real && this.rng.chance(this.tune.flick) ? this.rng.range(0.05, COMMIT - 0.03) : Infinity
      this.flickForce = this.rng.range(this.tune.force[0], this.tune.force[1])
      this.wait = this.rng.range(0.15, 0.8)
      return { press: true, held: true, tap: false }
    }
    if (v.phase === 'wind') {
      if (v.t >= this.flickAt)
        return { press: false, held: true, tap: false, flick: this.flickForce }
      return { press: false, held: v.t < this.release, tap: false }
    }
    return none
  }

  private defend(v: View): Touch {
    const none: Touch = { press: false, held: false, tap: false }
    const tap: Touch = { press: false, held: false, tap: true }
    if (v.phase === 'rest') {
      this.armed = false
      this.tapped = false
      this.earlyAt = Infinity
      return none
    }
    if (v.phase === 'wind') {
      if (this.lastPhase !== 'wind') {
        this.armed = false
        this.tapped = false
        this.earlyAt = Infinity
        // A reader pulls early against an attacker who (almost) never fakes.
        if (this.tune.learns && this.attacks >= 4 && this.fakes / this.attacks < 0.15)
          if (this.rng.chance(0.55)) this.earlyAt = this.rng.range(0.03, 0.1)
      }
      if (!this.tapped && v.t >= this.earlyAt) {
        this.tapped = true
        return tap
      }
      return none
    }
    if (!this.armed) {
      this.armed = true
      this.attacks++
      if (v.phase === 'fake') this.fakes++
      if (v.phase === 'strike') {
        // Human-ish reaction to the commit; now and then it simply freezes.
        const [lo, hi] = this.tune.react
        this.react = this.rng.chance(this.tune.freeze) ? Infinity : v.t + this.rng.range(lo, hi)
        // A hard flick is a blur: it takes a touch longer to read.
        if ((v.strike ?? STRIKE) < STRIKE - 0.04) this.react += 0.02
      } else {
        // A fake: only a careless bot flinches, and only sometimes.
        this.flinch = this.rng.chance(this.tune.flinch)
        this.react = v.t + this.rng.range(0.15, 0.3)
      }
    }
    if (this.tapped) return none
    if (v.phase === 'fake' && !this.flinch) return none
    if (v.t >= this.react) {
      this.tapped = true
      return tap
    }
    return none
  }
}
