import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams, simulate, solveShot } from '../../engines/aim/index.ts'
import { BALL, cannonOf, coreOf, type State } from './rules.ts'

const ERR: Record<Difficulty, { angle: number; power: number; wind: number }> = {
  easy: { angle: 0.08, power: 0.07, wind: 0 },
  normal: { angle: 0.045, power: 0.035, wind: 0.6 },
  hard: { angle: 0.008, power: 0.008, wind: 1 },
}

/** Aim at the rival core by simulation (wind as well as the bot can read it), then miss a little. */
export function choose(s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const from = cannonOf(side)
  const target = coreOf(other(side))
  const err = ERR[d]
  const wind = s.wind * err.wind
  const best = solveShot(
    (shot) => simulate(from.x, from.y, shot, BALL, wind, s.blocks),
    from,
    target,
    (im) => {
      if (im.out) return 1e9
      // Own blocks are a disaster; the rival core is the prize.
      const b = im.block >= 0 ? s.blocks[im.block] : undefined
      if (b && b.side === side) return 1e8
      if (b && b.kind === 'core') return 0
      return Math.hypot(im.x - target.x, im.y - target.y)
    },
  )
  return jitter(best, rng, err.angle, err.power)
}
