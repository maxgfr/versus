import { other, type Side } from '../../core/game.ts'
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

/** Round start: the real bell is scheduled with the reflex engine's signal scheduler. */
export function roundSignal(rng: Rng): SignalState {
  return signalNew(rng, WAIT_MIN, WAIT_MAX, 0)
}

/** Seeded decoy flash times (seconds since the wait began), in order, before the real bell. */
export function decoysFor(rng: Rng, realAt: number): number[] {
  const count = rng.int(0, 2)
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

/** Reaction time after the real bell, by difficulty (seconds). */
export function reactionRange(d: 'easy' | 'normal' | 'hard'): [number, number] {
  return d === 'easy' ? [0.42, 0.55] : d === 'normal' ? [0.34, 0.45] : [0.28, 0.34]
}

/** Chance a bot falls for a decoy flash, by difficulty. */
export function slipChance(d: 'easy' | 'normal' | 'hard'): number {
  return d === 'easy' ? 0.3 : d === 'normal' ? 0.15 : 0.04
}
