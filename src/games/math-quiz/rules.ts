import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/** Pure Math Quiz rules: questions, answer options, and the race state. */

/** First to this many points takes the match. */
export const TARGET = 10
/** Pause after a point before the next sum appears (the answer stays on show). */
export const NEXT_DELAY = 1.1
/** Pause after both players are locked out, before the next sum. */
export const VOID_DELAY = 1.3

export const OPS = ['+', '-', '×'] as const
export type Op = (typeof OPS)[number]

export interface Question {
  a: number
  b: number
  op: Op
  answer: number
}

/** Operand ranges by difficulty: bigger numbers, harder sums. */
const RANGE: Record<
  Difficulty,
  { add: [number, number]; mulA: [number, number]; mulB: [number, number] }
> = {
  easy: { add: [1, 12], mulA: [2, 6], mulB: [2, 10] },
  normal: { add: [5, 35], mulA: [3, 9], mulB: [3, 12] },
  hard: { add: [20, 99], mulA: [6, 12], mulB: [6, 15] },
}

/**
 * A sum for the level. `heat` (0..1: how close the leader is to winning)
 * stretches the top of each range, so the race gets tougher at the end.
 */
export function makeQuestion(rng: Rng, d: Difficulty, heat = 0): Question {
  const r = RANGE[d]
  const k = Math.min(1, Math.max(0, heat))
  const top = (hi: number, grow: number) => Math.round(hi + grow * k)
  const op = rng.pick(OPS)
  if (op === '×') {
    const a = rng.int(r.mulA[0], top(r.mulA[1], 3))
    const b = rng.int(r.mulB[0], top(r.mulB[1], 3))
    return { a, b, op, answer: a * b }
  }
  let a = rng.int(r.add[0], top(r.add[1], r.add[1] * 0.6))
  let b = rng.int(r.add[0], top(r.add[1], r.add[1] * 0.6))
  if (op === '+') return { a, b, op, answer: a + b }
  // Subtraction: keep the answer a positive number.
  if (b > a) [a, b] = [b, a]
  if (a === b) a += 1
  return { a, b, op, answer: a - b }
}

/**
 * Four distinct options, the correct one included, all positive. Wrong options
 * sit close to the answer, and products also offer the classic slips (one
 * factor off by one). Returned in no particular order.
 */
export function makeOptions(rng: Rng, q: Question): number[] {
  const cands = new Set<number>()
  const add = (v: number) => {
    if (v >= 1 && v !== q.answer) cands.add(v)
  }
  if (q.op === '×') {
    add(q.answer + q.a)
    add(q.answer - q.a)
    add(q.answer + q.b)
    add(q.answer - q.b)
  }
  for (let k = 1; cands.size < 12; k++) {
    add(q.answer + k)
    add(q.answer - k)
  }
  const wrong = rng.shuffle([...cands]).slice(0, 3)
  return [q.answer, ...wrong]
}

export interface QuizState {
  q: Question
  /** Each side's option buttons, in the order that side sees them. */
  choices: [number[], number[]]
  score: [number, number]
  /** A side that tapped a wrong option is out for this sum. */
  locked: [boolean, boolean]
  /** The sum is settled: someone scored, or both are locked out. */
  done: boolean
  /** Who scored this sum, or null when both were locked out. */
  winner: Side | null
  /** Game time the sum was settled (-1 while live). */
  doneAt: number
  /** Game time the next sum appears (-1 none). */
  dealAt: number
  /** Game time the current sum appeared. */
  qAt: number
  /** Sums dealt so far. */
  sums: number
}

/**
 * How much thinking a sum takes, about 1 (single digits) to 2 (carries,
 * borrows, big products). The computer takes longer on harder sums, as people do.
 */
export function effort(q: Question): number {
  const digits = (n: number) => String(n).split('').map(Number).reverse()
  let e = 1
  if (q.op === '×') {
    e += Math.max(0, Math.max(q.a, q.b) - 5) * 0.07 + (q.answer >= 100 ? 0.3 : 0)
  } else {
    const a = digits(q.a)
    const b = digits(q.b)
    let hard = 0
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? 0
      const y = b[i] ?? 0
      if (q.op === '+' ? x + y >= 10 : x < y) hard++
    }
    e += hard * 0.25 + (Math.max(q.a, q.b) >= 100 ? 0.25 : 0)
  }
  return Math.min(2, e)
}

/** Each side sees the same four options, in its own shuffled order. */
export function dealSum(rng: Rng, d: Difficulty, now: number, sums: number, heat = 0): QuizState {
  const q = makeQuestion(rng, d, heat)
  const opts = makeOptions(rng, q)
  return {
    q,
    choices: [rng.shuffle([...opts]), rng.shuffle([...opts])],
    score: [0, 0],
    locked: [false, false],
    done: false,
    winner: null,
    doneAt: -1,
    dealAt: -1,
    qAt: now,
    sums: sums + 1,
  }
}

/** Replace the current sum with a fresh one (scores carry over). */
export function nextSum(s: QuizState, rng: Rng, d: Difficulty, now: number, heat = 0): void {
  const fresh = dealSum(rng, d, now, s.sums, heat)
  Object.assign(s, fresh, { score: s.score })
}

export type Press = 'right' | 'wrong' | 'ignored'

/**
 * A side taps option `idx`. Right: +1 and the sum is settled. Wrong: -1 and that
 * side is locked out for this sum; if both sides are locked the sum is void.
 */
export function press(s: QuizState, side: Side, idx: number, now: number): Press {
  if (s.done || s.locked[side]) return 'ignored'
  const v = s.choices[side][idx]
  if (v === undefined) return 'ignored'
  if (v === s.q.answer) {
    s.score[side]++
    s.done = true
    s.winner = side
    s.doneAt = now
    s.dealAt = now + NEXT_DELAY
    return 'right'
  }
  s.score[side]--
  s.locked[side] = true
  if (s.locked[0] && s.locked[1]) {
    s.done = true
    s.winner = null
    s.doneAt = now
    s.dealAt = now + VOID_DELAY
  }
  return 'wrong'
}

/** The side that has reached the target, if any. */
export function champion(s: QuizState, target = TARGET): Side | null {
  if (s.score[0] >= target) return 0
  if (s.score[1] >= target) return 1
  return null
}

/** True on the step the next sum should appear. */
export function due(s: QuizState, now: number): boolean {
  return s.done && s.dealAt >= 0 && now >= s.dealAt
}
