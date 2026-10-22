import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams } from '../../engines/aim/index.ts'
import { type Hit, type Hole, type Pt, runShot, type State } from './rules.ts'

/** How far the computer's swing strays, and how much of the wind it reads. */
const ERR: Record<Difficulty, { angle: number; power: number; wind: number }> = {
  easy: { angle: 0.09, power: 0.13, wind: 0.3 },
  normal: { angle: 0.035, power: 0.055, wind: 0.85 },
  hard: { angle: 0.011, power: 0.016, wind: 1 },
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Lower is better: holed, then the water (a penalty stroke and the same shot
 * again), then where the ball rests by distance to the cup, with the lie
 * weighed in: the green putts, the rough and sand cost the next shot.
 */
function score(h: Hole, hit: Hit): number {
  if (hit.kind === 'sunk') return 0
  if (hit.kind === 'water') return 500 + dist(hit, h.cup)
  const lie =
    hit.surface === 'green' ? -25 : hit.surface === 'sand' ? 70 : hit.surface === 'rough' ? 35 : 0
  return dist(hit, h.cup) + lie
}

/** Search angle × power by simulating each stroke to rest; returns the candidates, best first. */
function search(h: Hole, from: Pt, wind: number): { shot: ShotParams; v: number }[] {
  const base = Math.atan2(h.cup.y - from.y, h.cup.x - from.x)
  const all: { shot: ShotParams; v: number }[] = []
  const tryShot = (a: number, p: number) => {
    if (p < 0.12 || p > 1) return
    const shot = { dx: Math.cos(a), dy: Math.sin(a), power: p }
    all.push({ shot, v: score(h, runShot(h, from, shot, wind)) })
  }
  for (let ia = -12; ia <= 12; ia++)
    for (let p = 0.15; p <= 1.0001; p += 0.05) tryShot(base + ia * 0.035, p)
  all.sort((x, y) => x.v - y.v)
  const top = all[0]
  if (top) {
    const a0 = Math.atan2(top.shot.dy, top.shot.dx)
    const p0 = top.shot.power
    for (let ia = -4; ia <= 4; ia++)
      for (let ip = -4; ip <= 4; ip++) tryShot(a0 + ia * 0.008, p0 + ip * 0.01)
  }
  return all.sort((x, y) => x.v - y.v)
}

/**
 * The computer's stroke from where the ball rests. It simulates every stroke
 * to rest (wind read as well as it can), then, past easy, weighs its few best
 * by how they fare when its own swing strays: a line that flirts with the pond
 * loses to a safer one. Then the swing strays a little.
 */
export function choose(s: State, d: Difficulty, rng: Rng): ShotParams {
  const h = s.holes[s.hole] as Hole
  const err = ERR[d]
  const from = s.rest[s.turn]
  const wind = s.wind * err.wind
  const ranked = search(h, from, wind)
  let best = ranked[0]?.shot ?? { dx: 0, dy: s.turn === 0 ? -1 : 1, power: 0.6 }
  if (d !== 'easy') {
    let bestV = Infinity
    for (const c of ranked.slice(0, 8)) {
      const a0 = Math.atan2(c.shot.dy, c.shot.dx)
      let v = 0
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const a = a0 + i * err.angle
          const p = Math.min(1, Math.max(0.12, c.shot.power + j * err.power))
          v += score(h, runShot(h, from, { dx: Math.cos(a), dy: Math.sin(a), power: p }, wind))
        }
      if (v < bestV) {
        bestV = v
        best = c.shot
      }
    }
  }
  return jitter(best, rng, err.angle, err.power)
}
