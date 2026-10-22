import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure slap logic. One side attacks, the other defends. The attacker's hand
 * lifts when they press. Holding past COMMIT makes the slap real: it lands
 * STRIKE seconds later unless the defender has pulled away. Letting go before
 * COMMIT is a fake: it comes back empty, and a defender who flinches gives the
 * attacker a point. Flicking the finger toward the midline commits at once,
 * and the harder the flick, the faster (and harder) the slap lands.
 */

/** Points to win the match. */
export const TARGET = 5
/** Seconds the attacker must keep holding before the slap is committed. */
export const COMMIT = 0.2
/** Seconds from commit to impact for a held slap: the defender's window to pull away. */
export const STRIKE = 0.36
/** Seconds from commit to impact for the hardest flick. */
export const STRIKE_MIN = 0.28
/** Force of a slap committed by holding (a flick is at least this hard). */
export const HOLD_FORCE = 0.4
/** A press this close to the end of the rest is queued instead of dropped. */
export const BUFFER = 0.15
/** Seconds a fake lasts (a defender can flinch during it). */
export const FAKE = 0.42
/** Rest before the attacker may press again: minimum and random spread. */
export const REST = 0.75
export const REST_SPREAD = 0.6
/** Seconds of rest before the first attack of a match. */
export const FIRST = 1.2

/** Hand distances from the midline, in the owner's own frame (positive = own side). */
export const A_REST = 230
export const D_REST = 170
export const LIFT = 40
export const IMPACT = -60
export const PULLED = 320

export type Phase = 'rest' | 'wind' | 'fake' | 'strike'

/** Something that happened this step, for effects and sound. */
export type Ev = 'wind' | 'fake' | 'commit' | 'pull' | 'connect' | 'flinch' | 'whiff' | 'swap'

export interface Duel {
  att: Side
  phase: Phase
  /** Seconds into the current phase. */
  t: number
  /** Seconds of rest left before the attacker may press. */
  cool: number
  /** The defender tapped during the wind-up. Resolved when the attack shows its hand. */
  pend: boolean
  /** The defender pulled away from this attack (a dodge, or a pre-emptive tap on a real one). */
  dodged: boolean
  /** The defender already flinched on this fake. */
  flinched: boolean
  /** 0..1 force of the current (or last) slap: a hold is HOLD_FORCE, a flick up to 1. */
  force: number
  /** Seconds from commit to impact for the current slap (harder = faster). */
  strike: number
  /** The attacker pressed just before the rest ended and is still holding. */
  queued: boolean
  points: [number, number]
}

export const duelNew = (att: Side): Duel => ({
  att,
  phase: 'rest',
  t: 0,
  cool: FIRST,
  pend: false,
  dodged: false,
  flinched: false,
  force: HOLD_FORCE,
  strike: STRIKE,
  queued: false,
  points: [0, 0],
})

/** Seconds from commit to impact for a slap of `force` (0..1). */
export const strikeTime = (force: number): number =>
  STRIKE -
  ((Math.max(HOLD_FORCE, Math.min(1, force)) - HOLD_FORCE) / (1 - HOLD_FORCE)) *
    (STRIKE - STRIKE_MIN)

/**
 * What one side did this step. `held` is still down; `press` went down this
 * step; `tap` went down this step. `flick` (attacker, 0..1) is how hard the
 * finger is pushed toward the midline: any flick commits the slap at once,
 * and a harder one lands faster.
 */
export interface Touch {
  press: boolean
  held: boolean
  tap: boolean
  flick?: number
}

/**
 * Advance the duel by `dt`. Mutates `d` and returns the events. The caller
 * reads `d.points` for the match winner.
 */
export function stepDuel(d: Duel, dt: number, a: Touch, b: Touch, rng: Rng): Ev[] {
  const evs: Ev[] = []
  const att = d.att
  const def = other(att)
  // Attacker input (their half) and defender input (theirs).
  const press = a.press
  const held = a.held
  const pull = b.tap
  d.t += dt

  if (d.phase === 'rest') {
    d.cool = Math.max(0, d.cool - dt)
    // A press a hair before the rest ends is queued, not swallowed.
    if (press && d.cool > 0 && d.cool <= BUFFER) d.queued = true
    if (!held) d.queued = false
    if ((press || d.queued) && d.cool <= 0) {
      d.phase = 'wind'
      d.t = 0
      d.pend = false
      d.dodged = false
      d.flinched = false
      d.queued = false
      d.force = HOLD_FORCE
      d.strike = STRIKE
      evs.push('wind')
    }
    return evs
  }

  if (d.phase === 'wind') {
    if (pull) d.pend = true
    const flick = a.flick ?? 0
    if (flick > 0 || (held && d.t >= COMMIT)) {
      // Committed: by holding through the wind-up, or at once by a flick.
      d.phase = 'strike'
      d.t = 0
      d.force = flick > 0 ? Math.max(HOLD_FORCE, Math.min(1, flick)) : HOLD_FORCE
      d.strike = strikeTime(d.force)
      evs.push('commit')
      if (d.pend) {
        d.dodged = true
        evs.push('pull')
      }
      return evs
    }
    if (!held) {
      // Let go before the commit point: a fake.
      d.phase = 'fake'
      d.t = 0
      evs.push('fake')
      if (d.pend) {
        d.flinched = true
        d.points[att]++
        evs.push('flinch')
      }
      return evs
    }
    return evs
  }

  if (d.phase === 'fake') {
    if (pull && !d.flinched) {
      d.flinched = true
      d.points[att]++
      evs.push('flinch')
    }
    // A fake costs no point, so it gets a shorter rest: keep the duel moving.
    if (d.t >= FAKE) finish(d, rng, 0.6)
    return evs
  }

  // strike
  if (pull && !d.dodged && d.t < d.strike) {
    d.dodged = true
    evs.push('pull')
  }
  if (d.t >= d.strike) {
    if (d.dodged) {
      evs.push('whiff')
      d.att = def
      evs.push('swap')
    } else {
      d.points[att]++
      evs.push('connect')
    }
    finish(d, rng)
  }
  return evs
}

function finish(d: Duel, rng: Rng, k = 1): void {
  d.phase = 'rest'
  d.t = 0
  d.cool = (REST + rng.range(0, REST_SPREAD)) * k
  d.pend = false
  d.dodged = false
  d.flinched = false
}

/** Where a side's hand should be (own-frame distance from the midline). */
export function handTarget(d: Duel, side: Side): number {
  if (side === d.att) {
    if (d.phase === 'wind') return A_REST + LIFT
    if (d.phase === 'strike') return IMPACT
    return A_REST
  }
  if (d.dodged || d.flinched) return PULLED
  return D_REST
}

/** Returns the winner once a side has reached `target` points. */
export function matchWinner(d: Duel, target = TARGET): Side | null {
  if (d.points[0] >= target) return 0
  if (d.points[1] >= target) return 1
  return null
}
