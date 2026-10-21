import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { BOW, DRIFT, MIN_POWER, RANGE_MAX, TARGET } from './rules.ts'

/** How far the computer's arrow lands from its aim (world units, a gaussian), and how much wind it reads. */
const SPREAD: Record<Difficulty, number> = { easy: 90, normal: 42, hard: 16 }
const WIND_READ: Record<Difficulty, number> = { easy: 0, normal: 0.6, hard: 1 }

/** Box-Muller: one standard normal draw. */
function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng.next())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next())
}

/** Aim at the centre, lean into the wind, then miss by a gaussian. The draw sets the range. */
export function choose(side: Side, wind: number, d: Difficulty, rng: Rng): ShotParams {
  const bow = BOW[side]
  const drift = wind * DRIFT * WIND_READ[d]
  const target = { x: TARGET.x + gauss(rng) * SPREAD[d], y: TARGET.y + gauss(rng) * SPREAD[d] }
  // The arrow drifts by `drift` on the way, so aim that much upwind of the target.
  const vx = target.x - drift - bow.x
  const vy = target.y - bow.y
  const len = Math.hypot(vx, vy)
  return {
    dx: vx / len,
    dy: vy / len,
    power: Math.min(1, Math.max(MIN_POWER, len / RANGE_MAX)),
  }
}
