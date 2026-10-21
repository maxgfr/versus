import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams } from '../../engines/aim/index.ts'
import { type Hit, type Hole, type Pt, runShot, type State } from './rules.ts'

/** How far the computer's swing strays, and how much of the wind it reads. */
const ERR: Record<Difficulty, { angle: number; power: number; wind: number }> = {
  easy: { angle: 0.09, power: 0.14, wind: 0 },
  normal: { angle: 0.05, power: 0.08, wind: 0.6 },
  hard: { angle: 0.022, power: 0.04, wind: 1 },
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** Lower is better: holed, then the water, then the rest by distance to the cup. */
function score(h: Hole, hit: Hit): number {
  if (hit.kind === 'sunk') return 0
  if (hit.kind === 'water') return 400 + dist(hit, h.cup)
  return dist(hit, h.cup) + (hit.surface === 'sand' ? 30 : 0)
}

/** Search angle × power by simulating each stroke to rest, then refine around the best. */
function search(h: Hole, from: Pt, wind: number): ShotParams {
  const base = Math.atan2(h.cup.y - from.y, h.cup.x - from.x)
  let best: ShotParams = { dx: Math.cos(base), dy: Math.sin(base), power: 0.7 }
  let bestScore = Infinity
  const tryShot = (a: number, p: number) => {
    if (p < 0.12 || p > 1) return
    const shot = { dx: Math.cos(a), dy: Math.sin(a), power: p }
    const sc = score(h, runShot(h, from, shot, wind))
    if (sc < bestScore) {
      bestScore = sc
      best = shot
    }
  }
  for (let ia = -12; ia <= 12; ia++)
    for (let p = 0.15; p <= 1.0001; p += 0.05) tryShot(base + ia * 0.035, p)
  const a0 = Math.atan2(best.dy, best.dx)
  const p0 = best.power
  for (let ia = -4; ia <= 4; ia++)
    for (let ip = -4; ip <= 4; ip++) tryShot(a0 + ia * 0.008, p0 + ip * 0.01)
  return best
}

/** The computer's stroke from where the ball rests: aim at the cup, read the wind, then miss a little. */
export function choose(s: State, d: Difficulty, rng: Rng): ShotParams {
  const h = s.holes[s.hole] as Hole
  const err = ERR[d]
  const best = search(h, s.rest[s.turn], s.wind * err.wind)
  return jitter(best, rng, err.angle, err.power)
}
