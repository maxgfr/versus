import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter } from '../../engines/aim/index.ts'
import {
  BAR,
  CEIL,
  forwardY,
  GOAL_X,
  goalY,
  type Outcome,
  runKick,
  spotOf,
  type State,
  type Swing,
} from './rules.ts'

/** How far the computer's swipe strays, and how much of the wind it reads. */
const ERR: Record<Difficulty, { angle: number; power: number; wind: number }> = {
  easy: { angle: 0.065, power: 0.065, wind: 0.3 },
  normal: { angle: 0.045, power: 0.05, wind: 0.85 },
  hard: { angle: 0.03, power: 0.034, wind: 1 },
}
/** Lofts the computer considers: easy just kicks, the others pick a floater or a driven kick. */
const LOFTS: Record<Difficulty, number[]> = { easy: [1], normal: [0.9, 1.2], hard: [0.85, 1, 1.25] }

/** Good kicks score by how central they are in the window; a miss ranks below every good kick. */
function score(outcome: Outcome, x: number, z: number): number {
  if (outcome === 'good') return Math.abs(x - GOAL_X) * 0.5 + Math.abs(z - (BAR + CEIL) / 2) * 0.3
  return 1000 + Math.abs(x - GOAL_X)
}

/** Search angle × power for the swipe (at a loft) that scores best, refined around the best found. */
export function search(s: State, side: Side, wind: number, loft = 1): Swing {
  const spot = spotOf(s, side)
  const fwd = forwardY(side)
  const gy = goalY(side)
  const toGoal = Math.atan2(GOAL_X - spot.x, Math.abs(gy - spot.y))
  let best: Swing = { dx: Math.sin(toGoal), dy: fwd * Math.cos(toGoal), power: 0.7, loft }
  let bestScore = Infinity
  const tryShot = (a: number, p: number) => {
    if (p < 0.2 || p > 1) return
    const shot = { dx: Math.sin(a), dy: fwd * Math.cos(a), power: p, loft }
    const sc = scoreOf(s, side, shot, wind)
    if (sc < bestScore) {
      bestScore = sc
      best = shot
    }
  }
  for (let ia = -15; ia <= 15; ia++)
    for (let p = 0.3; p <= 1.0001; p += 0.035) tryShot(toGoal + ia * 0.03, p)
  const a0 = Math.atan2(best.dx, best.dy * fwd)
  const p0 = best.power
  for (let ia = -4; ia <= 4; ia++)
    for (let ip = -4; ip <= 4; ip++) tryShot(a0 + ia * 0.005, p0 + ip * 0.008)
  return best
}

function scoreOf(s: State, side: Side, shot: Swing, wind: number): number {
  const r = runKick(s, side, shot, wind)
  return score(r.outcome, r.x, r.z)
}

/** Share of a 3 × 3 grid of the bot's own errors around `shot` that is still good. */
function holds(s: State, side: Side, shot: Swing, wind: number, d: Difficulty): number {
  const err = ERR[d]
  const fwd = forwardY(side)
  const a0 = Math.atan2(shot.dx, shot.dy * fwd)
  let n = 0
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const a = a0 + i * err.angle
      const k: Swing = {
        dx: Math.sin(a),
        dy: fwd * Math.cos(a),
        power: Math.min(1, shot.power + j * err.power),
        loft: shot.loft,
      }
      if (runKick(s, side, k, wind).outcome === 'good') n++
    }
  return n / 9
}

/**
 * The computer's swipe: for each loft it may use, find the most central good
 * kick (reading the wind as well as it can), keep the one that best survives
 * its own error (a driven kick in a gale, a floater close in), then miss a little.
 */
export function choose(s: State, side: Side, d: Difficulty, rng: Rng): Swing {
  const err = ERR[d]
  const wind = s.wind * err.wind
  const lofts = LOFTS[d]
  let best = search(s, side, wind, lofts[0])
  if (lofts.length > 1) {
    let bestV = -1
    for (const loft of lofts) {
      const shot = search(s, side, wind, loft)
      const v = holds(s, side, shot, wind, d)
      if (v > bestV) {
        bestV = v
        best = shot
      }
    }
  }
  return { ...jitter(best, rng, err.angle, err.power), loft: best.loft ?? 1 }
}
