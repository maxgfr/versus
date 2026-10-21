import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { angleTo, type Drive, SHIELD, type World } from './rules.ts'

interface Skill {
  /** How closely the horse must face the rival before it charges (rad). */
  aim: number
  /** Chance to take a charge that is on. */
  charge: number
  /** Error on the steering direction (rad), re-rolled every half second. */
  err: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { aim: 0.3, charge: 0.6, err: 0.3 },
  normal: { aim: 0.2, charge: 0.9, err: 0.1 },
  hard: { aim: 0.12, charge: 1, err: 0.09 },
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
