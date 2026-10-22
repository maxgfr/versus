import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { gaugeNew, gaugeStep, gaugeStop, type GaugeState } from '../../engines/reflex/index.ts'

/**
 * Pure strongman logic. Each round both players swing a timing gauge and tap
 * to stop it. The height of the stopped needle (0 = bottom, 1 = the very top)
 * is how far the puck flies up that player's column. The higher score wins the
 * round; the score is the height in whole percent, exactly what the readout
 * shows, so two equal readouts are a drawn round and never a silent decision.
 */

/** Round wins needed to take the match: best of 5. */
export const TARGET = 3
/** Seconds the gauges sit still at the start of a round (taps are ignored). */
export const LEAD = 0.8
/** Seconds after the lead-in that an idle side has before it misses (puck stays down). */
export const TIMEOUT = 5
/** The last seconds of the timeout are counted down out loud. */
export const COUNTDOWN = 3
/** Seconds after both pucks have been struck before the round is scored. */
export const SETTLE = 0.8
/** Seconds a puck takes to fly its column. */
export const FLY = 0.55
/** A puck this high rings the bell (96 and up on the readout). */
export const RING_AT = 0.96

export interface Swing {
  gauge: GaugeState
  /** Puck height 0..1 once stopped, -1 while the gauge swings. */
  height: number
  /** Round time (s) of the stop, -1 while swinging. */
  stopT: number
  /** The puck has arrived at the top of the column (juice fired). */
  landed: boolean
  /** The side never struck: its puck stays down. */
  missed: boolean
}

export const swingNew = (speed: number): Swing => ({
  gauge: gaugeNew(speed),
  height: -1,
  stopT: -1,
  landed: false,
  missed: false,
})

export const swingStopped = (sw: Swing): boolean => sw.height >= 0

/** The round score of a height: whole percent, as the readout shows it. */
export const score = (height: number): number => Math.round(Math.max(0, height) * 100)

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
  sw.missed = true
  return true
}

/** Seconds left before an idle side misses (Infinity once it has struck). */
export function timeLeft(sw: Swing, rt: number): number {
  if (swingStopped(sw)) return Infinity
  return Math.max(0, LEAD + TIMEOUT - rt)
}

/** Puck height 0..1 at round time `rt`: eases up the column after the stop. */
export function puckHeight(sw: Swing, rt: number): number {
  if (!swingStopped(sw) || sw.stopT < 0) return 0
  const t = Math.min(1, Math.max(0, (rt - sw.stopT) / FLY))
  return sw.height * (1 - (1 - t) ** 3)
}

export const ringsBell = (height: number): boolean => score(height) >= score(RING_AT)

/** The round winner from two puck heights: the higher readout wins, equal readouts draw. */
export function roundWinner(a: number, b: number): Side | 'draw' {
  const sa = score(a)
  const sb = score(b)
  if (sa === sb) return 'draw'
  return sa > sb ? 0 : 1
}

/** Gauge speed cap (sweeps per second) from rounds alone, and the extra at match point. */
export const SPEED_CAP = 1.6
export const MATCH_POINT_BOOST = 0.18

/** Is either side one round win from the match? */
export const matchPoint = (wins: readonly [number, number], target: number): boolean =>
  target > 1 && Math.max(wins[0], wins[1]) >= target - 1

/**
 * Gauge speed (sweeps per second) for a round: quicker every round, and a
 * notch quicker again at match point so the decider is tense. Both sides
 * share it, so it is fair.
 */
export function roundSpeed(round: number, rng: Rng, atMatchPoint = false): number {
  const base = Math.min(SPEED_CAP, 0.7 + round * 0.08) + (atMatchPoint ? MATCH_POINT_BOOST : 0)
  return base * rng.range(0.96, 1.04)
}

/** What a swing did this step, for juice. */
export type SwingEvent =
  | { kind: 'stop'; side: Side; height: number; speed: number }
  | { kind: 'miss'; side: Side }
  | { kind: 'land'; side: Side; height: number; missed: boolean }
  | { kind: 'tick'; side: Side; left: number }

/**
 * One fixed step of a side's swing: the needle moves, a press stops it (or the
 * timeout does), the puck lands `FLY` s later, and the last seconds before a
 * miss tick. `rt` is the round time after this step.
 */
export function swingUpdate(
  sw: Swing,
  side: Side,
  dt: number,
  rt: number,
  pressed: boolean,
): SwingEvent[] {
  const out: SwingEvent[] = []
  if (!swingStopped(sw)) {
    const before = Math.ceil(timeLeft(sw, rt - dt))
    swingStep(sw, dt, rt)
    if (pressed && swingTap(sw, rt))
      out.push({ kind: 'stop', side, height: sw.height, speed: sw.gauge.speed })
    else if (swingTimeout(sw, rt)) out.push({ kind: 'miss', side })
    else {
      const left = Math.ceil(timeLeft(sw, rt))
      if (left < before && left <= COUNTDOWN && left > 0) out.push({ kind: 'tick', side, left })
    }
  }
  if (swingStopped(sw) && !sw.landed && rt >= sw.stopT + FLY - 1e-9) {
    sw.landed = true
    out.push({ kind: 'land', side, height: sw.height, missed: sw.missed })
  }
  return out
}
