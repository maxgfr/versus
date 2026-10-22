import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { angleTo } from '../../engines/arena/index.ts'
import {
  type Drive,
  hazardNear,
  inArena,
  R,
  type Robot,
  SAW,
  ZAP_ARC,
  ZAP_RANGE,
  type World,
} from './rules.ts'

/** Distance from (px, py) to the segment (x0, y0)–(x1, y1). */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2))
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t))
}

interface Skill {
  /** Share of full stick the bot pushes with. */
  pace: number
  /** How far ahead of a moving rival it aims (s). */
  lead: number
  /** Seconds lined up before it zaps. */
  react: number
  /** Max constant aim error (rad). */
  wobble: number
  /** Fraction of the zap arc it accepts as "facing". */
  tol: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { pace: 0.7, lead: 0, react: 0.6, wobble: 0.25, tol: 0.5 },
  normal: { pace: 1, lead: 0.3, react: 0.24, wobble: 0.06, tol: 0.65 },
  hard: { pace: 1, lead: 0.3, react: 0.1, wobble: 0.015, tol: 0.65 },
}

/**
 * One computer robot: drives at its nearest rival, sidesteps walls, the saw
 * and the pits (it looks a little ahead), and zaps once the rival is inside
 * the arc in front of it. Bots run on the host only, so none of this is in the
 * snapshot.
 */
export class RobotBot {
  private sk: Skill
  private wobble: number
  private seeT = 0
  /**
   * The aim error is re-rolled now and then, not only after a zap: two sloppy
   * bots with a fixed offset can spiral round each other without ever facing.
   */
  private rerollT = 1.5

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
    this.wobble = this.rng.range(-this.sk.wobble, this.sk.wobble)
  }

  decide(w: World, me: Robot, dt: number): Drive {
    const foes = w.robots.filter((r) => r.alive && r.side !== me.side)
    if (!me.alive || foes.length === 0) return { jx: 0, jy: 0, zap: false }
    const foe = foes[0] as Robot
    const sk = this.sk
    this.rerollT -= dt
    if (this.rerollT <= 0) {
      this.rerollT = this.rng.range(1.2, 2)
      this.wobble = this.rng.range(-sk.wobble, sk.wobble)
    }
    const ax = foe.x + foe.vx * sk.lead
    const ay = foe.y + foe.vy * sk.lead
    const dist = Math.hypot(foe.x - me.x, foe.y - me.y)
    let want = Math.atan2(ay - me.y, ax - me.x) + this.wobble
    // The saw between us: go round it, red one way and blue the other, so two
    // bots meet instead of chasing each other round the blade for ever.
    if (segDist(SAW.x, SAW.y, me.x, me.y, ax, ay) < SAW.r + R + 24) {
      const sgn = me.side === 0 ? 1 : -1
      const ox = me.x - SAW.x
      const oy = me.y - SAW.y
      want = Math.atan2(sgn * ox, -sgn * oy)
    }

    // Look ahead: the heading closest to the wanted one that stays on the floor and off the hazards.
    let pick = want
    let bestScore = -Infinity
    for (let k = -6; k <= 6; k++) {
      const th = want + k * (Math.PI / 12)
      const px = me.x + Math.cos(th) * 110
      const py = me.y + Math.sin(th) * 110
      const bad = !inArena(px, py, R + 6) || hazardNear(px, py, 16)
      const score = Math.cos(th - want) - (bad ? 3 : 0)
      if (score > bestScore) {
        bestScore = score
        pick = th
      }
    }
    const jx = Math.cos(pick) * sk.pace
    const jy = Math.sin(pick) * sk.pace

    // Zap when the rival is in reach and roughly in front, after a short reaction.
    const toFoe = Math.atan2(foe.y - me.y, foe.x - me.x)
    const inReach = dist < ZAP_RANGE + R
    const facing = Math.abs(angleTo(me.a, toFoe)) < ZAP_ARC * sk.tol
    this.seeT = inReach && facing ? this.seeT + dt : 0
    const zap = this.seeT > sk.react && me.cd <= 0
    if (zap) {
      this.seeT = 0
      this.wobble = this.rng.range(-sk.wobble, sk.wobble)
    }
    return { jx, jy, zap }
  }
}
