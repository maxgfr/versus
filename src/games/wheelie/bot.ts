import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Bike, FLIP, stepBike, type Terrain, wheelieAngle } from './rules.ts'

/**
 * The computer rides like a player feathering the throttle: every few frames
 * (its reaction time) it decides on or off for the next beat. The better
 * levels play both choices forward with the real rules over the coming hills
 * (then riding by feel) and keep the one that goes furthest without flipping
 * or dropping the front. Easy rides by feel alone, with a shakier aim.
 */

interface Skill {
  /** Wheelie angle aimed for (rad): higher is faster in the air, but closer to the flip. */
  aim: number
  /** Random error on the aim, redrawn at every decision (rad). */
  spread: number
  /** Frames between decisions. */
  react: number
  /** Steps played forward per choice (0: ride by feel only). */
  look: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { aim: 0.42, spread: 0.2, react: 14, look: 0 },
  normal: { aim: 0.5, spread: 0.12, react: 9, look: 20 },
  hard: { aim: 0.6, spread: 0.02, react: 6, look: 90 },
}

const DT = 1 / 60
const KP = 9
const KD = 0.9

export interface Brain {
  timer: number
  on: boolean
  aim: number
}

export function newBrain(): Brain {
  return { timer: 0, on: false, aim: SKILL.normal.aim }
}

/** Riding by feel: PD on the wheelie angle, with the safety reflexes. */
function feel(b: Bike, w: number, aim: number): boolean {
  if (w >= FLIP - 0.2) return false
  if (b.started && w < 0.16) return true
  return KP * (aim - w) - KD * b.om > 0
}

/** Ride `steps` forward: `first` for `hold` steps, then by feel. Distance gained, or -1 on a crash. */
export function rollout(
  b: Bike,
  t: Terrain,
  first: boolean,
  hold: number,
  steps: number,
  aim: number,
): number {
  const c: Bike = { ...b }
  const w0 = c.wheelie
  for (let i = 0; i < steps; i++) {
    const thr = i < hold ? first : feel(c, wheelieAngle(t, c), aim)
    const e = stepBike(c, t, DT, thr)
    if (e === 'flip' || e === 'dropped') return -1
    if (c.end) break
  }
  return c.wheelie - w0
}

export function drive(b: Bike, t: Terrain, d: Difficulty, rng: Rng, brain: Brain): boolean {
  const s = SKILL[d]
  const w = wheelieAngle(t, b)
  if (brain.timer <= 0) {
    brain.timer = s.react
    brain.aim = s.aim + rng.range(-1, 1) * s.spread
    brain.on = feel(b, w, brain.aim)
    if (s.look > 0) {
      const on = rollout(b, t, true, s.react, s.look, brain.aim)
      const off = rollout(b, t, false, s.react, s.look, brain.aim)
      // Ties keep the hunch; a crash on one side settles it.
      if (on !== off) brain.on = on > off
    }
  }
  brain.timer--
  // Reflexes: nobody holds on into a flip, or lets the front slam down.
  if (w >= FLIP - 0.12) return false
  if (b.started && w < 0.1) return true
  return brain.on
}
