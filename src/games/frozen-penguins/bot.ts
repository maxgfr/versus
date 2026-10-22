import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Drive, distC, type Ev, FLOE, floeR, PR, stepWorld, type World } from './rules.ts'

interface Skill {
  /** Chance to dash when the chance is there. */
  dash: number
  /** Error on the steering direction (rad), re-rolled every half second. */
  err: number
  /**
   * Look-ahead: headings tried, seconds simulated with the real rules, and
   * seconds between two searches (0 headings = the plain herding heuristic).
   */
  dirs: number
  horizon: number
  every: number
  /** Rival replies each heading is tested against (the worst one counts). */
  replies: readonly Reply[]
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { dash: 0.5, err: 0.3, dirs: 0, horizon: 0, every: 0, replies: [] },
  normal: { dash: 0.9, err: 0.12, dirs: 10, horizon: 0.5, every: 0.15, replies: ['ram', 'hold'] },
  hard: {
    dash: 1,
    err: 0.02,
    dirs: 16,
    horizon: 0.9,
    every: 0.1,
    replies: ['ram', 'chase', 'hold', 'home'],
  },
}

const SIM_DT = 1 / 30
/** Deceleration a penguin manages by pushing against its slide (the rules' stick acceleration). */
const BRAKE = 1250

/** How safe `side` is versus its rival: room to the rim, mine minus theirs. */
function judge(w: World, side: Side): number {
  const R = floeR(w.t)
  const me = w.p[side]
  const foe = w.p[side === 0 ? 1 : 0]
  // Room left before the rim, less the distance it needs to brake the speed
  // it carries outward (full counter-steer: v² / 2a).
  const room = (p: typeof me) => {
    const d = distC(p) || 1
    const out = Math.max(0, ((p.x - FLOE.cx) * p.vx + (p.y - FLOE.cy) * p.vy) / d)
    return R - d - (out * out) / (2 * BRAKE)
  }
  return room(me) - room(foe)
}

/** What the rival does in a look-ahead: ride at me, ride at me and dash, stand, or head home. */
type Reply = 'chase' | 'ram' | 'hold' | 'home'

/**
 * Try `dirs` headings (with and without a dash when it is ready) by running
 * the real rules forward against each of the rival's `replies`, keep each
 * heading's worst case, and return the heading whose worst case is best and
 * whether to dash now.
 */
export function search(
  w: World,
  side: Side,
  dirs: number,
  horizon: number,
  replies: readonly Reply[] = ['chase'],
): { a: number; press: boolean } {
  const foeSide: Side = side === 0 ? 1 : 0
  const me = w.p[side]
  const canDash = w.t >= me.ready
  const ev: Ev[] = []
  const drives: Drive[] = [
    { jx: 0, jy: 0, press: false },
    { jx: 0, jy: 0, press: false },
  ]
  let best = { a: 0, press: false }
  let bestScore = -Infinity
  const n = Math.ceil(horizon / SIM_DT)
  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * Math.PI * 2
    for (const press of canDash ? [false, true] : [false]) {
      let worst = Infinity
      for (const reply of replies) {
        const sim: World = { t: w.t, p: [{ ...w.p[0] }, { ...w.p[1] }] }
        let score = 0
        let done = false
        for (let k = 0; k < n && !done; k++) {
          const sm = sim.p[side]
          const sf = sim.p[foeSide]
          drives[side] = { jx: Math.cos(a), jy: Math.sin(a), press: press && k === 0 }
          const dx = sm.x - sf.x
          const dy = sm.y - sf.y
          const near = Math.hypot(dx, dy) < 260
          drives[foeSide] =
            reply === 'hold'
              ? { jx: 0, jy: 0, press: false }
              : reply === 'home'
                ? { jx: FLOE.cx - sf.x, jy: FLOE.cy - sf.y, press: false }
                : { jx: dx, jy: dy, press: reply === 'ram' && near && sim.t >= sf.ready }
          ev.length = 0
          stepWorld(sim, drives, SIM_DT, ev)
          if (sm.fell >= 0) {
            score = -1000 + k * 5
            done = true
          } else if (sf.fell >= 0) {
            score = 1000 - k * 5
            done = true
          }
        }
        if (!done) score = judge(sim, side)
        if (score < worst) worst = score
        if (worst <= bestScore) break
      }
      // A dash spent for nothing costs its cooldown.
      if (press && worst < 500) worst -= 120
      if (worst > bestScore) {
        bestScore = worst
        best = { a, press }
      }
    }
  }
  return best
}

/**
 * The computer penguin. It keeps to the middle of the floe, gets on the
 * middle side of the rival and dashes through it, to bump it off the ice. It can take either side; nothing here is snapshotted.
 */
export class PenguinBot {
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
    const me = w.p[side]
    const foe = w.p[side === 0 ? 1 : 0]
    if (me.fell >= 0 || foe.fell >= 0) return none
    this.errT -= dt
    if (this.errT <= 0) {
      this.err = this.rng.range(-this.sk.err, this.sk.err)
      this.errT = 0.5
    }
    if (this.sk.dirs > 0) {
      this.planT -= dt
      if (this.planT <= 0 || !this.plan) {
        this.plan = search(w, side, this.sk.dirs, this.sk.horizon, this.sk.replies)
        this.planT = this.sk.every
        const a = this.plan.a + this.err
        const press = this.plan.press && this.rng.chance(this.sk.dash)
        this.plan.press = false
        return { jx: Math.cos(a), jy: Math.sin(a), press }
      }
      const a = this.plan.a + this.err
      return { jx: Math.cos(a), jy: Math.sin(a), press: false }
    }
    const R = floeR(w.t)
    const toFoe = { x: foe.x - me.x, y: foe.y - me.y }
    const dFoe = Math.hypot(toFoe.x, toFoe.y) || 1
    // Outward from the middle, through the rival.
    const oX = foe.x - FLOE.cx
    const oY = foe.y - FLOE.cy
    const oL = Math.hypot(oX, oY) || 1
    const pushes = ((toFoe.x / dFoe) * oX + (toFoe.y / dFoe) * oY) / oL > 0.35

    // Get on the middle side of the rival, then push it outward with a dash.
    const inner = 2 * PR + 16
    let tx = foe.x - (oX / oL) * inner
    let ty = foe.y - (oY / oL) * inner
    let press = false
    // Only dash once the rival is out toward the rim, where a bump can tip it in.
    const exposed = distC(foe) > 0.45 * R
    if (pushes && exposed && dFoe < 230 && me.ready <= w.t) press = this.rng.chance(this.sk.dash)
    if (press) {
      // Straight through the rival.
      tx = foe.x
      ty = foe.y
    } else if (distC(me) > 0.8 * R) {
      // Near the rim: go back to the middle.
      tx = FLOE.cx
      ty = FLOE.cy
    }
    const dx = tx - me.x
    const dy = ty - me.y
    const L = Math.hypot(dx, dy) || 1
    const ang = Math.atan2(dy, dx) + this.err
    const m = press ? 1 : Math.min(1, L / 90)
    return { jx: Math.cos(ang) * m, jy: Math.sin(ang) * m, press }
  }
}
