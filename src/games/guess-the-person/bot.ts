import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { candidates, open, QUESTIONS, type Round } from './rules.ts'

export type Move = { kind: 'ask'; q: number } | { kind: 'guess'; i: number }

/** Seconds the computer takes before its move, by difficulty. */
export const THINK: Record<Difficulty, [number, number]> = {
  easy: [0.9, 1.3],
  normal: [0.7, 1.0],
  hard: [0.5, 0.8],
}

/** How many of `cands` answer yes to question `q`. */
function yesCount(r: Round, cands: readonly number[], q: number): number {
  const test = QUESTIONS[q]?.test ?? (() => false)
  let n = 0
  for (const i of cands) {
    const face = r.faces[i]
    if (face !== undefined && test(face)) n++
  }
  return n
}

/** Faces split by question `q`: the yes group and the no group. */
function splitBy(r: Round, cands: readonly number[], q: number): [number[], number[]] {
  const test = QUESTIONS[q]?.test ?? (() => false)
  const yes: number[] = []
  const no: number[] = []
  for (const i of cands) {
    const face = r.faces[i]
    if (face !== undefined && test(face)) yes.push(i)
    else no.push(i)
  }
  return [yes, no]
}

/**
 * Expected number of faces still standing after asking `q` and then the best
 * follow-up question (two questions deep): lower is better. Each answer is
 * weighted by how likely it is, every face being equally likely the secret.
 */
function expectedLeft(
  r: Round,
  cands: readonly number[],
  q: number,
  rest: readonly number[],
): number {
  const n = cands.length
  let e = 0
  for (const group of splitBy(r, cands, q)) {
    if (group.length <= 1) {
      e += (group.length / n) * group.length
      continue
    }
    let best = group.length * group.length
    for (const q2 of rest) {
      if (q2 === q) continue
      const y = yesCount(r, group, q2)
      best = Math.min(best, y * y + (group.length - y) * (group.length - y))
    }
    // Expected size after the second question within this group, weighted by the group's odds.
    e += (group.length / n) * (best / group.length)
  }
  return e
}

/**
 * The computer's move. It names the face once one candidate is left (or it has
 * no question left). It also names one at once, as its best chance, when the
 * rival is down to a single face (the rival would win on its next turn); hard
 * and normal see that, easy does not. Otherwise it asks: hard picks the
 * question that leaves the fewest faces two questions deep, normal one of the
 * most even splits, easy any random question.
 */
export function choose(r: Round, side: Side, difficulty: Difficulty, rng: Rng): Move {
  const cands = candidates(r, side)
  if (cands.length <= 1) return { kind: 'guess', i: cands[0] ?? 0 }
  const qs = open(r, side)
  if (qs.length === 0) return { kind: 'guess', i: rng.pick(cands) }
  const rival: Side = side === 0 ? 1 : 0
  // The rival can see its single remaining face: asking would only lose. A guess at least might win.
  if (difficulty !== 'easy' && candidates(r, rival).length <= 1)
    return { kind: 'guess', i: rng.pick(cands) }
  if (difficulty === 'easy') return { kind: 'ask', q: rng.pick(qs) }

  const split = qs.map((q) => {
    const yes = yesCount(r, cands, q)
    return { q, yes, no: cands.length - yes }
  })
  const imbalance = (s: { yes: number; no: number }) => Math.abs(s.yes - s.no)
  if (difficulty === 'normal') {
    // One of the more even splits, not always the best.
    const useful = split
      .filter((s) => s.yes > 0 && s.no > 0)
      .sort((a, b) => imbalance(a) - imbalance(b))
    const pool = useful.slice(0, Math.max(1, Math.ceil(useful.length / 2)))
    return { kind: 'ask', q: rng.pick((pool.length ? pool : split).map((s) => s.q)) }
  }
  let best = Infinity
  let ties: number[] = []
  for (const s of split) {
    const v = expectedLeft(r, cands, s.q, qs)
    if (v < best - 1e-9) {
      best = v
      ties = [s.q]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(s.q)
  }
  return { kind: 'ask', q: rng.pick(ties) }
}
