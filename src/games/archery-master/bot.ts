import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams } from '../../engines/aim/index.ts'
import { APPLE, DUMMY, flight, type Shot, type State } from './rules.ts'

/** Angle (rad) and power error, and how much of the wind the bot reads correctly. */
const ERR: Record<Difficulty, { angle: number; power: number; wind: number }> = {
  easy: { angle: 0.1, power: 0.075, wind: 0 },
  normal: { angle: 0.075, power: 0.05, wind: 0.5 },
  hard: { angle: 0.065, power: 0.04, wind: 0.9 },
}

/**
 * Work out the shot whose arrow crosses the dummy's plane closest to the apple,
 * reading the wind as well as the bot can, then wander by difficulty.
 */
export function choose(s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const err = ERR[d]
  const wind = s.wind * err.wind
  const base = side === 0 ? -Math.PI / 2 : Math.PI / 2
  const score = (sh: Shot): number => {
    const f = flight(side, sh, s.gap, wind)
    return Math.hypot(f.x - DUMMY.x, f.z - APPLE.z)
  }
  let best: Shot = { dx: Math.cos(base), dy: Math.sin(base), power: 0.5 }
  let bestScore = Infinity
  const tryShot = (a: number, p: number) => {
    if (p <= 0.1 || p > 1) return
    const sh = { dx: Math.cos(a), dy: Math.sin(a), power: p }
    const sc = score(sh)
    if (sc < bestScore) {
      bestScore = sc
      best = sh
    }
  }
  for (let ia = -20; ia <= 20; ia++)
    for (let p = 0.25; p <= 1.0001; p += 0.01) tryShot(base + ia * 0.01, p)
  const a0 = Math.atan2(best.dy, best.dx)
  const p0 = best.power
  for (let ia = -10; ia <= 10; ia++)
    for (let ip = -10; ip <= 10; ip++) tryShot(a0 + ia * 0.002, p0 + ip * 0.002)
  return jitter(best, rng, err.angle, err.power)
}
