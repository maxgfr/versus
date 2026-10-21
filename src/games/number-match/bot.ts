import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { pairs, touching } from './rules.ts'

/** Seconds between the computer's moves. */
export const PACE: Record<Difficulty, number> = { easy: 3.2, normal: 2.0, hard: 1.1 }

export type Move = { kind: 'pair'; i: number; j: number } | { kind: 'add' }

/**
 * The computer's next move: the best pair on the board (close together and
 * high up, so rows clear early), or an Add when no pair is left and Adds
 * remain. Easier levels sometimes pick a pair at random. Null when stuck.
 */
export function nextMove(
  vals: readonly number[],
  adds: number,
  d: Difficulty,
  rng: Rng,
): Move | null {
  const ps = pairs(vals)
  if (ps.length === 0) return adds > 0 ? { kind: 'add' } : null
  const noise = d === 'easy' ? 30 : d === 'normal' ? 8 : 0
  let best = ps[0] ?? [0, 0]
  let bestScore = -Infinity
  for (const [i, j] of ps) {
    const score = (touching(i, j) ? 40 : 0) - (j - i) * 0.5 - i * 0.02 + rng.range(0, noise)
    if (score > bestScore) {
      bestScore = score
      best = [i, j]
    }
  }
  return { kind: 'pair', i: best[0], j: best[1] }
}
