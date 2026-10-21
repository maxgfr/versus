import type { Difficulty, Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { DRAG, simulate, type Table, VMAX } from './rules.ts'

/** A shot as the bot plays it: a unit direction and a power 0..1. */
export interface Shot {
  dx: number
  dy: number
  power: number
}

/** How far a bot's aim (radians) and power (fraction) wander from the best shot it found. */
const ERR: Record<Difficulty, { ang: number; pow: number }> = {
  easy: { ang: 0.1, pow: 0.14 },
  normal: { ang: 0.04, pow: 0.06 },
  hard: { ang: 0.01, pow: 0.015 },
}

const COARSE_ANGLES = 48
const FIXED_POWERS = [0.35, 0.55, 0.75, 0.95]

interface Candidate {
  ang: number
  pow: number
  score: number
}

function score(t: Table, side: Side, ang: number, pow: number): number {
  const r = simulate(t, side, Math.cos(ang), Math.sin(ang), pow)
  if (r.holed) return 1000 - pow * 40
  // Otherwise: finish as near the cup as possible, and pass close on the way.
  return -r.dist - r.closest * 0.35 - (pow > 0.97 ? 30 : 0)
}

/**
 * Search direction × power by simulating each candidate shot with the real
 * physics: a coarse sweep of all directions, then a fine pass around the best.
 * The search is exact, so a hard bot plays the shot it found; easier bots miss
 * by a wider margin.
 */
export function search(t: Table, side: Side, d: Difficulty, rng: Rng): Shot {
  const ball = t.balls[side]
  const cup = t.geo.cup
  const dist = Math.hypot(cup.x - ball.x, cup.y - ball.y)
  // Power that rolls the ball straight to the cup (distance = speed / drag).
  const p0 = Math.min(1, Math.max(0.1, (dist * DRAG) / VMAX))
  const powers = [p0 * 0.8, p0 * 0.95, p0 * 1.1, ...FIXED_POWERS].map((p) =>
    Math.min(1, Math.max(0.06, p)),
  )
  let best: Candidate = { ang: 0, pow: p0, score: -Infinity }
  for (let i = 0; i < COARSE_ANGLES; i++) {
    const ang = (i / COARSE_ANGLES) * Math.PI * 2
    for (const pow of powers) {
      const s = score(t, side, ang, pow)
      if (s > best.score) best = { ang, pow, score: s }
    }
  }
  // Fine pass: the sweet spot of a dropped putt is narrow.
  const centre = best
  for (let k = -8; k <= 8; k++) {
    const ang = centre.ang + k * 0.0125
    for (let j = -2; j <= 2; j++) {
      const pow = Math.min(1, Math.max(0.06, centre.pow * (1 + j * 0.012)))
      const s = score(t, side, ang, pow)
      if (s > best.score) best = { ang, pow, score: s }
    }
  }
  const err = ERR[d]
  const ang = best.ang + (rng.next() - 0.5) * 2 * err.ang
  const pow = best.pow * (1 + (rng.next() - 0.5) * 2 * err.pow)
  return {
    dx: Math.cos(ang),
    dy: Math.sin(ang),
    power: Math.min(1, Math.max(0.05, pow)),
  }
}

/** Entry point for the bot (also used by the worker through ai.ts). */
export function choose(input: { table: Table; side: Side }, d: Difficulty, seed: number): Shot {
  return search(input.table, input.side, d, new Rng(seed))
}
