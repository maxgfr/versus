import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { AIRTIME, obstacleAt, TRUCK_HALF, type Truck, WALL_V } from './rules.ts'

/** Timing error on each jump (units of road): how early or late the bot presses. */
const JUMP_ERR: Record<Difficulty, number> = { easy: 70, normal: 28, hard: 8 }
/** Timing error on each boost: how early or late the bot starts to push. */
const BOOST_ERR: Record<Difficulty, number> = { easy: 120, normal: 50, hard: 12 }
/** Safety margin before the wall, on top of the distance needed to reach WALL_V. */
const BOOST_MARGIN = 40
/** Land this far past the gap's far edge. */
const LAND_PAST = 60
/**
 * Latest press, short of a gap's near edge (units). A truck moves at most ~7 units a
 * step at the speeds it jumps at, so this window is always sampled. Without it, a
 * truck climbing out of a pit (slow) keeps pressing too late and falls in forever.
 */
const PRESS_LAST = 8
const BOOST_ACC = 520

export interface Brain {
  /** Obstacle index the errors were drawn for. */
  k: number
  jitter: number
  boosting: boolean
}

export function newBrain(): Brain {
  return { k: -1, jitter: 0, boosting: false }
}

export interface Intent {
  jump: boolean
  boost: boolean
}

/**
 * Jump so the truck lands just past each gap, and boost so it reaches
 * WALL_V in time to smash each wall. Both use distances, with a timing error
 * drawn once per attempt (a truck that falls climbs out and tries again).
 */
export function drive(t: Truck, seed: number, d: Difficulty, rng: Rng, brain: Brain): Intent {
  if (t.state === 'rise') brain.k = -1
  if (brain.k !== t.k) {
    brain.k = t.k
    brain.boosting = false
    brain.jitter = rng.range(-1, 1)
  }
  const o = obstacleAt(seed, t.k)
  let jump = false
  let boost = false
  if (o.kind === 'gap') {
    // Press at the point where the air time carries the truck past the far edge.
    const aim = o.x + o.len + LAND_PAST - t.v * AIRTIME
    const at = Math.min(aim + brain.jitter * JUMP_ERR[d], o.x - PRESS_LAST)
    const grounded = t.y <= 0 && t.vy <= 0
    jump = grounded && t.x >= at && t.x < o.x
  } else {
    const front = o.x - (t.x + TRUCK_HALF)
    const need = t.v < WALL_V ? (WALL_V * WALL_V - t.v * t.v) / (2 * BOOST_ACC) : 0
    if (front <= need + BOOST_MARGIN + brain.jitter * BOOST_ERR[d]) brain.boosting = true
    // Keep pushing until the wall is smashed, or the meter runs dry.
    boost = brain.boosting && t.state === 'run' && t.boost > 1
    if (t.boost <= 1 && t.v < WALL_V) brain.boosting = false
  }
  return { jump, boost }
}
