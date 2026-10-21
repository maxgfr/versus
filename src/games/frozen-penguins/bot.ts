import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Drive, distC, FLOE, floeR, PR, type World } from './rules.ts'

interface Skill {
  /** Chance to dash when the chance is there. */
  dash: number
  /** Error on the steering direction (rad), re-rolled every half second. */
  err: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { dash: 0.5, err: 0.3 },
  normal: { dash: 0.85, err: 0.12 },
  hard: { dash: 1, err: 0.03 },
}

/**
 * The computer penguin. It keeps to the middle of the floe, gets on the
 * middle side of the rival and dashes through it, to bump it off the ice. It can take either side; nothing here is snapshotted.
 */
export class PenguinBot {
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
    const me = w.p[side]
    const foe = w.p[side === 0 ? 1 : 0]
    if (me.fell >= 0 || foe.fell >= 0) return none
    this.errT -= dt
    if (this.errT <= 0) {
      this.err = this.rng.range(-this.sk.err, this.sk.err)
      this.errT = 0.5
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
