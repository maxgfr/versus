import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  COLS,
  type Ev,
  type Frog,
  HOP_T,
  hopsFor,
  inPond,
  LEAP_T,
  landsAt,
  padCol,
  padDist,
  padIdx,
  padRow,
  REACH,
  rimDist,
  ROWS,
  shoveDest,
  sinkAt,
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
  /** How much it values setting up a lethal shove and boxing the rival in (0..1). */
  greed: number
  /** Chance to see an incoming leap and hop away, and how fast (human reaction times). */
  dodge: number
  dodgeT: [number, number]
  /** Weight of territory: pads it can reach before the rival can. */
  terr: number
  /** Most decisions in a row it may sit still when every hop is worse than staying. */
  stay: number
  /** Pull toward the centre as the pond weakens and shrinks from the rim. */
  late: number
  /**
   * Chance to pounce: seeing the rival leap to a pad it could be shoved off
   * from, leap there to come down just after it, leaving it no time to react.
   */
  pounce: number
}

const SKILL: Record<Difficulty, Skill> = {
  // Slow, distracted, rarely dodges: a frog for kids and first-timers.
  easy: {
    react: [1.0, 1.8],
    noise: 8,
    care: 0.2,
    greed: 0.3,
    dodge: 0.15,
    dodgeT: [0.3, 0.48],
    terr: 0,
    stay: 0,
    late: 0,
    pounce: 0,
  },
  // Quick and sensible: claims the pads around it, boxes you in, dodges most leaps.
  normal: {
    react: [0.42, 0.7],
    noise: 1.2,
    care: 0.9,
    greed: 0.9,
    dodge: 0.75,
    dodgeT: [0.15, 0.25],
    terr: 3,
    stay: 1,
    late: 4,
    pounce: 0.3,
  },
  // Fights for territory, lets you wear out your own pads, heads for the
  // middle before the rim goes, times its leaps to land just after yours and
  // dodges at a sharp human's speed.
  hard: {
    react: [0.26, 0.45],
    noise: 0.15,
    care: 1,
    greed: 1,
    dodge: 0.92,
    dodgeT: [0.13, 0.21],
    terr: 14,
    stay: 2,
    late: 8,
    pounce: 0.9,
  },
}

const N = COLS * ROWS
/** Pads within a hop of each pad (fixed board geometry). */
const NEAR: number[][] = Array.from({ length: N }, (_, i) => {
  const out: number[] = []
  for (let r = padRow(i) - REACH; r <= padRow(i) + REACH; r++)
    for (let c = padCol(i) - REACH; c <= padCol(i) + REACH; c++)
      if (inPond(c, r) && padIdx(c, r) !== i) out.push(padIdx(c, r))
  return out
})
// Scratch buffers for the territory flood fill (bots run one at a time).
const DA = new Int16Array(N)
const DB = new Int16Array(N)
const QUEUE = new Int16Array(N)

const clone = (w: World): World => JSON.parse(JSON.stringify(w)) as World

/** Hop distances from `start` over pads still afloat (`gone` counts as sunk). */
function flood(w: World, start: number, gone: number, out: Int16Array): void {
  out.fill(99)
  if (start < 0) return
  out[start] = 0
  let head = 0
  let tail = 0
  QUEUE[tail++] = start
  while (head < tail) {
    const i = QUEUE[head++] as number
    const d = (out[i] as number) + 1
    for (const j of NEAR[i] as number[]) {
      if (w.sunk[j] === 1 || j === gone || (out[j] as number) <= d) continue
      out[j] = d
      QUEUE[tail++] = j
    }
  }
}

/** Pads in a hop of `a` that are still afloat. */
function mobility(w: World, a: number, gone: number): number {
  let n = 0
  for (const j of NEAR[a] as number[]) if (w.sunk[j] !== 1 && j !== gone) n++
  return n
}

/**
 * One computer frog. For every pad it can reach it plays the hop out with the
 * real rules (until it lands, shove included) and scores where that leaves
 * both frogs: lethal shoves either way, pads in reach, territory (pads it gets
 * to first, the way this game is won late in a round) and how close it sits
 * to the rim as the pond shrinks. It watches the rival's leaps and hops away from one aimed
 * at its pad. It only reads the shared board, and bots run on the host only,
 * so none of this is in the snapshot.
 */
export class FrogBot {
  private sk: Skill
  private wait: number
  /** The rival leap (its take-off time) already judged for a dodge. */
  private seen = -99
  private dodgeIn = -1
  private stays = 0
  /** The rival leap (its take-off time) already judged for a pounce. */
  private eyed = -99
  private pouncing = false

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
    if (me.air) return undefined
    const pounce = this.pounce(w, me, foe)
    if (pounce !== undefined) {
      this.wait = this.rng.range(this.sk.react[0], this.sk.react[1])
      return pounce
    }
    if (!dodging && this.wait > 0) return undefined
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
    // Sit tight for a beat when every hop is worse than where it is.
    if (!dodging && this.stays < this.sk.stay && !incoming && !foe.air) {
      const stay = this.still(w, me.pad, foe.pad, -1)
      if (stay > best + 2) {
        this.stays++
        this.wait = this.rng.range(0.15, 0.25)
        return undefined
      }
    }
    this.stays = 0
    this.wait = this.rng.range(this.sk.react[0], this.sk.react[1])
    this.dodgeIn = -1
    return pick
  }

  /**
   * The rival is mid-leap: once it has been seen for a human reaction time,
   * leap onto its landing pad if we would come down at most 0.2 s after it
   * and the shove would put it in the pond.
   */
  private pounce(w: World, me: Frog, foe: Frog): number | undefined {
    if (!foe.air || foe.shoved || foe.pad === me.pad || padDist(me.pad, foe.pad) > REACH) return
    if (foe.hopT !== this.eyed) {
      this.eyed = foe.hopT
      this.pouncing = this.rng.chance(this.sk.pounce)
    }
    if (!this.pouncing || w.t - foe.hopT < 0.15) return
    const gap = w.t + (padDist(me.pad, foe.pad) >= 2 ? LEAP_T : HOP_T) - landsAt(foe)
    if (gap <= 1 / 60 || gap > 0.2) return
    if (this.score(w, me, foe.pad) < 500) return
    this.pouncing = false
    return foe.pad
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
    if (foe.fellT >= 0) {
      // A lethal leap still has to land: the less time the rival has to see
      // it coming (it is mid-hop itself, or the leap is short), the surer it is.
      const myLand = w.t + (padDist(me.pad, t) >= 2 ? LEAP_T : HOP_T)
      const seen = myLand - (foe.air ? Math.max(w.t, landsAt(foe)) : w.t)
      const sure = seen <= 0.15 ? 0.95 : seen <= HOP_T ? 0.75 : 0.5
      return 1000 * sure - 20 * (1 - sure)
    }
    return this.still(c, m.pad, foe.pad, -1)
  }

  /** Static value of me on `a`, the rival on `b`, with `gone` sunk too. */
  private still(w: World, a: number, b: number, gone: number): number {
    const sk = this.sk
    const mine = mobility(w, a, gone)
    if (mine === 0) return -400
    const theirs = mobility(w, b, gone)
    if (theirs === 0) return 300
    let s = Math.min(mine, 8) * 0.7 - Math.min(theirs, 8) * 0.6 * sk.greed
    // Lethal shoves either way next.
    if (padDist(b, a) <= REACH && shoveDest(w, b, a, gone) < 0) s -= 60 * sk.care
    if (padDist(a, b) <= REACH && shoveDest(w, a, b, gone) < 0) s += 35 * sk.greed
    if (sk.terr > 0) {
      // Pads each frog reaches first; a worn pad (one landing from sinking) is worth half.
      flood(w, a, gone, DA)
      flood(w, b, gone, DB)
      const limit = sinkAt(w, w.t + 3)
      let t = 0
      for (let i = 0; i < N; i++) {
        if (w.sunk[i] === 1 || i === gone) continue
        const da = DA[i] as number
        const db = DB[i] as number
        if (da === db) continue
        const v = (w.uses[i] ?? 0) + 1 >= limit ? 0.5 : 1
        t += da < db ? v : -v
      }
      s += t * sk.terr
    }
    // The rim is where a shove ends the round.
    const c = padCol(a)
    const r = padRow(a)
    if (c === 0 || c === COLS - 1) s -= 2
    if (r === 0 || r === ROWS - 1) s -= 2
    s -= Math.abs(c - (COLS - 1) / 2) * 0.4
    // As the pond weakens, the rim is where pads go first.
    const late = Math.min(1, Math.max(0, (w.t - (w.ramp[0] - 4)) / (w.ramp[1] - w.ramp[0] + 4)))
    s -= rimDist(a) * sk.late * late
    return s
  }
}
