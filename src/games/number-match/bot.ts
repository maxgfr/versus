import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { canAdd, COLS, cross, pairs, touching } from './rules.ts'

/** Seconds between the computer's moves. */
export const PACE: Record<Difficulty, number> = { easy: 3.2, normal: 2.0, hard: 1.1 }

export type Move = { kind: 'pair'; i: number; j: number } | { kind: 'add' }

/** How many of the best-looking pairs the hard bot plays out one move ahead. */
const LOOK = 12

/**
 * The computer's next move. Every level scores the pairs on the board: close
 * together and high up (so rows clear early), and a row that collapses counts
 * big from normal up. Hard also plays its best candidates one move ahead and
 * keeps the board that leaves the most pairs to cross out, so it rarely needs
 * an Add. Easy adds a lot of noise, normal a little. With no pair it Adds when
 * that would put numbers on the board; null when out of moves.
 */
export function nextMove(
  vals: readonly number[],
  adds: number,
  d: Difficulty,
  rng: Rng,
): Move | null {
  const ps = pairs(vals)
  if (ps.length === 0) return canAdd(vals, adds) ? { kind: 'add' } : null
  const noise = d === 'easy' ? 30 : d === 'normal' ? 8 : 0
  const scored = ps.map(([i, j]) => {
    let score = (touching(i, j) ? 40 : 0) - (j - i) * 0.5 - i * 0.02
    if (d !== 'easy') score += 120 * cross(vals, i, j).rows
    return { i, j, score: score + rng.range(0, noise) }
  })
  scored.sort((a, b) => b.score - a.score)
  let best = scored[0] ?? { i: 0, j: 0, score: 0 }
  if (d === 'hard') {
    let bestAhead = -Infinity
    for (const m of scored.slice(0, LOOK)) {
      const r = cross(vals, m.i, m.j)
      // Rows cleared, then the options the board keeps, then the base score.
      const ahead = r.rows * 400 + pairs(r.vals).length * 12 + m.score - (r.vals.length / COLS) * 4
      if (ahead > bestAhead) {
        bestAhead = ahead
        best = m
      }
    }
  }
  return { kind: 'pair', i: best.i, j: best.j }
}
