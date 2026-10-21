import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { idealAngle } from './rules.ts'

/**
 * The computer's throw. The handle comes round to the ideal angle once per turn;
 * the bot lets go on the k-th time it passes its planned angle, which sets how
 * fast the hammer is going, with some error in the angle. Harder levels aim
 * truer and pick the faster passes.
 */

const LEVEL: Record<Difficulty, { angle: number; passes: number[] }> = {
  easy: { angle: 0.6, passes: [1, 1, 2, 3] },
  normal: { angle: 0.3, passes: [2, 3, 3] },
  hard: { angle: 0.1, passes: [3] },
}

export interface Plan {
  /** Passes of the planned angle to wait for before letting go. */
  passes: number
  /** Passes seen so far. */
  seen: number
  /** Handle angle to let go at. */
  theta: number
}

export function plan(side: Side, d: Difficulty, rng: Rng): Plan {
  const lv = LEVEL[d]
  return {
    passes: rng.pick(lv.passes),
    seen: 0,
    theta: idealAngle(side) + rng.range(-lv.angle, lv.angle),
  }
}
