import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { idealAngle } from './rules.ts'

/**
 * The computer's throw. The handle comes round to the ideal angle once per turn;
 * the bot lets go on the k-th time it passes its planned angle, which sets how
 * fast the hammer is going, with some error in the angle. Harder levels aim
 * truer, pick the faster passes and work the spin harder (as a human swirls).
 */

const LEVEL: Record<Difficulty, { angle: number; passes: number[]; pump: number }> = {
  easy: { angle: 0.6, passes: [1, 1, 2, 3], pump: 0.15 },
  normal: { angle: 0.2, passes: [2, 3, 3], pump: 0.55 },
  hard: { angle: 0.06, passes: [3, 3, 4], pump: 0.9 },
}

export interface Plan {
  /** Passes of the planned angle to wait for before letting go. */
  passes: number
  /** Passes seen so far. */
  seen: number
  /** Handle angle to let go at. */
  theta: number
  /** How hard it works the spin (0..1), like a human swirling the finger. */
  pump: number
}

export function plan(side: Side, d: Difficulty, rng: Rng): Plan {
  const lv = LEVEL[d]
  return {
    passes: rng.pick(lv.passes),
    seen: 0,
    theta: idealAngle(side) + rng.range(-lv.angle, lv.angle),
    pump: lv.pump,
  }
}
