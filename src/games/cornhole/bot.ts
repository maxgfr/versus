import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams, simulate, solveShot } from '../../engines/aim/index.ts'
import { advance, bagPoints, HOLE, type State, THROW, TOSS, toss } from './rules.ts'

/** How far the bot's throw wanders: angle (rad) and power (0..1). */
const ERR: Record<Difficulty, { angle: number; power: number }> = {
  easy: { angle: 0.12, power: 0.1 },
  normal: { angle: 0.055, power: 0.05 },
  hard: { angle: 0.032, power: 0.03 },
}

/**
 * Play one throw on a copy of the round with the real rules (flight, landing,
 * slide, bumps, the hole) and score where everything ends up: my points minus
 * the rival's, then how close my bag sits to the hole as a tie-break.
 */
export function rate(s: State, side: Side, shot: ShotParams): number {
  const c = JSON.parse(JSON.stringify(s)) as State
  c.turn = side
  c.phase = 'aim'
  if (!toss(c, shot)) return -1e9
  const mine = c.bags[c.bags.length - 1]
  for (let i = 0; i < 900 && (c.phase as State['phase']) === 'fly'; i++) advance(c, 1 / 60)
  const pts: [number, number] = [0, 0]
  for (const b of c.bags) pts[b.side] += bagPoints(b)
  const near =
    mine && (mine.st === 'rest' || mine.st === 'hole')
      ? Math.hypot(mine.x - HOLE.x, mine.y - HOLE.y)
      : 900
  return (pts[side] - pts[other(side)]) * 1000 - near
}

/**
 * Easy throws for the hole's centre as a landing spot and hopes. Normal and
 * hard read the board: they try a fan of throws through the real rules (a bag
 * slides on after it lands, can knock the rival's bags off or nudge its own
 * in) and keep the best, preferring throws that stay good when the hand
 * wobbles. Then the hand wobbles by difficulty.
 */
export function choose(s: State, side: Side, d: Difficulty, rng: Rng): ShotParams {
  const err = ERR[d]
  const from = THROW[side] as { x: number; y: number }
  const landing = solveShot((shot) => simulate(from.x, from.y, shot, TOSS, 0, []), from, HOLE)
  if (d === 'easy') return jitter(landing, rng, err.angle, err.power)
  const base = Math.atan2(landing.dy, landing.dx)
  const scored: { shot: ShotParams; v: number }[] = []
  for (let ia = -8; ia <= 8; ia++)
    for (let p = landing.power - 0.3; p <= landing.power + 0.06; p += 0.02) {
      if (p < 0.15 || p > 1) continue
      const a = base + ia * 0.03
      const shot = { dx: Math.cos(a), dy: Math.sin(a), power: p }
      scored.push({ shot, v: rate(s, side, shot) })
    }
  scored.sort((x, y) => y.v - x.v)
  let best = scored[0]?.shot ?? landing
  {
    // Of the few best, keep the one whose neighbours (the bot's own hand error) still score.
    let bestV = -Infinity
    for (const c of scored.slice(0, 6)) {
      const a0 = Math.atan2(c.shot.dy, c.shot.dx)
      let v = c.v
      for (const [da, dp] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = a0 + da * err.angle * 0.7
        v += rate(s, side, {
          dx: Math.cos(a),
          dy: Math.sin(a),
          power: Math.min(1, c.shot.power + dp * err.power * 0.7),
        })
      }
      if (v > bestV) {
        bestV = v
        best = c.shot
      }
    }
  }
  return jitter(best, rng, err.angle, err.power)
}
