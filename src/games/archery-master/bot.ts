import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams } from '../../engines/aim/index.ts'
import { APPLE, DUMMY, flight, type Shot, type State } from './rules.ts'

/**
 * Angle (rad) and power error, how much of the wind the bot reads, and how
 * much it weighs the risk of hitting the dummy under the apple (0 = aims dead
 * at the apple and hopes).
 */
const ERR: Record<Difficulty, { angle: number; power: number; wind: number; care: number }> = {
  easy: { angle: 0.1, power: 0.07, wind: 0.3, care: 0 },
  normal: { angle: 0.065, power: 0.045, wind: 0.85, care: 0.8 },
  hard: { angle: 0.048, power: 0.034, wind: 1, care: 1 },
}

/** The shot whose arrow crosses the dummy's plane closest to the apple centre, for a given wind. */
function centreShot(s: State, side: Side, wind: number): Shot {
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
  return best
}

/**
 * What a shot is worth to `side` given its own hand shake: the share of a
 * 5 × 5 grid of its errors that takes the apple, minus the share that hits the
 * dummy weighted by what a lost life costs right now.
 */
function worth(
  s: State,
  side: Side,
  shot: Shot,
  wind: number,
  risk: number,
  d: Difficulty,
): number {
  const err = ERR[d]
  const a0 = Math.atan2(shot.dy, shot.dx)
  let v = 0
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const a = a0 + (i / 2) * err.angle * 0.8
      const p = shot.power + (j / 2) * err.power * 0.8
      const o = flight(side, { dx: Math.cos(a), dy: Math.sin(a), power: p }, s.gap, wind).outcome
      if (o === 'apple') v += 1
      else if (o === 'dummy') v -= risk
    }
  return v / 25
}

/**
 * Find the shot that puts the arrow on the apple (reading the wind as well as
 * the bot can), then, with care, lift it a little: an arrow over the apple
 * costs nothing, one under it hits the dummy. The cost of a dummy hit grows on
 * the last life and shrinks when the rival is about to win anyway. Then the
 * hand shakes by difficulty.
 */
export function choose(s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const err = ERR[d]
  const wind = s.wind * err.wind
  let best = centreShot(s, side, wind)
  if (err.care > 0) {
    const rival = other(side)
    const desperate = s.apples[rival] >= s.target - 1 && s.apples[side] < s.apples[rival] + 1
    const risk = err.care * (s.lives[side] <= 1 ? 3 : desperate ? 0.3 : 1)
    let bestV = -Infinity
    const a0 = Math.atan2(best.dy, best.dx)
    const p0 = best.power
    for (let k = 0; k <= 6; k++) {
      // More power lifts the crossing point higher above the apple's centre.
      const sh = { dx: Math.cos(a0), dy: Math.sin(a0), power: Math.min(1, p0 + k * 0.006) }
      const v = worth(s, side, sh, wind, risk, d)
      if (v > bestV + 1e-9) {
        bestV = v
        best = sh
      }
    }
  }
  return jitter(best, rng, err.angle, err.power)
}
