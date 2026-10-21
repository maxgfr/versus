import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { candidates, open, QUESTIONS, type Round } from './rules.ts'

export type Move = { kind: 'ask'; q: number } | { kind: 'guess'; i: number }

/** Seconds the computer takes before its move, by difficulty. */
export const THINK: Record<Difficulty, [number, number]> = {
  easy: [1.2, 1.8],
  normal: [1.0, 1.5],
  hard: [0.7, 1.1],
}

/**
 * The computer's move. It names the face once one candidate is left (or it has
 * no question left). Otherwise it asks: hard picks the question that splits its
 * candidates most evenly, normal a random question that splits them at all,
 * easy any random question.
 */
export function choose(r: Round, side: Side, difficulty: Difficulty, rng: Rng): Move {
  const cands = candidates(r, side)
  if (cands.length <= 1) return { kind: 'guess', i: cands[0] ?? 0 }
  const qs = open(r, side)
  if (qs.length === 0) return { kind: 'guess', i: rng.pick(cands) }
  if (difficulty === 'easy') return { kind: 'ask', q: rng.pick(qs) }

  const split = qs.map((q) => {
    const test = QUESTIONS[q]?.test ?? (() => false)
    const yes = cands.filter((i) => {
      const face = r.faces[i]
      return face !== undefined && test(face)
    }).length
    return { q, yes, no: cands.length - yes }
  })
  if (difficulty === 'normal') {
    const useful = split.filter((s) => s.yes > 0 && s.no > 0)
    return { kind: 'ask', q: rng.pick((useful.length ? useful : split).map((s) => s.q)) }
  }
  const imbalance = (s: { yes: number; no: number }) => Math.abs(s.yes - s.no)
  const best = Math.min(...split.map(imbalance))
  return { kind: 'ask', q: rng.pick(split.filter((s) => imbalance(s) === best).map((s) => s.q)) }
}
