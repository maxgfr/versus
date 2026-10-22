import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { CAR_Y, LANE_X, LATERAL, OVER_X, OVER_Y, speedAt, type World } from './rules.ts'

interface Skill {
  /** Seconds between lane decisions. */
  react: number
  /** Chance per decision to pick a lane at random (a mistake). */
  err: number
  /** How fast its car swerves (units/s). */
  lateral: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.42, err: 0.2, lateral: 900 },
  normal: { react: 0.26, err: 0.06, lateral: 1150 },
  hard: { react: 0.14, err: 0.03, lateral: 1500 },
}

/** Lateral speed of a bot's car at a difficulty. */
export const botLateral = (d: Difficulty): number => SKILL[d].lateral

/** Seconds of clearance a lane is worth at most (an empty lane). */
const OPEN = 3
/** Bonus for staying put: no weaving for a tiny gain. */
const STAY = 0.12

/**
 * How safe heading for `lane` is from local x `fromX` at `lateral` units/s,
 * using the real traffic speed. Every lane the swerve crosses is checked for a
 * car that would be alongside while crossing it; the target lane scores the
 * seconds left before its next car arrives. Negative means a crash on the way.
 */
export function laneScore(
  w: World,
  side: Side,
  fromX: number,
  lane: number,
  lateral: number,
): number {
  const v = speedAt(w.rt)
  const target = LANE_X[lane] as number
  const lo = Math.min(fromX, target)
  const hi = Math.max(fromX, target)
  let clear = OPEN
  for (let l = 0; l < LANE_X.length; l++) {
    const lx = LANE_X[l] as number
    // Does the path from here to the target run through this lane's crash band?
    if (lx + OVER_X <= lo || lx - OVER_X >= hi) continue
    const enter = Math.max(0, Math.abs(lx - fromX) - OVER_X) / lateral
    const exit = l === lane ? Infinity : (Math.abs(lx - fromX) + OVER_X) / lateral
    for (const o of w.obs[side]) {
      if (o.lane !== l) continue
      const t0 = (CAR_Y - OVER_Y - o.y) / v
      const t1 = (CAR_Y + OVER_Y - o.y) / v
      if (t1 < enter) continue // gone by the time we get there
      if (l !== lane) {
        if (t0 < exit) return -OPEN + Math.max(0, t0)
        continue
      }
      if (t0 <= enter) return -OPEN + Math.max(0, t0)
      clear = Math.min(clear, t0 - enter)
    }
  }
  return clear
}

/** The safest lane to head for from x (see laneScore); staying in `current` earns a little. */
export function bestLane(
  w: World,
  side: Side,
  x: number,
  current: number,
  lateral = LATERAL,
): number {
  let best = current
  let bestScore = -Infinity
  for (let lane = 0; lane < LANE_X.length; lane++) {
    const score = laneScore(w, side, x, lane, lateral) + (lane === current ? STAY : 0)
    if (score > bestScore) {
      bestScore = score
      best = lane
    }
  }
  return best
}

/** The lane whose next car is farthest off, reachable without a crash, from `current`. */
export function farthestLane(w: World, side: Side, current: number): number {
  return bestLane(w, side, LANE_X[current] as number, current)
}

/**
 * The computer driver: every so often it looks down each lane, checks the
 * swerve over there is clear at its own steering speed, and heads for the lane
 * with the most time before its next car. Easier bots look less often and
 * slip more.
 */
export class DodgeBot {
  private sk: Skill
  private left = 0
  private lane = 1

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  /** The local x to steer toward this step. */
  decide(w: World, side: Side, dt: number): number {
    this.left -= dt
    if (this.left <= 0) {
      // Human-ish timing: each decision comes a little early or late.
      this.left = this.sk.react * this.rng.range(0.7, 1.3)
      this.lane = this.pick(w, side)
    }
    return LANE_X[this.lane] as number
  }

  private pick(w: World, side: Side): number {
    if (this.rng.chance(this.sk.err)) return this.rng.int(0, LANE_X.length - 1)
    return bestLane(w, side, w.drivers[side].x, this.lane, this.sk.lateral)
  }
}
