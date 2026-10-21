import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Bike, FLIP } from './rules.ts'

/** Wheelie angle (rad) each difficulty aims for. Higher means faster in the air, but closer to the flip. */
const TARGET: Record<Difficulty, number> = { easy: 0.42, normal: 0.5, hard: 0.6 }
/** Random error on the aim, redrawn at every decision (rad). */
const SPREAD: Record<Difficulty, number> = { easy: 0.2, normal: 0.08, hard: 0.02 }
/** Frames between decisions: the bot's reaction time. */
const REACT: Record<Difficulty, number> = { easy: 14, normal: 7, hard: 3 }
const KP = 9
const KD = 0.9

export interface Brain {
  timer: number
  on: boolean
  aim: number
}

export function newBrain(): Brain {
  return { timer: 0, on: false, aim: TARGET.normal }
}

/**
 * PD control on the wheelie angle: throttle while the angle is below the aim,
 * ease off while it climbs too fast. Safety overrides keep it from flipping or
 * dropping the front wheel, whatever its reaction time.
 */
export function drive(b: Bike, w: number, d: Difficulty, rng: Rng, brain: Brain): boolean {
  if (brain.timer <= 0) {
    brain.timer = REACT[d]
    brain.aim = TARGET[d] + rng.range(-1, 1) * SPREAD[d]
    brain.on = KP * (brain.aim - w) - KD * b.om > 0
  }
  brain.timer--
  if (w >= FLIP - 0.2) return false
  if (b.started && w < 0.16) return true
  return brain.on
}
