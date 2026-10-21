import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams, simulate, solveShot } from '../../engines/aim/index.ts'
import { BALL, type State, originOf } from './rules.ts'

/**
 * The computer's flick: pick one of the rival's standing cups, solve the shot
 * that lands the ball on it, then shake the flick by difficulty.
 */

const ERR: Record<Difficulty, { angle: number; power: number }> = {
  easy: { angle: 0.06, power: 0.06 },
  normal: { angle: 0.03, power: 0.035 },
  hard: { angle: 0.012, power: 0.012 },
}

export function choose(s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const targets = s.cups.filter((c) => c.side === other(side) && c.alive)
  const cup = rng.pick(targets)
  const from = originOf(side)
  if (!cup) return { dx: 0, dy: side === 0 ? -1 : 1, power: 0.5 }
  const best = solveShot((shot) => simulate(from.x, from.y, shot, BALL, 0, []), from, cup)
  return jitter(best, rng, ERR[d].angle, ERR[d].power)
}
