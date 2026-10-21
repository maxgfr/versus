import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Arc, type Ball, BALL_A, inArc, rowAt, wrap } from './rules.ts'

/** Frames between re-aims: the bot's reaction time. */
const REACT: Record<Difficulty, number> = { easy: 16, normal: 8, hard: 3 }
/** Random error on each aim (rad). */
const SPREAD: Record<Difficulty, number> = { easy: 0.3, normal: 0.1, hard: 0.02 }
/** Free-angle sampling of the ring. */
const N = 180
/** A free sector must fit the ball with room to spare (samples). */
const MIN_RUN = 8

export interface Brain {
  timer: number
  aim: number
}

export function newBrain(): Brain {
  return { timer: 0, aim: 0 }
}

/**
 * The angle to steer to: the centre of the free sector nearest the ball, among
 * the next two rings. Re-chosen every few frames, with a per-difficulty error.
 */
export function drive(b: Ball, seed: number, d: Difficulty, rng: Rng, brain: Brain): number {
  if (brain.timer <= 0) {
    brain.timer = REACT[d]
    brain.aim = aimAt(b, seed) + rng.range(-1, 1) * SPREAD[d]
  }
  brain.timer--
  return brain.aim
}

function aimAt(b: Ball, seed: number): number {
  const blocked: Arc[] = []
  for (const i of [b.next, b.next + 1]) {
    const row = rowAt(seed, i)
    blocked.push(...row.holes, ...row.bars)
  }
  const free = Array.from({ length: N }, (_, k) => {
    const phi = -Math.PI + (k / N) * Math.PI * 2
    return !blocked.some((a) => inArc(phi, a, BALL_A))
  })
  // Runs of free samples (wrapping around the ring).
  const runs: { from: number; len: number }[] = []
  let start = -1
  for (let k = 0; k < N * 2; k++) {
    const f = free[k % N]
    if (f && start < 0) start = k
    if ((!f || k === N * 2 - 1) && start >= 0) {
      const len = k - start + (f && k === N * 2 - 1 ? 1 : 0)
      if (len > 0) runs.push({ from: start % N, len: Math.min(len, N) })
      start = -1
    }
  }
  if (runs.length === 0) return b.phi
  const sampleAngle = (k: number) => -Math.PI + (k / N) * Math.PI * 2
  let best = runs[0] as { from: number; len: number }
  let bestCost = Infinity
  for (const r of runs) {
    const centre = sampleAngle(r.from + r.len / 2)
    const cost = Math.abs(wrap(centre - b.phi)) + (r.len < MIN_RUN ? 4 : 0) - r.len * 0.01
    if (cost < bestCost) {
      bestCost = cost
      best = r
    }
  }
  return wrap(sampleAngle(best.from + best.len / 2))
}
