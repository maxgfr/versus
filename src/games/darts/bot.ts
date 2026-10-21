import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BULL_PT, flickFor, gauss, type Pt, T20 } from './rules.ts'

/** How far the computer's dart lands from its aim, in board units (a gaussian). */
const SPREAD: Record<Difficulty, number> = { easy: 70, normal: 38, hard: 16 }

/**
 * Aim with a gaussian error, and turn the aim into a flick. A shaky arm goes for
 * the bull (the fattest scoring area); a steady one goes for treble 20.
 */
export function choose(side: Side, d: Difficulty, rng: Rng): Pt {
  const sigma = SPREAD[d]
  const aim = d === 'easy' ? BULL_PT : T20
  const target = { x: aim.x + gauss(rng) * sigma, y: aim.y + gauss(rng) * sigma }
  return flickFor(side, target)
}
