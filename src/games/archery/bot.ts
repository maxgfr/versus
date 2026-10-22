import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { BOW, DRIFT, MIN_POWER, RANGE_MAX, swayAt, TARGET } from './rules.ts'

/** How far the computer's arrow lands from its aim (world units, a gaussian), and how much wind it reads. */
const SPREAD: Record<Difficulty, number> = { easy: 115, normal: 62, hard: 34 }
const WIND_READ: Record<Difficulty, number> = { easy: 0.3, normal: 0.7, hard: 1 }
/** How much of the aim's sway the computer holds against at the moment it lets go. */
const STEADY: Record<Difficulty, number> = { easy: 0, normal: 0.5, hard: 0.9 }

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

/**
 * Hold against the sway at the moment of release, as a steady archer does: the
 * arrow leaves along aim + sway, so aim that much the other way. Same draw.
 */
export function steady(shot: ShotParams, side: Side, t: number, d: Difficulty): ShotParams {
  const a = Math.atan2(shot.dy, shot.dx) - swayAt(t, side, shot.power) * STEADY[d]
  return { dx: Math.cos(a), dy: Math.sin(a), power: shot.power }
}
