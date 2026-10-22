import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { canAdd, COLS, cross, pairs, touching } from './rules.ts'

/** Seconds between the computer's moves: a quick human on hard, a child on easy. */
export const PACE: Record<Difficulty, number> = { easy: 3.6, normal: 1.6, hard: 0.95 }

export type Move = { kind: 'pair'; i: number; j: number } | { kind: 'add' }

/** Candidates played out ahead (first move) and replies tried after each (hard's second move). */
const LOOK = 10
const REPLY = 8

/** A pair at a glance: close together and high up, so rows clear early. */
function glance(i: number, j: number): number {
  return (touching(i, j) ? 40 : 0) - (j - i) * 0.5 - i * 0.02
}

/** How good a board is to keep playing: the pairs it offers, less its length. */
function outlook(vals: readonly number[]): number {
  return pairs(vals).length * 12 - (vals.length / COLS) * 4
}

/**
 * The computer's next move. Easy picks by eye with a lot of noise. Normal
 * values a pair that collapses a row and plays its best candidates one move
 * ahead, keeping the board with the most pairs. Hard looks two moves ahead
 * (its pair, then its best reply) with no noise, so it clears rows in pairs
 * and rarely needs an Add. With no pair it Adds when that would put numbers
 * on the board; null when out of moves.
 */
export function nextMove(
  vals: readonly number[],
  adds: number,
  d: Difficulty,
  rng: Rng,
): Move | null {
  const ps = pairs(vals)
  if (ps.length === 0) return canAdd(vals, adds) ? { kind: 'add' } : null
  const noise = d === 'easy' ? 40 : d === 'normal' ? 4 : 0
  const scored = ps.map(([i, j]) => {
    let score = glance(i, j)
    if (d !== 'easy') score += 120 * cross(vals, i, j).rows
    return { i, j, score: score + rng.range(0, noise) }
  })
  scored.sort((a, b) => b.score - a.score)
  let best = scored[0] ?? { i: 0, j: 0, score: 0 }
  if (d === 'easy') return { kind: 'pair', i: best.i, j: best.j }
  let bestAhead = -Infinity
  for (const m of scored.slice(0, LOOK)) {
    const r = cross(vals, m.i, m.j)
    let ahead = r.rows * 400 + m.score
    if (d === 'normal') ahead += outlook(r.vals)
    else {
      // Hard: the best reply to this pair counts too.
      const replies = pairs(r.vals)
        .map(([i, j]) => ({ i, j, score: glance(i, j) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, REPLY)
      let reply = outlook(r.vals) - 200
      for (const q of replies) {
        const r2 = cross(r.vals, q.i, q.j)
        reply = Math.max(reply, r2.rows * 400 + q.score * 0.5 + outlook(r2.vals))
      }
      ahead += reply
    }
    if (ahead > bestAhead) {
      bestAhead = ahead
      best = m
    }
  }
  return { kind: 'pair', i: best.i, j: best.j }
}
