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

/** Have the two armies passed each other (a pure race, no more hitting)? */
export function racing(p: Pos): boolean {
  if (p.bar[0] > 0 || p.bar[1] > 0) return false
  // Red's rearmost checker (highest red point) against blue's rearmost (lowest red point).
  let redBack = 0
  let blueBack = POINTS + 1
  for (let a = 1; a <= POINTS; a++) {
    const v = p.pts[a - 1] ?? 0
    if (v > 0) redBack = Math.max(redBack, a)
    if (v < 0) blueBack = Math.min(blueBack, a)
  }
  return redBack < blueBack
}

/** Worth of a made point by where it stands (own numbering): the home board, the bar point, an anchor. */
const POINT_W = [
  0, 0.6, 0.9, 1.4, 1.9, 2.3, 2.2, 2.0, 1.2, 0.8, 0.6, 0.6, 0.6, 0.5, 0.5, 0.5, 0.5, 0.6, 0.8, 1.2,
  1.4, 1.2, 1.0, 0.8, 0.6,
]

/** One side's structure: made points by worth, primes, stacked or stripped checkers. */
function structure(p: Pos, s: Side): number {
  let v = 0
  let run = 0
  for (let q = 1; q <= POINTS; q++) {
    const n = own(p, s, q)
    if (n >= 2) {
      v += POINT_W[q] ?? 0.5
      // Checkers piled high on one point do little.
      if (n > 3) v -= (n - 3) * 0.25
      run++
      // A prime: each extra point in a row walls the rival in a little more.
      if (run >= 2) v += 0.35 * run
    } else run = 0
  }
  return v
}

/**
 * How good a position is for `s`, in pips. In a race, the pip lead (and the
 * checkers already off). In contact, the pip lead, the blots each side leaves
 * in reach of the other, each side's structure, and checkers on the bar facing
 * a closed board.
 */
export function evaluate(p: Pos, s: Side): number {
  const o = other(s)
  let score = pips(p, o) - pips(p, s)
  if (racing(p)) return score + (p.off[s] - p.off[o]) * 1.5
  score += threat(p, s, o) - threat(p, o, s)
  score += (structure(p, s) - structure(p, o)) * 2.2
  // A checker on the bar against a strong home board is in real trouble.
  let mine = 0
  let theirs = 0
  for (let q = 1; q <= 6; q++) {
    if (own(p, s, q) >= 2) mine++
    if (own(p, o, q) >= 2) theirs++
  }
  score += p.bar[o] * mine * 2.5 - p.bar[s] * theirs * 2.5
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
 * a rough, noisy eye for the board; normal takes the best finished position
 * by race, safety and structure (made points, primes, anchors); hard also
 * looks one roll ahead at every reply the opponent could make.
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
  if (difficulty === 'easy') return bestOf(cont, used.length, easyValue(s, rng))
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
  if (difficulty === 'easy') return bestSeq(seqs, easyValue(s, rng))?.steps ?? []
  const value = difficulty === 'hard' ? (e: Pos) => expectimax(e, s) : (e: Pos) => evaluate(e, s)
  return bestSeq(seqs, value)?.steps ?? []
}

/** Easy: half the time any legal play, otherwise a rough, noisy eye for the board. */
function easyValue(s: Side, rng: Rng): (end: Pos) => number {
  if (rng.chance(0.5)) return () => rng.next()
  return (e) => evaluate(e, s) + rng.range(-20, 20)
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
