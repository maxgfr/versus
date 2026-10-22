import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Aim,
  canThrow,
  originX,
  pathOf,
  type State,
  type Stalk,
  THROW_Y,
  valueOf,
} from './rules.ts'

/**
 * The computer's swipe. When its arm is ready it waits a reaction delay, then
 * weighs a handful of throws with the real flight rules (`pathOf`): which
 * stalks each would cut, how soon, and whether a shuriken already in the air
 * gets there first. Harder levels look at more throws, flick harder (pierce
 * two stalks in a row) and shake less; every level sometimes swipes wide.
 */

interface Level {
  react: number
  /** Aim error (rad, ±). */
  err: number
  /** Chance of a wild swipe. */
  miss: number
  /** Throws it considers per swipe. */
  looks: number
  /** Flick power range. */
  power: [number, number]
}

const LEVEL: Record<Difficulty, Level> = {
  easy: { react: 1.4, err: 0.1, miss: 0.25, looks: 3, power: [0.25, 0.6] },
  normal: { react: 0.65, err: 0.04, miss: 0.07, looks: 20, power: [0.5, 0.9] },
  hard: { react: 0.38, err: 0.015, miss: 0.02, looks: 48, power: [0.82, 1] },
}

export class Bot {
  /** Seconds to wait before the next swipe; null while the arm is recovering. */
  private think: number | null = null

  constructor(
    private readonly d: Difficulty,
    private readonly rng: Rng,
  ) {}

  /** Returns the swipe on the step the bot throws, else null. */
  tick(s: State, side: Side, dt: number): Aim | null {
    const lv = LEVEL[this.d]
    if (!canThrow(s, side)) {
      this.think = null
      return null
    }
    if (this.think === null) this.think = lv.react * this.rng.range(0.75, 1.3)
    this.think -= dt
    if (this.think > 0) return null
    const aim = this.pick(s, side, lv)
    if (!aim) {
      this.think = 0.2
      return null
    }
    this.think = null
    const wide = this.rng.chance(lv.miss)
    const e = wide ? this.rng.range(-0.4, 0.4) : this.rng.range(-lv.err, lv.err)
    return {
      x: aim.x,
      dx: aim.dx * Math.cos(e) - aim.dy * Math.sin(e),
      dy: aim.dx * Math.sin(e) + aim.dy * Math.cos(e),
      power: aim.power ?? 0.5,
    }
  }

  /** The best of `looks` candidate throws, by points it would cut and how soon. */
  private pick(s: State, side: Side, lv: Level): Aim | null {
    const ty = THROW_Y[side] ?? 0
    const claimed = this.claimed(s)
    let best: Aim | null = null
    let bv = 0
    for (let i = 0; i < lv.looks; i++) {
      const st = s.stalks[this.rng.int(0, s.stalks.length - 1)]
      if (!st) continue
      // Stand somewhere along the line; harder bots also try lining up two stalks.
      const x = originX(st.x + this.rng.range(-260, 260))
      const len = Math.hypot(st.x - x, st.y - ty) || 1
      const power = this.rng.range(lv.power[0], lv.power[1])
      const aim: Aim = { x, dx: (st.x - x) / len, dy: (st.y - ty) / len, power }
      const path = pathOf(s, side, aim)
      let v = 0
      for (const c of path.cut) {
        // Someone's shuriken is already on its way there: not worth racing it.
        if (claimed.has(c)) continue
        v += valueOf(c)
      }
      v /= 1 + path.eta
      if (v > bv) {
        bv = v
        best = aim
      }
    }
    return best
  }

  /** Stalks a shuriken already in flight will reach. */
  private claimed(s: State): Set<Stalk> {
    const out = new Set<Stalk>()
    for (const sh of s.shuris) {
      const piercing = (sh.pierce ?? 0) > 0
      const path = pathOf(
        s,
        sh.side,
        { x: sh.x, dx: sh.dx, dy: sh.dy, power: piercing ? 1 : 0.5 },
        sh,
      )
      for (const c of path.cut) out.add(c)
    }
    return out
  }
}
