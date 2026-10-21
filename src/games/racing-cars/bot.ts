import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Car, type Drive, type Pt, sampleAt, type Track } from './rules.ts'

interface Skill {
  /** Cruising speed the computer aims for (fraction of the top speed). */
  pace: number
  /** How much it eases off for a bend it can see ahead (0..1). */
  corner: number
  /** Look-ahead on the spline, added to the speed-based distance (units). */
  look: number
  /** Steering wobble (rad). */
  wobble: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { pace: 0.84, corner: 0.42, look: 60, wobble: 0.08 },
  normal: { pace: 0.93, corner: 0.3, look: 90, wobble: 0.03 },
  hard: { pace: 1, corner: 0.2, look: 120, wobble: 0 },
}

/**
 * The computer driver for one car. It follows the track spline: it steers at a
 * point a little way ahead on the centre line (more of it at speed), and its
 * speed control eases off for the sharpest bend it can see in the next stretch.
 */
export class RaceBot {
  private wob = 0

  constructor(
    private rng: Rng,
    private sk: Skill,
  ) {}

  static of(rng: Rng, d: Difficulty): RaceBot {
    return new RaceBot(rng, SKILL[d])
  }

  drive(c: Car, tr: Track, speed: number, dt: number): Drive {
    const ahead = this.sk.look + speed * 0.42
    const at = (arc: number): Pt => tr.pts[sampleAt(tr, arc)] as Pt
    const target = at(c.arc + ahead)
    this.wob += (this.rng.range(-1, 1) - this.wob) * Math.min(1, dt * 2)
    const aim = Math.atan2(target.y - c.y, target.x - c.x) + this.wob * this.sk.wobble
    // Sharpest bend in the next stretch (samples along the centre line).
    let bend = 0
    for (let k = 0; k <= 8; k++) {
      const i = sampleAt(tr, c.arc + 40 + k * 25)
      bend = Math.max(bend, tr.kap[i] ?? 0)
    }
    const mul = this.sk.pace * (1 - this.sk.corner * bend)
    return { jx: Math.cos(aim), jy: Math.sin(aim), m: 1, mul }
  }
}
