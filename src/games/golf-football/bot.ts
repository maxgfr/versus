import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams } from '../../engines/aim/index.ts'
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
} from './rules.ts'

/** How far the computer's swipe strays, and how much of the wind it reads. */
const ERR: Record<Difficulty, { angle: number; power: number; wind: number }> = {
  easy: { angle: 0.07, power: 0.07, wind: 0 },
  normal: { angle: 0.04, power: 0.05, wind: 0.6 },
  hard: { angle: 0.022, power: 0.028, wind: 1 },
}

/** Good kicks score by how central they are in the window; a miss ranks below every good kick. */
function score(outcome: Outcome, x: number, z: number): number {
  if (outcome === 'good') return Math.abs(x - GOAL_X) * 0.5 + Math.abs(z - (BAR + CEIL) / 2) * 0.3
  return 1000 + Math.abs(x - GOAL_X)
}

/** Search angle × power for the swipe that scores best, refined around the best found. */
export function search(s: State, side: Side, wind: number): ShotParams {
  const spot = spotOf(s, side)
  const fwd = forwardY(side)
  const gy = goalY(side)
  const toGoal = Math.atan2(GOAL_X - spot.x, Math.abs(gy - spot.y))
  let best: ShotParams = { dx: Math.sin(toGoal), dy: fwd * Math.cos(toGoal), power: 0.7 }
  let bestScore = Infinity
  const tryShot = (a: number, p: number) => {
    if (p < 0.2 || p > 1) return
    const shot = { dx: Math.sin(a), dy: fwd * Math.cos(a), power: p }
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

function scoreOf(s: State, side: Side, shot: ShotParams, wind: number): number {
  const r = runKick(s, side, shot, wind)
  return score(r.outcome, r.x, r.z)
}

/** The computer's swipe: aim at the posts, read the wind, then miss a little. */
export function choose(s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const err = ERR[d]
  const best = search(s, side, s.wind * err.wind)
  return jitter(best, rng, err.angle, err.power)
}
