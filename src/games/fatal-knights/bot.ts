import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { angleTo, type Drive, type Ev, SHIELD, stepWorld, type World } from './rules.ts'

interface Skill {
  /** How closely the horse must face the rival before it charges (rad). */
  aim: number
  /** Chance to take a charge that is on. */
  charge: number
  /** Error on the steering direction (rad), re-rolled every half second. */
  err: number
  /**
   * Look-ahead: headings tried, seconds simulated with the real rules, and
   * seconds between two searches (0 headings = the plain flanking heuristic).
   */
  dirs: number
  horizon: number
  every: number
  /** Rival model in the look-ahead: riding straight at me, or holding its course. */
  model: 'chase' | 'course'
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { aim: 0.3, charge: 0.6, err: 0.35, dirs: 6, horizon: 0.5, every: 0.4, model: 'chase' },
  normal: { aim: 0.2, charge: 0.9, err: 0.12, dirs: 10, horizon: 0.8, every: 0.2, model: 'chase' },
  hard: { aim: 0.12, charge: 1, err: 0.03, dirs: 24, horizon: 0.8, every: 0.1, model: 'course' },
}

/** Simulation step for the look-ahead (coarser than the game's, still touch-safe). */
const SIM_DT = 1 / 30

/** A throwaway copy of the world for the look-ahead. */
function clone(w: World): World {
  return {
    ...w,
    k: [{ ...w.k[0] }, { ...w.k[1] }],
    pts: [w.pts[0], w.pts[1]],
    hit: null,
    glide: null,
  }
}

/**
 * How good a position is for `side` once the look-ahead runs out: riding at
 * the rival's back is good, showing it mine is bad, close beats far.
 */
function judge(w: World, side: Side): number {
  const me = w.k[side]
  const foe = w.k[side === 0 ? 1 : 0]
  const dist = Math.hypot(foe.x - me.x, foe.y - me.y)
  // 0 when I sit in its shield, 1 right behind it.
  const behind = Math.abs(angleTo(foe.a, Math.atan2(me.y - foe.y, me.x - foe.x))) / Math.PI
  const exposed = Math.abs(angleTo(me.a, Math.atan2(foe.y - me.y, foe.x - me.x))) / Math.PI
  return behind * 60 - exposed * 45 - dist / 25
}

/**
 * Try `dirs` headings (with and without a charge when it is ready) by running
 * the real rules forward, the rival riding straight at me, and return the best
 * heading and whether to charge now.
 */
export function search(
  w: World,
  side: Side,
  dirs: number,
  horizon: number,
  model: 'chase' | 'course' = 'chase',
): { a: number; press: boolean } {
  const foeSide: Side = side === 0 ? 1 : 0
  const me = w.k[side]
  const canCharge = w.t >= me.ready && w.t >= me.charge
  const ev: Ev[] = []
  const drives: Drive[] = [
    { jx: 0, jy: 0, press: false },
    { jx: 0, jy: 0, press: false },
  ]
  let best = { a: me.a, press: false }
  let bestScore = -Infinity
  const n = Math.ceil(horizon / SIM_DT)
  for (let i = 0; i < dirs; i++) {
    const a = me.a + ((i / dirs) * 2 - 1) * Math.PI + Math.PI / dirs
    for (const press of canCharge ? [false, true] : [false]) {
      const sim = clone(w)
      let score = 0
      let done = false
      for (let k = 0; k < n && !done; k++) {
        const sm = sim.k[side]
        const sf = sim.k[foeSide]
        drives[side] = { jx: Math.cos(a), jy: Math.sin(a), press: press && k === 0 }
        drives[foeSide] =
          model === 'chase'
            ? { jx: sm.x - sf.x, jy: sm.y - sf.y, press: false }
            : { jx: Math.cos(sf.a), jy: Math.sin(sf.a), press: false }
        ev.length = 0
        const scorer = stepWorld(sim, drives, SIM_DT, ev)
        if (scorer === side) {
          score = 1000 - k * 5
          done = true
        } else if (scorer === foeSide) {
          score = -1000 + k * 5
          done = true
        } else if (ev.some((e) => e.k === 'clash')) score -= 30
      }
      if (!done) score += judge(sim, side)
      // A charge spent for nothing costs its cooldown.
      if (press && score < 500) score -= 15
      if (score > bestScore) {
        bestScore = score
        best = { a, press }
      }
    }
  }
  return best
}

/**
 * The computer knight. It closes in, circles to get round the rival's shield,
 * then flanks: it rides to the rival's back or side and charges once it is
 * lined up. Either side: everything is relative to the rival. Bots run on the
 * host only, so nothing here is snapshotted.
 */
export class KnightBot {
  private sk: Skill
  private err = 0
  private errT = 0
  private plan: { a: number; press: boolean } | null = null
  private planT = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, side: Side, dt: number): Drive {
    const none: Drive = { jx: 0, jy: 0, press: false }
    if (w.rest >= 0 && w.t < w.rest) return none
    const me = w.k[side]
    const foe = w.k[side === 0 ? 1 : 0]
    this.errT -= dt
    if (this.errT <= 0) {
      this.err = this.rng.range(-this.sk.err, this.sk.err)
      this.errT = 0.5
    }
    // Normal and hard plan by riding the real rules forward.
    if (this.sk.dirs > 0) {
      this.planT -= dt
      if (this.planT <= 0 || !this.plan) {
        this.plan = search(w, side, this.sk.dirs, this.sk.horizon, this.sk.model)
        this.planT = this.sk.every
        const p = this.plan.press
        this.plan.press = false
        const a = this.plan.a + this.err
        return { jx: Math.cos(a), jy: Math.sin(a), press: p && this.rng.chance(this.sk.charge) }
      }
      const a = this.plan.a + this.err
      return { jx: Math.cos(a), jy: Math.sin(a), press: false }
    }
    const dx = foe.x - me.x
    const dy = foe.y - me.y
    const dist = Math.hypot(dx, dy)
    const toFoe = Math.atan2(dy, dx)
    // Where I am, seen from the rival's facing: small means I am in its shield.
    const rel = angleTo(foe.a, Math.atan2(me.y - foe.y, me.x - foe.x))
    const inFront = Math.abs(rel) < SHIELD + 0.1 && dist < 300

    let want: number
    if (inFront) {
      // Orbit round to the side of the rival's shield.
      const around = Math.atan2(me.y - foe.y, me.x - foe.x) + (rel >= 0 ? 0.9 : -0.9)
      want = Math.atan2(
        foe.y + Math.sin(around) * 210 - me.y,
        foe.x + Math.cos(around) * 210 - me.x,
      )
    } else if (dist > 340) {
      want = toFoe
    } else {
      // Flank: ride to the spot behind the rival, then close in on it.
      const back = foe.a + Math.PI
      const fx = foe.x + Math.cos(back) * 120
      const fy = foe.y + Math.sin(back) * 120
      want = Math.atan2(fy - me.y, fx - me.x)
      if (Math.hypot(fx - me.x, fy - me.y) < 60) want = toFoe
    }
    want += this.err

    const sideOn = Math.abs(rel) > SHIELD + 0.3
    const aligned = Math.abs(angleTo(me.a, toFoe)) < this.sk.aim
    // Behind the rival (or beside it), lined up on the spot: a charge closes the gap.
    const back = foe.a + Math.PI
    const flankAim = Math.atan2(
      foe.y + Math.sin(back) * 120 - me.y,
      foe.x + Math.cos(back) * 120 - me.x,
    )
    const lined = Math.abs(angleTo(me.a, flankAim)) < 0.45
    const press =
      me.ready <= w.t &&
      this.rng.chance(this.sk.charge) &&
      ((sideOn && aligned && dist < 260) || (!inFront && lined && dist < 300))
    // Ease off while turning: a slower horse turns in a tighter circle.
    const turn = Math.abs(angleTo(me.a, want))
    const m = Math.max(0.4, Math.cos(Math.min(turn, Math.PI / 2)))
    return { jx: Math.cos(want) * m, jy: Math.sin(want) * m, press }
  }
}
