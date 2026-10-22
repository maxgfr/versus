import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { obstacleAt, stepTruck, TRUCK_HALF, type Truck, WALL_V } from './rules.ts'

/**
 * The computer drives by the same rules as a finger: a fresh press jumps (when
 * on the road), holding boosts. So starting a boost on the road hops, exactly
 * like a human putting a finger down; the bot only does it when the hop is
 * safe. Jumps are timed with the real rules: it plays the jump forward and
 * presses at the last safe moment minus a margin (with a per-gap slip on the
 * easier levels). Better drivers also spend spare boost for speed.
 */

const DT = 1 / 60
const BOOST_ACC = 520
const BOOST_DRAIN = 32

interface Skill {
  /** Steps of margin before the last safe press. */
  margin: number
  /** Random slip on that press, in steps either way. */
  slip: number
  /** Boost kept in reserve for the walls; above it the bot boosts for speed (Infinity: never). */
  keep: number
  /** Extra distance (units) the bot allows itself to reach smashing speed, ± per wall. */
  wallErr: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { margin: 12, slip: 10, keep: Infinity, wallErr: 170 },
  normal: { margin: 6, slip: 4, keep: Infinity, wallErr: 60 },
  hard: { margin: 2, slip: 1, keep: 40, wallErr: 8 },
}

/** Safety margin before a wall, on top of the distance needed to reach WALL_V. */
const WALL_MARGIN = 60

export interface Brain {
  /** Obstacle index the errors were drawn for. */
  k: number
  jitter: number
  /** Whether the bot's finger is down (a fresh one presses). */
  holding: boolean
  /** Bumped off the wall ahead: push for it straight away this time. */
  retry: boolean
}

export function newBrain(): Brain {
  return { k: -1, jitter: 0, holding: false, retry: false }
}

export interface Intent {
  jump: boolean
  boost: boolean
}

/**
 * Does the truck stay out of the pits if it presses after `wait` steps (never
 * when negative), holding `hold` from then on (or all along when `held`)?
 * Played past the obstacle it faces and the one after, jumping that one at
 * the last moment: a jump that lands with no room left before the next pit is
 * not safe.
 */
export function safe(seed: number, t: Truck, wait: number, hold: boolean, held: boolean): boolean {
  const c: Truck = { ...t }
  const k = t.k
  for (let i = 0; i < Math.max(0, wait) + 200; i++) {
    let press = i === wait
    if (i > wait && c.state === 'run' && c.y <= 0 && c.vy <= 0) {
      const o = obstacleAt(seed, c.k)
      if (o.kind === 'gap' && c.x < o.x && c.x + c.v * DT * 2 >= o.x) press = true
    }
    const e = stepTruck(c, seed, DT, press, held || (hold && i >= wait))
    if (e === 'fall') return false
    if (e === 'finish' || c.state !== 'run') return true
    if (c.k > k + 1 && c.y <= 0 && c.vy <= 0) return true
  }
  return true
}

/** Boost needed (meter units) to reach smashing speed from `v`. */
function wallFuel(v: number): number {
  return v >= WALL_V ? 4 : ((WALL_V - v) / BOOST_ACC) * BOOST_DRAIN + 8
}

export function drive(t: Truck, seed: number, d: Difficulty, rng: Rng, brain: Brain): Intent {
  const skill = SKILL[d]
  // A fresh try after a fall: new errors. After a bump it pushes from the start.
  if (t.state === 'rise') brain.k = -1
  if (t.state === 'bump') brain.retry = true
  if (brain.k !== t.k) {
    brain.jitter = rng.range(-1, 1)
    brain.k = t.k
    brain.retry = false
  }
  if (t.state !== 'run') {
    brain.holding = false
    return { jump: false, boost: false }
  }
  const o = obstacleAt(seed, t.k)
  const grounded = t.y <= 0 && t.vy <= 0
  // How much boost the next wall will take, and whether it is time to push for it.
  let want = false
  const wall = o.kind === 'wall' ? o : obstacleAt(seed, t.k + 1)
  const toWall = wall.kind === 'wall' ? wall.x - (t.x + TRUCK_HALF) : Infinity
  if (o.kind === 'wall') {
    const need = t.v < WALL_V ? (WALL_V * WALL_V - t.v * t.v) / (2 * BOOST_ACC) : 0
    const late = brain.retry ? Infinity : need + WALL_MARGIN + brain.jitter * skill.wallErr
    // Starting a push on a nearly empty meter only stutters: wait for the meter (a
    // bump refills it) unless the push is already on.
    const fuel = brain.holding ? 1 : wallFuel(t.v) * 0.9
    // Fast enough to coast through it (the road slows an unboosted truck): no push.
    const coast = t.v - (260 * Math.max(0, toWall)) / Math.max(1, t.v) >= WALL_V + 10
    if (toWall <= late && t.boost > fuel && !coast) want = true
  }
  // Spare boost goes into speed, keeping enough back for the next wall.
  const reserve = Math.max(skill.keep, toWall < 2500 ? wallFuel(Math.min(t.v, 440)) + 10 : 0)
  if (t.boost > reserve) want = true
  // Already pushing for a wall: keep going until it breaks. In the air, a held
  // boost is part of the jump that was planned: never let go mid-flight.
  if (brain.holding && (o.kind === 'wall' || !grounded) && t.boost > 1) want = true

  let press = false
  if (o.kind === 'gap' && grounded && t.x < o.x) {
    // Jump with or without boost, whichever the rules say clears the gap (the
    // preferred one first). A held finger keeps holding all along; a new one
    // starts with the press.
    const opts = (t.boost > 2 ? [want, !want] : [false]).map((h) => ({
      h,
      held: h && brain.holding,
    }))
    const ok = (w: number) => opts.find((o) => safe(seed, t, w, o.h, o.held))
    const now = ok(0)
    if (now) {
      const m = Math.max(1, skill.margin + Math.round(brain.jitter * skill.slip))
      if (!ok(m)) {
        press = true
        want = now.h
      } else if (!brain.holding) want = false
    } else if (t.x + t.v * DT * 2 >= o.x) {
      // Nothing safe left and the edge is here: jump and hope.
      press = true
    } else if (!brain.holding) want = false
  } else if (want && !brain.holding && grounded) {
    // A fresh finger on the road hops: only if the hop lands safely (a wall
    // ahead must be pushed for whatever comes after it).
    if (o.kind === 'wall' || safe(seed, t, 0, true, false)) press = true
    else want = false
  } else if (
    want &&
    !brain.holding &&
    !grounded &&
    o.kind !== 'wall' &&
    !safe(seed, t, -1, true, false)
  ) {
    // Boosting now would stretch this jump into the next pit.
    want = false
  }
  brain.holding = want
  return { jump: press, boost: want }
}
