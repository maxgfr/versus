import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Ball, BALL_A, inArc, ROW, rowAt, TURN, wrap } from './rules.ts'

/**
 * The computer steers a path through the next few rings with the real rules:
 * which angles are clear on each ring, and which of them it can still turn to
 * in the time left before that ring (its turn rate is the ball's). It aims at
 * the safest clear angle on the next ring that keeps a way through the rings
 * after it. Easier levels look fewer rings ahead, react slower and aim worse.
 */

interface Skill {
  /** Frames between re-aims: the reaction time. */
  react: number
  /** Random error on each aim (rad). */
  spread: number
  /** Rings planned ahead. */
  rings: number
  /** Share of the ball's turn rate the plan counts on. */
  trust: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 16, spread: 0.28, rings: 1, trust: 0.55 },
  normal: { react: 9, spread: 0.12, rings: 2, trust: 0.7 },
  hard: { react: 2, spread: 0.02, rings: 4, trust: 0.85 },
}

/** Angles sampled around the ring. */
const N = 120
const ANG = (k: number): number => -Math.PI + ((k + 0.5) / N) * Math.PI * 2

export interface Brain {
  timer: number
  aim: number
}

export function newBrain(): Brain {
  return { timer: 0, aim: 0 }
}

/** Steering target for this step (re-chosen every few frames). */
export function drive(b: Ball, seed: number, d: Difficulty, rng: Rng, brain: Brain): number {
  if (brain.timer <= 0) {
    const s = SKILL[d]
    brain.timer = s.react
    brain.aim = wrap(aimAt(b, seed, s.rings, s.trust) + rng.range(-1, 1) * s.spread)
  }
  brain.timer--
  return brain.aim
}

/** Clear angles of ring i: off the holes (with room) and, when `bars`, off the barriers too. */
function clear(seed: number, i: number, bars: boolean): boolean[] {
  const row = rowAt(seed, i)
  const out: boolean[] = []
  for (let k = 0; k < N; k++) {
    const a = ANG(k)
    let ok = !row.holes.some((h) => inArc(a, h, BALL_A * 0.8))
    if (ok && bars) ok = !row.bars.some((r) => inArc(a, r, BALL_A * 1.6))
    out.push(ok)
  }
  return out
}

/** Sample indices within `reach` radians of angle index j (wrapping). */
function near(j: number, reach: number, set: boolean[]): boolean {
  const n = Math.min(N / 2, Math.floor((reach / (Math.PI * 2)) * N))
  for (let d = -n; d <= n; d++) if (set[(j + d + N) % N]) return true
  return false
}

/** The angle to steer to. Exported for tests. */
export function aimAt(b: Ball, seed: number, rings: number, trust: number): number {
  for (const bars of [true, false]) {
    const aim = plan(b, seed, rings, trust, bars)
    if (aim !== null) return aim
  }
  return b.phi
}

function plan(b: Ball, seed: number, rings: number, trust: number, bars: boolean): number | null {
  const v = Math.max(120, b.v)
  const free: boolean[][] = []
  const gaps: number[] = []
  let last = b.dist
  for (let k = 0; k < rings; k++) {
    const i = b.next + k
    free.push(clear(seed, i, bars))
    const at = i * ROW
    gaps.push(Math.max(0, (at - last) / v) * TURN * trust)
    last = at
  }
  // Backward: angles from which the rest of the plan still works.
  let good = free[rings - 1] as boolean[]
  for (let k = rings - 2; k >= 0; k--) {
    const f = free[k] as boolean[]
    const next = good
    const reach = gaps[k + 1] as number
    good = f.map((ok, j) => ok && near(j, reach, next))
  }
  // Forward: what the ball can reach on the next ring from where it is.
  const reach0 = gaps[0] as number
  let best = -1
  let bestScore = -Infinity
  for (let j = 0; j < N; j++) {
    if (!good[j]) continue
    const turn = Math.abs(wrap(ANG(j) - b.phi))
    if (turn > reach0 + 0.05) continue
    // Prefer the middle of a clear stretch, then the shortest turn (turning costs speed).
    let m = 0
    while (m < 12 && good[(j + m + 1) % N] && good[(j - m - 1 + N) % N]) m++
    const score = m - turn * 4
    if (score > bestScore) {
      bestScore = score
      best = j
    }
  }
  return best < 0 ? null : ANG(best)
}
