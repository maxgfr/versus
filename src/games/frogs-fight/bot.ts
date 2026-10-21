import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  available,
  COLS,
  padCol,
  padIdx,
  padRow,
  airborne,
  type Frog,
  hopsFor,
  inPond,
  REACH,
  ROWS,
  type World,
} from './rules.ts'

interface Skill {
  /** Seconds between two hops, drawn from this range. */
  react: [number, number]
  /** Random spread added to every option's score. */
  noise: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: [1.1, 1.9], noise: 4 },
  normal: { react: [0.6, 1.0], noise: 1.5 },
  hard: { react: [0.35, 0.6], noise: 0 },
}

const sgn = (n: number): number => Math.sign(n)

/**
 * One computer frog: looks at every pad it can reach, and prefers hops that
 * knock the rival into the pond, keep it out of the rival's reach, or keep it
 * off the rim. Bots run on the host only, so none of this is in the snapshot.
 */
export class FrogBot {
  private sk: Skill
  private wait: number

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
    this.wait = this.rng.range(this.sk.react[0], this.sk.react[1])
  }

  /** The pad to hop to this step, or undefined to wait. */
  decide(w: World, me: Frog, dt: number): number | undefined {
    const foe = w.frogs.find((f) => f.side !== me.side)
    if (!foe || foe.fellT >= 0 || me.fellT >= 0) return undefined
    this.wait -= dt
    if (this.wait > 0 || airborne(w, me)) return undefined
    const opts = hopsFor(w, me)
    if (opts.length === 0) return undefined
    const fc = padCol(foe.pad)
    const fr = padRow(foe.pad)
    let pick: number | undefined
    let best = -Infinity
    for (const t of opts) {
      const s = this.score(w, me, foe, t, fc, fr) + this.rng.range(-this.sk.noise, this.sk.noise)
      if (s > best) {
        best = s
        pick = t
      }
    }
    this.wait = this.rng.range(this.sk.react[0], this.sk.react[1])
    return pick
  }

  private score(w: World, me: Frog, foe: Frog, t: number, fc: number, fr: number): number {
    const tc = padCol(t)
    const tr = padRow(t)
    const gap = Math.max(Math.abs(tc - fc), Math.abs(tr - fr))
    let s = 0
    if (t === foe.pad) {
      // A hop onto the rival: it goes off the pad if there is no pad behind it.
      const pc = fc + sgn(tc - padCol(me.pad))
      const pr = fr + sgn(tr - padRow(me.pad))
      s += !inPond(pc, pr) || !available(w, padIdx(pc, pr)) ? 100 : 6
    } else if (gap <= REACH) {
      // The rival can hop onto this pad next turn and push us: is there a pad behind us?
      const pc = tc + sgn(tc - fc)
      const pr = tr + sgn(tr - fr)
      s += !inPond(pc, pr) || !available(w, padIdx(pc, pr)) ? -60 : -5
      // And can we push it next turn? Then it is in our reach with no pad behind it.
      const qc = fc + sgn(fc - tc)
      const qr = fr + sgn(fr - tr)
      if (!inPond(qc, qr) || !available(w, padIdx(qc, qr))) s += 40
    } else s += 2
    // The rim is where a push ends the round.
    if (tc === 0 || tc === COLS - 1 || tr === 0 || tr === ROWS - 1) s -= 1.5
    return s
  }
}
