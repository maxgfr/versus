import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Body, clampX, type Geo, type Jar, landingY } from './rules.ts'

/** Seconds between the computer's drops. */
export const PACE: Record<Difficulty, number> = { easy: 2.4, normal: 1.5, hard: 0.9 }
/** How far (panel-local units) the computer's aim wanders. */
const NOISE: Record<Difficulty, number> = { easy: 90, normal: 40, hard: 12 }

/**
 * Where to drop a fruit of kind `k`: over the highest fruit of the same kind
 * (so the two fuse), otherwise over the lowest part of the stack. Aim noise
 * depends on the difficulty.
 */
export function chooseX(jar: Jar, geo: Geo, k: number, d: Difficulty, rng: Rng): number {
  let target: Body | null = null
  for (const b of jar.bodies) {
    if (b.k === k && (target === null || b.y < target.y)) target = b
  }
  let x = (geo.left + geo.right) / 2
  if (target && rng.chance(0.85)) {
    x = target.x
  } else {
    let lowest = -Infinity
    for (let i = 0; i <= 8; i++) {
      const cx = clampX(geo, k, geo.left + ((geo.right - geo.left) * i) / 8)
      const y = landingY(jar, geo, cx, k)
      if (y > lowest) {
        lowest = y
        x = cx
      }
    }
  }
  return clampX(geo, k, x + rng.range(-NOISE[d], NOISE[d]))
}
