import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  angleDiff,
  BRAKE,
  type Car,
  type Drive,
  type Pt,
  sampleAt,
  TOP,
  type Track,
  TURN,
} from './rules.ts'

interface Skill {
  /** Cruising speed the computer allows itself (fraction of the top speed). */
  pace: number
  /** Share of the fastest speed a bend allows that it dares to carry (<1 = cautious). */
  nerve: number
  /** Braking it relies on (fraction of the real brakes): low = brakes late and runs wide. */
  brake: number
  /** Look-ahead on the spline, added to the speed-based distance (units). */
  look: number
  /** Steering wobble (rad). */
  wobble: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { pace: 0.84, nerve: 0.8, brake: 0.6, look: 60, wobble: 0.1 },
  normal: { pace: 0.95, nerve: 1, brake: 0.85, look: 85, wobble: 0.03 },
  hard: { pace: 1, nerve: 1.08, brake: 0.95, look: 100, wobble: 0 },
}

/** How sharply the road turns at sample i (radians per unit), measured over a few samples. */
function bendAt(tr: Track, i: number): number {
  const n = tr.n
  const a = (i - 3 + n) % n
  const b = (i + 3) % n
  let span = (tr.cum[b] ?? 0) - (tr.cum[a] ?? 0)
  if (span <= 0) span += tr.len
  return Math.abs(angleDiff(tr.hd[a] ?? 0, tr.hd[b] ?? 0)) / Math.max(1, span)
}

/**
 * Fastest speed at which the car can still turn as sharply as `k` (rad/unit):
 * its turn rate grows with speed, TURN * (0.45 + 0.55 v / TOP), and must reach v k.
 */
export function bendSpeed(k: number): number {
  const lin = (TURN * 0.55) / TOP
  if (k <= lin) return Infinity
  return (TURN * 0.45) / (k - lin)
}

/**
 * The computer driver for one car. It steers at a point a little way ahead on
 * the centre line (further at speed) and plans its speed like a driver: every
 * bend in braking distance caps how fast it may go now, so it brakes before
 * the corner instead of in it. Skill sets how much of that limit it dares use.
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
    const sk = this.sk
    const ahead = sk.look + speed * 0.42
    const at = (arc: number): Pt => tr.pts[sampleAt(tr, arc)] as Pt
    const target = at(c.arc + ahead)
    this.wob += (this.rng.range(-1, 1) - this.wob) * Math.min(1, dt * 2)
    const aim = Math.atan2(target.y - c.y, target.x - c.x) + this.wob * sk.wobble
    // Speed plan: the slowest of "what each bend ahead allows, plus what I can shed before it".
    const brake = BRAKE * sk.brake
    const reach = (speed * speed) / (2 * brake) + 80
    let want = TOP * sk.pace
    for (let d = 0; d <= reach; d += 20) {
      const vb = bendSpeed(bendAt(tr, sampleAt(tr, c.arc + d))) * sk.nerve
      if (vb === Infinity) continue
      want = Math.min(want, Math.sqrt(vb * vb + 2 * brake * d))
    }
    const mul = Math.max(0.35, Math.min(sk.pace, want / TOP))
    return { jx: Math.cos(aim), jy: Math.sin(aim), m: 1, mul }
  }
}
