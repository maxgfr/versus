import { BaseGame, type MatchSpec, type Side, STEP } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { approach, clamp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { DanceBot, RAMP } from './bot.ts'
import { type DiscoOpts, type Ghost, LANE_COL, renderDisco } from './render.ts'
import {
  BEAT,
  DURATION,
  expire,
  GOOD,
  laneAt,
  LANE_X,
  LANES,
  PAD_Y,
  PERFECT,
  press,
  winnerOf,
  worldNew,
  type State as Rules,
} from './rules.ts'

/** Seconds the music plays: the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: DURATION, min: 20, max: 120, step: 10 }

export interface State extends Rules {
  /** Game time the music stopped (-1 while dancing). */
  endAt: number
}

/** What happened this step, turned into juice by `juice`. */
type Event =
  | { kind: 'hit'; side: Side; lane: number; j: 'perfect' | 'good'; err: number; combo: number }
  | { kind: 'whiff'; side: Side; lane: number; lost: number }
  | { kind: 'miss'; side: Side; n: number; lost: number }

/** Dance moves per lane in the dancer's own layout: left, down, up, right. */
const MOVE: readonly { lean: number; hop: number; sq: number }[] = [
  { lean: -1, hop: 0.3, sq: 0 },
  { lean: 0, hop: -0.2, sq: 1 },
  { lean: 0, hop: 1, sq: -0.6 },
  { lean: 1, hop: 0.3, sq: 0 },
]

/** What `render` last saw of a dancer. */
interface Seen {
  lanes: number[]
  misses: number
  whiffs: number
  score: number
}

const padSprings = (): Spring[] => Array.from({ length: LANES }, () => new Spring(1, 520, 16))

class DiscoBattle extends BaseGame<State> {
  private bots: [DanceBot | null, DanceBot | null] = [null, null]
  /** Last beat ticked (sound only). */
  private beatNo = -1
  /** The "Faster!" cue has played (sound and fx only). */
  private cued = false
  // Cosmetic only (not synced, reset in restore): springs, rolling score, hit ghosts.
  private pads: [Spring[], Spring[]] = [padSprings(), padSprings()]
  private lean: [Spring, Spring] = [new Spring(0, 160, 9), new Spring(0, 160, 9)]
  private hop: [Spring, Spring] = [new Spring(0, 260, 11), new Spring(0, 260, 11)]
  private squash: [Spring, Spring] = [new Spring(1, 380, 12), new Spring(1, 380, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 240, 11), new Spring(0, 240, 11)]
  private shown: [number, number] = [0, 0]
  private ghosts: Ghost[] = []
  private lastT = -1
  /** Last state seen by `render`, to kick springs on change (host and guest alike). */
  private seen: [Seen | null, Seen | null] = [null, null]
  private look: DiscoOpts = {
    names: ['', ''],
    endAt: -1,
    winner: null,
    bots: [false, false],
    total: DURATION,
    pads: [
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ],
    lean: [0, 0],
    hop: [0, 0],
    squash: [1, 1],
    pulse: [0, 0],
    shown: [0, 0],
    ghosts: this.ghosts,
  }

  /** Seconds the music plays. */
  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new DanceBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [DanceBot | null, DanceBot | null]
    this.look.names = ctx.names
    this.look.bots = ctx.bots
    // The difficulty setting is the computer's: two humans always get the full build-up.
    const ramp = ctx.bots[0] || ctx.bots[1] ? RAMP[ctx.difficulty] : 1
    return { ...worldNew(ctx.rng, this.total, ramp), endAt: -1 }
  }

  protected step(_dt: number): void {
    const s = this.s
    const { ctx } = this
    const now = this.time
    const beat = Math.floor(now / BEAT + 1e-6)
    if (beat !== this.beatNo) {
      this.beatNo = beat
      if (beat % 4 === 0) ctx.audio.play('click', 1.15)
      else ctx.audio.play('tick', 1)
    }
    for (const side of [0, 1] as Side[]) {
      const d = s.p[side]
      const before = d.combo
      const missed = expire(d, now)
      if (missed) this.juice({ kind: 'miss', side, n: missed, lost: before })
      const bot = this.bots[side]
      if (bot) {
        for (const lane of bot.step(now, d)) this.hitLane(side, lane)
        continue
      }
      for (const p of ctx.input.player(side).downs) {
        const lane = laneAt(side, p.x, p.y)
        if (lane !== null) this.hitLane(side, lane)
        else tapRipple(ctx, side, p.x, p.y)
      }
    }
    // Two thirds in, the chart is visibly heating up: call it out.
    if (!this.cued && now >= this.total * 0.62) {
      this.cued = true
      for (const side of [0, 1] as Side[]) {
        const at = frame(side, 500, PAD_Y - 380)
        ctx.fx.float('Faster!', at.x, at.y, C.orange, 72, side)
      }
      ctx.fx.flash(C.purple, 0.12)
      ctx.audio.play('whoosh', 1.2)
    }
    if (now >= this.total) this.end()
  }

  /** A press in `lane` on a side's pads (the bots call this too). */
  private hitLane(side: Side, lane: number): void {
    const d = this.s.p[side]
    const combo = d.combo
    const j = press(d, lane, this.time)
    if (j) this.juice({ kind: 'hit', side, lane, j, err: d.err, combo: d.combo })
    else this.juice({ kind: 'whiff', side, lane, lost: combo - d.combo })
  }

  /** Every hit, whiff and miss becomes feedback here, scaled by how clean the timing was. */
  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const side = e.side
    if (e.kind === 'hit') {
      // k: 1 dead on the beat, 0 at the edge of the window. heat: how hot the combo is.
      const k = clamp(1 - Math.abs(e.err) / GOOD, 0, 1)
      const heat = Math.min(1, e.combo / 30)
      const pad = frame(side, LANE_X[e.lane] as number, PAD_Y)
      const col = LANE_COL[e.lane] as string
      const perfect = e.j === 'perfect'
      fx.burst(pad.x, pad.y, col, {
        count: Math.round(6 + k * 12 + heat * 8),
        speed: 260 + k * 320 + heat * 200,
        size: 7 + k * 4,
        life: 0.4,
        kind: 'spark',
        colors: perfect ? [col, C.white, C.yellow] : [col, C.white],
      })
      fx.ring(pad.x, pad.y, perfect ? C.yellow : col, 100 + k * 70 + heat * 40)
      if (perfect) audio.play('score', 1 + Math.min(e.combo, 30) * 0.012)
      else audio.play('pop', 0.9 + k * 0.2 + e.lane * 0.04)
      if (perfect) audio.buzz(Math.round(5 + heat * 10))
      if (perfect && heat > 0.5) fx.shake(0.03 + heat * 0.05)
      if (e.combo > 0 && e.combo % 10 === 0 && e.combo <= 30) {
        // A new multiplier: a big moment, but no hit-stop (it would knock the beat off).
        const mult = 1 + Math.min(3, Math.floor(e.combo / 10))
        const mid = frame(side, 500, PAD_Y - 380)
        fx.float(`x${mult}!`, mid.x, mid.y, C.yellow, 96, side)
        fx.flash(SIDE[side].light, 0.16 + mult * 0.03)
        fx.shake(0.12 + mult * 0.05)
        fx.ring(mid.x, mid.y, C.yellow, 220 + mult * 40)
        fx.burst(mid.x, mid.y, C.yellow, {
          count: 14 + mult * 6,
          speed: 620,
          size: 12,
          life: 0.7,
          gravity: 0,
          drag: 2.4,
          kind: 'square',
          colors: [C.yellow, C.white, SIDE[side].light],
        })
        audio.play('powerup', 1 + mult * 0.08)
        audio.buzz(24)
      }
    } else if (e.kind === 'whiff') {
      // A tap with nothing to hit: a soft thud; costs the combo (bigger loss, bigger sting).
      const pad = frame(side, LANE_X[e.lane] as number, PAD_Y)
      fx.puff(pad.x, pad.y, alpha(C.white, 0.25), 3)
      if (e.lost > 0) this.comboLost(side, e.lost)
      else audio.play('tap', 0.8)
    } else {
      const at = frame(side, 500, PAD_Y)
      fx.puff(at.x, at.y, alpha(C.white, 0.3), 3 + Math.min(4, e.n))
      if (e.lost > 0) this.comboLost(side, e.lost)
      else audio.play('error', 0.9)
    }
  }

  /** The combo just broke: losing a big one hurts more. */
  private comboLost(side: Side, lost: number): void {
    const { fx, audio } = this.ctx
    const k = Math.min(1, lost / 30)
    audio.play('error', 0.95 - k * 0.2)
    if (lost >= 10) {
      const at = frame(side, 500, PAD_Y - 380)
      fx.shake(0.1 + k * 0.15)
      fx.float('Combo lost', at.x, at.y, C.redLight, 52, side)
      audio.buzz(18 + Math.round(k * 20))
    }
  }

  /** The music stops: the winner gets the spotlight, then the result screen. */
  private end(): void {
    const s = this.s
    const { fx, audio } = this.ctx
    s.endAt = this.time
    const w = winnerOf(s)
    fx.flash(C.white, 0.35)
    fx.shake(0.4)
    fx.stop(8)
    audio.play('buzz', 0.8)
    audio.buzz(40)
    if (w !== 'draw') {
      const p = frame(w, 500, 1640)
      fx.ring(p.x, p.y, SIDE[w].light, 320)
      fx.burst(p.x, p.y, C.yellow, {
        count: 40,
        speed: 900,
        size: 13,
        life: 0.9,
        kind: 'spark',
        colors: [C.yellow, C.white, SIDE[w].light],
      })
      fx.burst(p.x, p.y, SIDE[w].main, {
        count: 30,
        speed: 1000,
        size: 15,
        life: 1.1,
        gravity: 0,
        drag: 2.2,
        spread: Math.PI,
        dir: w === 0 ? -Math.PI / 2 : Math.PI / 2,
        kind: 'square',
        colors: [SIDE[w].main, SIDE[w].light, C.yellow, C.white],
      })
      floatFor(fx, w, 'Dance king!')
    }
    fx.confetti(w === 'draw' ? undefined : w)
    const tie = w !== 'draw' && s.p[0].score === s.p[1].score
    const note = tie ? 'Same score: the cleaner dance wins' : undefined
    this.finish(w, { score: [s.p[0].score, s.p[1].score], delay: 2.4, ...(note ? { note } : {}) })
  }

  /**
   * Kick the cosmetic springs from what changed in the state since the last
   * frame, so the online guest (which only renders) dances exactly like the host.
   */
  private track(side: Side): void {
    const d = this.s.p[side]
    const seen = this.seen[side]
    if (!seen) {
      this.seen[side] = { lanes: [...d.laneAt], misses: d.misses, whiffs: d.whiffs, score: d.score }
      return
    }
    for (let lane = 0; lane < LANES; lane++) {
      const at = d.laneAt[lane] as number
      if (at === seen.lanes[lane]) continue
      seen.lanes[lane] = at
      // k: 1 dead on the beat, 0 at the edge of the window. heat: how hot the combo is.
      const k = clamp(1 - Math.abs(d.err) / GOOD, 0, 1)
      const heat = Math.min(1, d.combo / 30)
      const mv = MOVE[lane] as (typeof MOVE)[number]
      const amp = 0.6 + k * 0.4 + heat * 0.3
      this.pads[side][lane]?.kick(-4 - k * 6)
      this.lean[side].kick(mv.lean * 9 * amp)
      this.hop[side].kick(mv.hop * 9 * amp)
      this.squash[side].kick(mv.sq * 3 * amp - 1.2 * k)
      this.ghosts.push({ side, lane, at, perfect: Math.abs(d.err) <= PERFECT, k })
      if (this.ghosts.length > 16) this.ghosts.shift()
    }
    if (d.score !== seen.score) {
      const gain = d.score - seen.score
      seen.score = d.score
      this.pulse[side].kick(Math.min(16, 3 + gain / 40))
    }
    if (d.misses !== seen.misses) {
      seen.misses = d.misses
      this.lean[side].kick(4)
      this.squash[side].kick(2)
      this.hop[side].kick(-4)
    }
    if (d.whiffs !== seen.whiffs) {
      seen.whiffs = d.whiffs
      this.squash[side].kick(1)
    }
  }

  render(g: Draw, a: number): void {
    // Real frame time for the springs; the clock is interpolated so arrows glide.
    const dt = this.lastT < 0 ? 0 : clamp(g.t - this.lastT, 0, 0.05)
    this.lastT = g.t
    const now = this.over ? this.time : this.time - (1 - a) * STEP
    const look = this.look
    for (const side of [0, 1] as Side[]) {
      this.track(side)
      const pads = look.pads[side]
      this.pads[side].forEach((p, i) => (pads[i] = p.update(dt)))
      look.lean[side] = this.lean[side].update(dt)
      look.hop[side] = this.hop[side].update(dt)
      look.squash[side] = this.squash[side].update(dt)
      look.pulse[side] = Math.max(0, this.pulse[side].update(dt) / 14)
      const score = this.s.p[side].score
      const sh = this.shown[side]
      this.shown[side] = Math.abs(score - sh) < 1 ? score : approach(sh, score, 12, dt)
      look.shown[side] = Math.round(this.shown[side])
    }
    while (this.ghosts.length && (this.ghosts[0] as Ghost).at < now - 0.4) this.ghosts.shift()
    look.endAt = this.s.endAt
    look.winner = this.s.endAt >= 0 ? winnerOf(this.s) : null
    look.total = this.total
    renderDisco(g, this.s, now, look)
  }

  override restore(snap: unknown): void {
    const t = this.time
    super.restore(snap)
    // Snapshots stream in continuously online; only a jump back in time (a
    // fresh game) drops the cosmetic memory.
    if (this.time < t - 1) {
      this.seen = [null, null]
      this.ghosts.length = 0
      this.shown = [this.s.p[0].score, this.s.p[1].score]
    }
  }
}

export default () => new DiscoBattle()
