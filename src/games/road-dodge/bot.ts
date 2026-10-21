import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { CAR_Y, LANE_X, type World } from './rules.ts'

interface Skill {
  /** Seconds between lane decisions. */
  react: number
  /** Chance per decision to pick a lane at random (a mistake). */
  err: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.42, err: 0.2 },
  normal: { react: 0.26, err: 0.06 },
  hard: { react: 0.14, err: 0.03 },
}

/** Lane bonus for staying put: no weaving for a tiny gain. */
const STAY = 40

/**
 * The lane whose nearest oncoming car is farthest from the driver (bigger is
 * safer). Staying in `current` earns a small bonus, so the bot does not weave.
 */
export function farthestLane(w: World, side: Side, current: number): number {
  const list = w.obs[side]
  let best = 0
  let bestScore = -Infinity
  for (let lane = 0; lane < LANE_X.length; lane++) {
    let nearest = 4000
    for (const o of list)
      if (o.lane === lane && o.y <= CAR_Y) nearest = Math.min(nearest, CAR_Y - o.y)
    const score = nearest + (lane === current ? STAY : 0)
    if (score > bestScore) {
      bestScore = score
      best = lane
    }
  }
  return best
}

/**
 * The computer driver: every so often it looks down each lane and heads for the
 * one whose nearest oncoming car is farthest away.
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
    return farthestLane(w, side, this.lane)
  }
}
