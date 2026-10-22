import type { Difficulty, Side } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'
import { nextHazard, type Runner, RUN_X, stepRunner, SUPPORT } from './rules.ts'

/**
 * The computer plans each hazard on the surface it runs on with the real
 * rules: it tries every flip point over the next second, keeps those that
 * land it safely on the other side, and flips at the one with the widest
 * margin. A per-hazard slip (by level) and the odd lapse make it beatable.
 */

const DT = 1 / 60
/** Plan once the hazard ahead is this many seconds of running away. */
const LOOK = 1
/** Flip points tried: one per step from now. */
const TRIES = 60
/** Steps run on the new surface before a flip counts as safe. */
const AFTER = 8

interface Skill {
  /** Share of hazards the bot never reacts to. */
  lapse: number
  /** Flip error, in steps either way. */
  slip: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { lapse: 0.1, slip: 9 },
  normal: { lapse: 0.02, slip: 5 },
  hard: { lapse: 0.006, slip: 2 },
}

export interface Plan {
  /** Hazard index planned for (-1: none). */
  hz: number
  /** Distance at which to flip. */
  at: number
}

export function newPlan(): Plan {
  return { hz: -1, at: Infinity }
}

/** Does flipping after `wait` steps (and nothing else) keep the runner alive until it has settled? */
export function safeFlip(seed: number, r: Runner, speed: number, wait: number): boolean {
  const s: Runner = { ...r }
  for (let i = 0; i < wait; i++) {
    stepRunner(seed, s, DT, speed, false, 0)
    if (!s.alive) return false
  }
  stepRunner(seed, s, DT, speed, true, 0)
  let landed = -1
  for (let i = 1; i < 120; i++) {
    stepRunner(seed, s, DT, speed, false, 0)
    if (!s.alive) return false
    if (s.grounded && landed < 0) landed = i
    if (landed >= 0 && i - landed >= AFTER) return true
  }
  return s.alive
}

/** Choose the flip for hazard `hz`. Exported for tests. */
export function plan(
  seed: number,
  r: Runner,
  speed: number,
  d: Difficulty,
  salt: number,
  hz: number,
): Plan {
  const ok: boolean[] = []
  for (let k = 0; k < TRIES; k++) ok.push(safeFlip(seed, r, speed, k))
  let best = -1
  let bestM = -1
  for (let k = 0; k < TRIES; k++) {
    if (!ok[k]) continue
    let m = 0
    while (m < 12 && ok[k - m - 1] !== false && ok[k + m + 1] !== false) m++
    // Ties go to the later flip: less time spent on a surface it has not seen yet.
    if (m >= bestM) {
      best = k
      bestM = m
    }
  }
  if (best < 0) return { hz, at: r.dist }
  const slip = Math.round((hash01(seed ^ salt, hz, 9) * 2 - 1) * SKILL[d].slip)
  return { hz, at: r.dist + Math.max(0, best + slip) * speed * r.mul * DT }
}

/**
 * Should the bot tap this step? `p` is its memory (host only, never in the
 * state); a fresh one per round.
 */
export function shouldFlip(
  seed: number,
  r: Runner,
  speed: number,
  d: Difficulty,
  p: Plan,
  salt = 0,
): boolean {
  if (!r.alive || !r.grounded) return false
  const here: Side = r.g > 0 ? 0 : 1
  const cx = r.dist + RUN_X
  const h = nextHazard(seed, here, cx - SUPPORT)
  if (h.i !== p.hz && h.x - cx <= LOOK * speed) {
    // The first hazards are always seen, so a round never ends on the opening step.
    if (h.i >= 2 && hash01(seed ^ salt, h.i, 5) < SKILL[d].lapse)
      Object.assign(p, { hz: h.i, at: Infinity })
    else Object.assign(p, plan(seed, r, speed, d, salt, h.i))
  }
  if (r.dist >= p.at) {
    p.at = Infinity
    return true
  }
  return false
}
