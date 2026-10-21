import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams, simulate, solveShot } from '../../engines/aim/index.ts'
import { HOLE, THROW, TOSS, type State } from './rules.ts'

/** How far the bot's throw wanders: angle (rad) and power (0..1). */
const ERR: Record<Difficulty, { angle: number; power: number }> = {
  easy: { angle: 0.2, power: 0.17 },
  normal: { angle: 0.1, power: 0.085 },
  hard: { angle: 0.034, power: 0.034 },
}

/**
 * Throw for the hole: solve direction and power so the bag lands on the hole's
 * centre (it drops in when it lands soft), then miss a little by difficulty.
 */
export function choose(_s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const from = THROW[side] as { x: number; y: number }
  const best = solveShot((shot) => simulate(from.x, from.y, shot, TOSS, 0, []), from, HOLE)
  const err = ERR[d]
  return jitter(best, rng, err.angle, err.power)
}
