import type { Difficulty } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'
import { type Chicken, CH_HALF, HOLD_T, nextObstacle, RUN_X, stepChicken } from './rules.ts'

/**
 * The computer plans each obstacle with the real rules: once it is close, it
 * tries every take-off point (now, one step later, …) with a tap and with a
 * held jump, keeps the ones that survive, and picks the safest (and, the better
 * it plays, the one that grabs the eggs). Then it runs to that point and jumps.
 */

const DT = 1 / 60
/** Plan once the next obstacle is this many seconds of running away. */
const LOOK = 0.95
/** Take-off points tried: one per step, up to this many steps from now. */
const TRIES = 60
/** Steps run after landing before a plan counts as safe. */
const AFTER = 10

interface Skill {
  /** Share of obstacles the bot misjudges completely and runs into. */
  lapse: number
  /** Take-off error, in steps either way. */
  slip: number
  /** Worth of an egg against a step of safety margin. */
  greed: number
  /** Whether it ever holds for a high jump. */
  hold: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { lapse: 0.08, slip: 7, greed: 0, hold: false },
  normal: { lapse: 0.03, slip: 3, greed: 2, hold: true },
  hard: { lapse: 0.004, slip: 1, greed: 8, hold: true },
}

export interface Plan {
  /** Obstacle index planned for (-1: none). */
  obs: number
  /** Distance at which to take off. */
  at: number
  hold: boolean
  /** Game time to let go of a held jump. */
  release: number
}

export function newPlan(): Plan {
  return { obs: -1, at: Infinity, hold: false, release: -1 }
}

export interface Intent {
  tap: boolean
  hold: boolean
}

/** Survives running `wait` steps then jumping (held or not): eggs picked up, or -1 if it dies. */
export function trial(
  seed: number,
  c: Chicken,
  speed: number,
  wait: number,
  hold: boolean,
): number {
  const s: Chicken = { ...c, taken: c.taken.slice() }
  const eggs = s.eggs
  for (let i = 0; i < wait; i++) {
    stepChicken(seed, s, DT, speed, false, false, 0)
    if (!s.alive) return -1
  }
  const holdSteps = hold ? Math.ceil(HOLD_T / DT) + 1 : 0
  stepChicken(seed, s, DT, speed, true, hold, 0)
  let after = -1
  for (let i = 1; i < 200; i++) {
    stepChicken(seed, s, DT, speed, false, i < holdSteps, 0)
    if (!s.alive) return -1
    if (s.grounded && after < 0) after = i
    if (after >= 0 && i - after >= AFTER) break
  }
  return s.eggs - eggs
}

/** Pick the take-off for the next obstacle. Exported for tests. */
export function plan(
  seed: number,
  c: Chicken,
  speed: number,
  d: Difficulty,
  salt: number,
  obs: number,
): Plan {
  const skill = SKILL[d]
  const rows = skill.hold ? [false, true] : [false]
  let best: { k: number; hold: boolean; score: number } | null = null
  // Options whose margin covers the bot's own slip come first: greed never buys a crash.
  const need = skill.slip + 1
  for (const hold of rows) {
    const eggs: number[] = []
    for (let k = 0; k < TRIES; k++) eggs.push(trial(seed, c, speed, k, hold))
    for (let k = 0; k < TRIES; k++) {
      const e = eggs[k] ?? -1
      if (e < 0) continue
      // Safety margin: how many steps either way still survive.
      let m = 0
      while (m < 8 && (eggs[k - m - 1] ?? -1) >= 0 && (eggs[k + m + 1] ?? -1) >= 0) m++
      const score =
        (m >= need ? 100 : 0) +
        e * skill.greed +
        m +
        (hold ? 0 : 0.3) +
        hash01(seed ^ salt, obs * 64 + k, 13) * 0.2
      if (!best || score > best.score) best = { k, hold, score }
    }
  }
  if (!best) return { obs, at: c.dist, hold: false, release: -1 }
  const slip = Math.round((hash01(seed ^ salt, obs, 9) * 2 - 1) * skill.slip)
  return { obs, at: c.dist + Math.max(0, best.k + slip) * speed * DT, hold: best.hold, release: -1 }
}

/**
 * This step's press and hold. `p` is the bot's memory (host only, never in
 * the state); a fresh one per round.
 */
export function decide(
  seed: number,
  c: Chicken,
  speed: number,
  d: Difficulty,
  now: number,
  p: Plan,
  salt = 0,
): Intent {
  const hold = p.hold && now < p.release
  if (!c.alive) return { tap: false, hold: false }
  const front = c.dist + RUN_X + CH_HALF
  const o = nextObstacle(seed, front - 10)
  if (c.grounded && o.i !== p.obs && o.x - front <= LOOK * speed) {
    // The opening obstacles are always seen, so a round never ends on the first step.
    if (o.i >= 2 && hash01(seed ^ salt, o.i, 5) < SKILL[d].lapse)
      Object.assign(p, newPlan(), { obs: o.i })
    else Object.assign(p, plan(seed, c, speed, d, salt, o.i))
  }
  if (c.grounded && c.dist >= p.at) {
    p.at = Infinity
    p.release = now + HOLD_T + DT
    return { tap: true, hold: p.hold }
  }
  return { tap: false, hold }
}
