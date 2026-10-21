import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { PEG_R, PEGS, type Ring, resting, stepTank, type Tank, TIP, wellOf } from './rules.ts'

/** Which pumps are held: [left pump, right pump]. Works in red's frame, so it plays either side. */
export type Pumps = [boolean, boolean]

interface Skill {
  /** Seconds between two looks at the tank. */
  think: number
  /** Seconds of water the computer plays out in its head before choosing. */
  horizon: number
  /** Chance per look to fumble and let go of the pumps. */
  slip: number
  /** Chance per look to mash a random pump instead of thinking. */
  mash: number
  /** How far off (u) the computer misjudges where each ring is. */
  noise: number
  /** Whether the computer also plans long holds (it then lifts rings much more cleverly). */
  long: boolean
  /** Whether it plays the water out in its head at all, or just pushes the lowest ring toward a peg. */
  plan: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { think: 0.8, horizon: 1.2, slip: 0.6, mash: 0.45, noise: 60, long: false, plan: false },
  normal: { think: 0.45, horizon: 1.8, slip: 0.25, mash: 0.2, noise: 35, long: false, plan: true },
  hard: { think: 0.3, horizon: 2.2, slip: 0.06, mash: 0.05, noise: 15, long: true, plan: true },
}

export const thinkEvery = (d: Difficulty): number => SKILL[d].think

const OPTIONS: readonly Pumps[] = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
]

/** Where a ring ends up once the water has slowed it down (sideways drag ≈ 2.2/s). */
const drift = (r: Ring): number => r.x + r.vx / 2.2

/** How promising a tank looks: landed rings first, then rings drifting over a peg. Lower is better. */
function badness(t: Tank): number {
  let v = -1000 * (t.pegs[0] + t.pegs[1])
  for (const r of t.rings) {
    if (resting(r)) {
      v += 140
      continue
    }
    const x = drift(r)
    const off = Math.min(Math.abs(PEGS[0] - x), Math.abs(PEGS[1] - x))
    // Below the tips and off the pegs, a ring is heading for the sand.
    if (r.y > TIP && off > PEG_R) v += 120 + Math.min(140, off) * 0.2
    else v += Math.min(140, off) * (0.6 + (r.y - 1000) / 900)
  }
  return v
}

/**
 * The rule of thumb: take the lowest ring still in the water and push it toward
 * the nearer peg (the left pump blows right, the right pump left); with
 * nothing in the water, blow a ring off the sand.
 */
export function push(t: Tank, noise: number, rng: Rng): Pumps {
  const water = t.rings.filter((r) => !resting(r))
  if (water.length === 0) {
    const r = t.rings[0]
    if (!r) return [false, false]
    return wellOf(r.x) === 0 ? [true, false] : [false, true]
  }
  const r = water.reduce((a, b) => (b.y > a.y ? b : a))
  const x = r.x + rng.range(-noise, noise)
  const p = Math.abs(PEGS[0] - x) <= Math.abs(PEGS[1] - x) ? 0 : 1
  const dx = PEGS[p] - x
  if (Math.abs(dx) <= 20) return [false, false]
  return dx > 0 ? [true, false] : [false, true]
}

/** Copy of a tank for thinking ahead (plain data, so a copy of each entry is enough). */
function clone(t: Tank): Tank {
  return {
    ...t,
    rings: t.rings.map((r) => ({ ...r })),
    pegs: [t.pegs[0], t.pegs[1]],
    stacks: [[...t.stacks[0]], [...t.stacks[1]]],
    landAt: [t.landAt[0], t.landAt[1]],
    puffAt: [t.puffAt[0], t.puffAt[1]],
    bubbles: t.bubbles.map((b) => ({ ...b })),
  }
}

/**
 * Pumps for the next beat: play each choice (held for one beat or for a
 * second, then let go) forward in a copy of the tank and keep the one that leaves the rings best
 * placed over a peg. `time` is the game time, so the dispenser plays out too.
 */
export function choosePumps(t: Tank, d: Difficulty, rng: Rng, time = 0): Pumps {
  if (t.rings.length === 0) return [false, false]
  const skill = SKILL[d]
  if (rng.chance(skill.slip)) return [false, false]
  if (rng.chance(skill.mash)) return [rng.chance(0.5), rng.chance(0.5)]
  if (!skill.plan) return push(t, skill.noise, rng)
  // What the computer believes it sees.
  const seen = clone(t)
  for (const r of seen.rings) r.x += rng.range(-skill.noise, skill.noise)
  const dt = 1 / 30
  const steps = Math.round(skill.horizon / dt)
  let best: Pumps = [false, false]
  let bestScore = Infinity
  // Each choice is tried as a tap (one beat) and as a long hold.
  const holds = skill.long ? [skill.think, 1] : [skill.think]
  for (const hold of holds.map((h) => Math.round(h / dt))) {
    for (const o of OPTIONS) {
      if (!o[0] && !o[1] && hold > 1 / dt / 2) continue
      const c = clone(seen)
      const sim = new Rng(7)
      for (let i = 0; i < steps; i++) {
        stepTank(c, dt, time + i * dt, i < hold ? o : [false, false], sim)
      }
      // A small bias against pumping for nothing.
      const score = badness(c) + (o[0] ? 2 : 0) + (o[1] ? 2 : 0)
      if (score < bestScore) {
        bestScore = score
        best = o
      }
    }
  }
  return [best[0], best[1]]
}
