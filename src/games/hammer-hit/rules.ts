import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { gaugeNew, gaugeStep, gaugeStop, type GaugeState } from '../../engines/reflex/index.ts'

/**
 * Pure strongman logic. Each round both players swing a timing gauge and tap
 * to stop it. The height of the stopped needle (0 = bottom, 1 = the very top)
 * is how far the puck flies up that player's column. Higher puck wins the round.
 */

/** Round wins needed to take the match: best of 5. */
export const TARGET = 3
/** Seconds the gauges sit still at the start of a round (taps are ignored). */
export const LEAD = 1
/** Seconds after the lead-in that an idle side has before it misses (puck stays down). */
export const TIMEOUT = 6
/** Seconds after both pucks have landed before the round is scored. */
export const SETTLE = 0.9
/** Seconds a puck takes to fly its column. */
export const FLY = 0.55
/** A puck this high rings the bell. */
export const RING_AT = 0.96
/** Pucks closer than this make a drawn round. */
export const TIE = 0.01

export interface Swing {
  gauge: GaugeState
  /** Puck height 0..1 once stopped, -1 while the gauge swings. */
  height: number
  /** Round time (s) of the stop, -1 while swinging. */
  stopT: number
  /** The puck has arrived at the top of the column (juice fired). */
  landed: boolean
}

export const swingNew = (speed: number): Swing => ({
  gauge: gaugeNew(speed),
  height: -1,
  stopT: -1,
  landed: false,
})

export const swingStopped = (sw: Swing): boolean => sw.height >= 0

/** Advance the needle. It only moves once the lead-in is over and while not stopped. */
export function swingStep(sw: Swing, dt: number, rt: number): void {
  if (swingStopped(sw) || rt < LEAD) return
  gaugeStep(sw.gauge, dt)
}

/** A tap stops the needle where it is. Ignored during the lead-in or once stopped. */
export function swingTap(sw: Swing, rt: number): boolean {
  if (swingStopped(sw) || rt < LEAD) return false
  sw.height = gaugeStop(sw.gauge)
  sw.stopT = rt
  return true
}

/** Idle past the timeout: the puck never leaves the ground. */
export function swingTimeout(sw: Swing, rt: number): boolean {
  if (swingStopped(sw) || rt < LEAD + TIMEOUT) return false
  sw.height = 0
  sw.stopT = rt
  return true
}

/** Puck height 0..1 at round time `rt`: eases up the column after the stop. */
export function puckHeight(sw: Swing, rt: number): number {
  if (!swingStopped(sw) || sw.stopT < 0) return 0
  const t = Math.min(1, Math.max(0, (rt - sw.stopT) / FLY))
  return sw.height * (1 - (1 - t) ** 3)
}

export const ringsBell = (height: number): boolean => height >= RING_AT

/** The round winner from two puck heights: higher wins, close heights draw. */
export function roundWinner(a: number, b: number): Side | 'draw' {
  if (Math.abs(a - b) < TIE) return 'draw'
  return a > b ? 0 : 1
}

/** Gauge speed (sweeps per second) for a round. Both sides share it, so it is fair. */
export function roundSpeed(round: number, rng: Rng): number {
  return Math.min(1.5, 0.7 + round * 0.06) * rng.range(0.96, 1.04)
}
