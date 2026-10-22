import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  COLS,
  type Ev,
  type Frog,
  hopsFor,
  padCol,
  padDist,
  padRow,
  REACH,
  ROWS,
  shoveDest,
  stepWorld,
  type World,
} from './rules.ts'

interface Skill {
  /** Seconds between two hops, drawn from this range. */
  react: [number, number]
  /** Random spread added to every option's score. */
  noise: number
  /** How much it fears a lethal shove next turn (0..1). */
  care: number
  /** How much it values setting up a lethal shove (0..1). */
  greed: number
  /** Chance to see an incoming leap and hop away, and how fast. */
  dodge: number
  dodgeT: [number, number]
}

const SKILL: Record<Difficulty, Skill> = {
  easy: {
    react: [0.95, 1.7],
    noise: 7,
    care: 0.25,
    greed: 0.35,
    dodge: 0.2,
    dodgeT: [0.28, 0.45],
  },
  normal: {
    react: [0.55, 0.95],
    noise: 2.5,
    care: 0.7,
    greed: 0.8,
    dodge: 0.5,
    dodgeT: [0.17, 0.3],
  },
  hard: { react: [0.3, 0.55], noise: 0.4, care: 1, greed: 1, dodge: 0.8, dodgeT: [0.1, 0.22] },
}

const clone = (w: World): World => JSON.parse(JSON.stringify(w)) as World

/**
 * One computer frog. For every pad it can reach it plays the hop out with the
 * real rules (until it lands, shove included) and scores where that leaves
 * both frogs: can the rival shove it into the pond next, can it threaten a
 * lethal shove itself, how many pads it keeps in reach. It also watches the
 * rival's leaps and hops away from one aimed at its pad. Bots run on the host
 * only, so none of this is in the snapshot.
 */
export class FrogBot {
  private sk: Skill
  private wait: number
  /** The rival leap (its take-off time) already judged for a dodge. */
  private seen = -99
  private dodgeIn = -1

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
    // A rival leap coming down on our pad: maybe hop out of the way.
    const incoming = foe.air && !foe.shoved && foe.pad === me.pad
    if (incoming && foe.hopT !== this.seen) {
      this.seen = foe.hopT
      this.dodgeIn = this.rng.chance(this.sk.dodge)
        ? this.rng.range(this.sk.dodgeT[0], this.sk.dodgeT[1])
        : -1
    }
    let dodging = false
    if (incoming && this.dodgeIn >= 0) {
      this.dodgeIn -= dt
      dodging = this.dodgeIn <= 0
    }
    if (me.air || (!dodging && this.wait > 0)) return undefined
    const opts = hopsFor(w, me)
    if (opts.length === 0) return undefined
    let pick: number | undefined
    let best = -Infinity
    for (const t of opts) {
      if (dodging && t === foe.pad) continue
      const s = this.score(w, me, t) + this.rng.range(-this.sk.noise, this.sk.noise)
      if (s > best) {
        best = s
        pick = t
      }
    }
    this.wait = this.rng.range(this.sk.react[0], this.sk.react[1])
    this.dodgeIn = -1
    return pick
  }

  /** Play the hop out with the real rules, then judge the position it leaves. */
  score(w: World, me: Frog, t: number): number {
    const c = clone(w)
    const taps: (number | undefined)[] = []
    taps[me.id] = t
    const ev: Ev[] = []
    const m = c.frogs.find((f) => f.id === me.id) as Frog
    const foe = c.frogs.find((f) => f.id !== me.id) as Frog
    stepWorld(c, taps, 1 / 60, ev)
    for (let i = 0; i < 40 && (m.air || foe.air) && m.fellT < 0 && foe.fellT < 0; i++)
      stepWorld(c, [], 1 / 60, ev)
    if (m.fellT >= 0 && foe.fellT >= 0) return -200
    if (m.fellT >= 0) return -1000
    if (foe.fellT >= 0) return 1000
    return this.position(c, m, foe)
  }

  private position(w: World, me: Frog, foe: Frog): number {
    let s = 0
    const mine = hopsFor(w, me)
    if (mine.length === 0) return -400
    s += Math.min(mine.length, 8) * 0.7
    // The rival's next leap onto us: does it send us into the pond?
    if (padDist(foe.pad, me.pad) <= REACH)
      s -= shoveDest(w, foe.pad, me.pad) < 0 ? 60 * this.sk.care : 5 * this.sk.care
    // Our next leap onto it: would that one be lethal?
    if (padDist(me.pad, foe.pad) <= REACH && shoveDest(w, me.pad, foe.pad) < 0)
      s += 35 * this.sk.greed
    // Fewer pads left for the rival is good.
    s += (8 - Math.min(hopsFor(w, foe).length, 8)) * 0.6 * this.sk.greed
    // The rim is where a shove ends the round.
    const c = padCol(me.pad)
    const r = padRow(me.pad)
    if (c === 0 || c === COLS - 1) s -= 2
    if (r === 0 || r === ROWS - 1) s -= 2
    s -= Math.abs(c - (COLS - 1) / 2) * 0.4
    return s
  }
}
