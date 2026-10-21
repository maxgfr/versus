import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  absOf,
  continuations,
  key,
  own,
  other,
  type Pos,
  pips,
  POINTS,
  type Seq,
  sequences,
  type Step,
} from './rules.ts'

/**
 * Expected loss, in pips, to blots of side `b` that side `a` can hit with one
 * roll. A blot on point q is hit by an attacker checker 1–6 points above it
 * (in the attacker's own numbering), and it costs the blot's owner the
 * pips it would have to run again from the bar.
 */
function threat(p: Pos, a: Side, b: Side): number {
  let loss = 0
  for (let q = 1; q <= POINTS; q++) {
    if (own(p, b, q) !== 1) continue
    const qa = absOf(a, absOf(b, q))
    let n = 0
    for (let r = qa + 1; r <= Math.min(POINTS, qa + 6); r++) n += own(p, a, r)
    if (n > 0) loss += (1 - (5 / 6) ** n) * (25 - q + 4)
  }
  return loss
}

/** How good a position is for `s`: pip lead, blots on either side, and points made. */
export function evaluate(p: Pos, s: Side): number {
  const o = other(s)
  let score = pips(p, o) - pips(p, s)
  score += threat(p, s, o) - threat(p, o, s)
  for (let q = 1; q <= POINTS; q++) if (own(p, s, q) >= 2) score += 0.8
  return score
}

/** The 21 distinct rolls, with their probabilities. */
const ROLLS: { dice: number[]; w: number }[] = (() => {
  const out: { dice: number[]; w: number }[] = []
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      out.push(a === b ? { dice: [a, a, a, a], w: 1 / 36 } : { dice: [a, b], w: 2 / 36 })
    }
  }
  return out
})()

/**
 * One-ply expectimax: the value of ending our turn in `end` is the average,
 * over the opponent's 21 rolls, of the best reply the opponent can make
 * (the one that is worst for us).
 */
function expectimax(end: Pos, s: Side): number {
  const o = other(s)
  let v = 0
  for (const roll of ROLLS) {
    const replies = sequences(end, o, roll.dice)
    if (replies.length === 0) {
      v += roll.w * evaluate(end, s)
      continue
    }
    let worst = Infinity
    for (const r of replies) worst = Math.min(worst, evaluate(r.end, s))
    v += roll.w * worst
  }
  return v
}

/**
 * The next move for `s` with `dice` still to play this turn (`origin` is the
 * position the turn started from, `used` the moves already made). Easy plays
 * any legal move, normal takes the best finished position by pip race and
 * safety, hard looks one roll ahead at the opponent's replies.
 */
export function choose(
  origin: Pos,
  s: Side,
  dice: readonly number[],
  used: readonly Step[],
  difficulty: Difficulty,
  rng: Rng,
): Step | null {
  const cont = continuations(sequences(origin, s, dice), used)
  if (cont.length === 0) return null
  if (difficulty === 'easy') return rng.pick(cont).steps[used.length] ?? null
  return bestOf(
    cont,
    used.length,
    difficulty === 'hard' ? (e) => expectimax(e, s) : (e) => evaluate(e, s),
  )
}

/**
 * A whole turn at once: the full sequence of moves `s` would play with `dice`
 * from `origin` (empty when nothing can move). The screen plays it one checker
 * at a time; hard runs it in a worker (see ai.ts) so the frame never stalls.
 */
export function planTurn(
  origin: Pos,
  s: Side,
  dice: readonly number[],
  difficulty: Difficulty,
  rng: Rng,
): Step[] {
  const seqs = sequences(origin, s, dice)
  if (seqs.length === 0) return []
  if (difficulty === 'easy') return rng.pick(seqs).steps
  const value = difficulty === 'hard' ? (e: Pos) => expectimax(e, s) : (e: Pos) => evaluate(e, s)
  return bestSeq(seqs, value)?.steps ?? []
}

function bestOf(cont: readonly Seq[], at: number, value: (end: Pos) => number): Step | null {
  return bestSeq(cont, value)?.steps[at] ?? null
}

function bestSeq(cont: readonly Seq[], value: (end: Pos) => number): Seq | null {
  const memo = new Map<string, number>()
  let best: Seq | null = null
  let bestV = -Infinity
  for (const q of cont) {
    const k = key(q.end)
    let v = memo.get(k)
    if (v === undefined) memo.set(k, (v = value(q.end)))
    if (v > bestV + 1e-9) {
      bestV = v
      best = q
    }
  }
  return best
}
