import { other, type Side } from '../../core/game.ts'
import { MID } from '../../core/stage.ts'
import type { Rng } from '../../core/rng.ts'
import { signalNew, type SignalState } from '../../engines/reflex/index.ts'

/**
 * Pure rules for the last piece of sashimi. Each round the bell rings after a
 * random wait, with decoy flashes before it. The first tap after the real bell
 * takes the piece; a tap before it (a false start, decoys included) loses the round.
 */

/** Round wins needed to take the match: best of 5. */
export const TARGET = 3
/** Shortest and longest wait before the real bell, in seconds. */
export const WAIT_MIN = 1.4
export const WAIT_MAX = 4.2
/** A decoy flash never lands closer than this to the real bell. */
export const DECOY_GAP = 0.5
/** A decoy flash never comes before this. */
export const DECOY_FIRST = 0.6
/** How long a decoy flash stays on screen, in seconds. */
export const DECOY_SHOW = 0.3

/**
 * Taps in the first moments of a round are leftovers from celebrating the last
 * one, not a grab: they are ignored instead of counting as a false start.
 */
export const GRACE = 0.3
/** Nobody grabbed within this long after the bell: the round is void. */
export const LIVE_MAX = 3
/**
 * Local 2P: the piece sits on the midline, so a touch this close to it cannot
 * be told apart (a red finger on the top of the piece lands in blue's half).
 * Such touches are ignored rather than handed to the wrong player.
 */
export const DEAD = 70

/** Who a local 2P touch at world `y` belongs to (null: too close to the middle). */
export function tapSide(y: number): Side | null {
  if (Math.abs(y - MID) < DEAD) return null
  return y > MID ? 0 : 1
}

/** Round start: the real bell is scheduled with the reflex engine's signal scheduler. */
export function roundSignal(rng: Rng): SignalState {
  return signalNew(rng, WAIT_MIN, WAIT_MAX, 0)
}

/**
 * Seeded decoy flash times (seconds since the wait began), in order, before the
 * real bell. More of them when `tense` (someone is one round from winning).
 */
export function decoysFor(rng: Rng, realAt: number, tense = false): number[] {
  // At match point the wait gets tenser: always a decoy, sometimes three.
  const count = tense ? rng.int(1, 3) : rng.int(0, 2)
  const hi = realAt - DECOY_GAP
  if (hi <= DECOY_FIRST) return []
  const times: number[] = []
  for (let i = 0; i < count; i++) times.push(rng.range(DECOY_FIRST, hi))
  return times.sort((a, b) => a - b)
}

/**
 * Who wins this step from the taps. Before the real bell any tap is a false
 * start and the other side takes the round; after it, the first tap takes it.
 * Taps in the same step cancel out into a draw.
 */
export function judgeTaps(
  phase: SignalState['phase'],
  tapped: [boolean, boolean],
): Side | 'draw' | null {
  const [a, b] = tapped
  if (!a && !b) return null
  if (a && b) return 'draw'
  const who: Side = a ? 0 : 1
  return phase === 'wait' ? other(who) : who
}

/** 0..1 how sharp a grab `reaction` seconds after the bell was (drives the fanfare). */
export function snap(reaction: number): number {
  return Math.max(0, Math.min(1, (0.6 - reaction) / 0.4))
}

/** A label for a quick grab, or '' for an ordinary one. */
export function grabLabel(reaction: number): string {
  return reaction < 0.24 ? 'LIGHTNING!' : reaction < 0.32 ? 'SWIFT!' : ''
}

/** Reaction time after the real bell, by difficulty (seconds). */
export function reactionRange(d: 'easy' | 'normal' | 'hard'): [number, number] {
  return d === 'easy' ? [0.42, 0.55] : d === 'normal' ? [0.3, 0.38] : [0.22, 0.28]
}

/** Chance a bot falls for a decoy flash, by difficulty. */
export function slipChance(d: 'easy' | 'normal' | 'hard'): number {
  return d === 'easy' ? 0.3 : d === 'normal' ? 0.1 : 0.03
}
