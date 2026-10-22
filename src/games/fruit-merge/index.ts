import { BaseGame, type GameContext, type MatchSpec, type Side } from '../../core/game.ts'
import { clamp, lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, shade } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { store, submitRecord } from '../../core/store.ts'
import { HEADER } from '../../engines/puzzle/index.ts'
import {
  type Frame,
  halfFrame,
  inFrame,
  localView,
  mirrorFx,
  toLocal,
  toWorld,
} from '../../engines/runner/frame.ts'
import { chooseX, PACE } from './bot.ts'
import { drawCard, drawHeader, drawJar, FRUIT_COLOR, type Ghost, GLYPH } from './render.ts'
import {
  type Body,
  clampX,
  dangerTime,
  decided,
  drop,
  geometry,
  type Geo,
  type Jar,
  KINDS,
  kindSequence,
  type Merge,
  newJar,
  radius,
  TIME_LIMIT,
  tick,
} from './rules.ts'

/** One jar and the fruit in hand. */
export interface Well {
  jar: Jar
  /** Drop x in panel-local units, following the finger. */
  aim: number
  /** Kind in hand, and its place in the shared sequence. */
  next: number
  seq: number
  /** Seconds until the next drop is allowed. */
  cool: number
  /** Game time the jar ended, or -1 while it is still playing. */
  overAt: number
  /** Game time of the last drop (the claw reloads) and of the last score. */
  dropAt: number
  scoreAt: number
}

export interface State {
  wells: [Well, Well]
  botT: [number, number]
  /** Game time the game ended (the verdict cards pop), or -1. */
  endAt: number
  /** The winner once it ended. */
  winner: Side | 'draw' | null
}

/** A timed match: the players choose its length (the clock runs for it). */
export const match: MatchSpec = {
  unit: 'seconds',
  default: TIME_LIMIT,
  min: 30,
  max: 300,
  step: 30,
}

const RECORD = 'fruit-merge'
const DROP_COOL = 0.22
/** Finger speeds (local units/s) below these drop the fruit straight: aiming stays precise. */
const FLICK_X = 320
const FLICK_Y = 520
/** Share of the finger's speed a flick gives the fruit. */
const THROW = 0.5
/** Merges closer than this (s) build a chain: rising pitch and a combo tag. */
const CHAIN = 0.75

/** The finger aiming a jar, followed for its speed (host only: it is input). */
interface Finger {
  id: number
  lx: number
  ly: number
  vx: number
  vy: number
}

class FruitMerge extends BaseGame<State> {
  private solo = false
  private frames!: [Frame, Frame]
  // Derived from the seed on both phones: never sent over the wire.
  private seq: number[] = []
  /** The finger aiming each jar (only the host steps, so this stays local). */
  private ptr: [Finger | null, Finger | null] = [null, null]
  /** A release that came during the reload: dropped as soon as the claw is ready. */
  private queued: [[number, number] | null, [number, number] | null] = [null, null]
  /** Cosmetic trackers for sounds (host only). */
  private lastSec = -1
  private warnStep: [number, number] = [0, 0]
  private bounceAt = -10
  private chain: [number, number] = [0, 0]
  private chainAt: [number, number] = [-10, -10]
  // Cosmetic only (not synced): previous positions for interpolation, springs, merge ghosts.
  private prev = new WeakMap<Body, [number, number, number]>()
  private prevAim: [number, number] = [0, 0]
  private lastAim: [number, number] = [NaN, NaN]
  private swing: [Spring, Spring] = [new Spring(0, 150, 6), new Spring(0, 150, 6)]
  private wobble: [Spring, Spring] = [new Spring(0, 420, 11), new Spring(0, 420, 11)]
  private ghosts: Ghost[][] = [[], []]

  /** Match length in seconds, as chosen before the game. */
  /** How long a fruit may rest over the line now: the patience shrinks as the clock runs. */
  private get danger(): number {
    return dangerTime(this.time / this.limit)
  }

  private get limit(): number {
    return this.ctx.target || match.default
  }

  override init(ctx: GameContext): void {
    this.solo = ctx.mode === '1p' && !ctx.bots[1]
    this.frames = [halfFrame(0, ctx.mode, this.solo), halfFrame(1, ctx.mode)]
    mirrorFx(ctx, this.frames)
    super.init(ctx)
  }

  protected setup(): State {
    this.seq = kindSequence(this.ctx.seed)
    const first = this.seq[0] ?? 0
    const well = (side: Side): Well => {
      const g = this.geo(side)
      return {
        jar: newJar(),
        aim: (g.left + g.right) / 2,
        next: first,
        seq: 0,
        cool: 0,
        overAt: -1,
        dropAt: -10,
        scoreAt: -10,
      }
    }
    return { wells: [well(0), well(1)], botT: [0, 0], endAt: -1, winner: null }
  }

  private sides(): Side[] {
    return this.solo ? [0] : [0, 1]
  }

  private geo(side: Side): Geo {
    const f = this.frames[side]
    return geometry(f.w, f.h, this.solo, HEADER)
  }

  protected step(dt: number): void {
    for (const side of this.sides()) {
      const w = this.s.wells[side]
      this.prevAim[side] = w.aim
      for (const b of w.jar.bodies) {
        const p = this.prev.get(b)
        if (p) {
          p[0] = b.x
          p[1] = b.y
          p[2] = b.a
        } else this.prev.set(b, [b.x, b.y, b.a])
      }
      w.cool = Math.max(0, w.cool - dt)
      if (w.overAt < 0) {
        if (this.isBot(side)) this.botDrive(side, dt)
        else this.playerAim(side, dt)
        const q = this.queued[side]
        if (q && w.cool <= 0) {
          this.queued[side] = null
          this.dropFruit(side, q[0], q[1])
        }
      }
      this.advance(side, dt)
    }
    // The last ten seconds tick down out loud.
    const left = Math.ceil(this.limit - this.time)
    if (left !== this.lastSec) {
      this.lastSec = left
      if (left <= 10 && left > 0)
        this.ctx.audio.play(left <= 3 ? 'count' : 'tick', 1 + (10 - left) * 0.04)
    }
    this.settle()
  }

  private botDrive(side: Side, dt: number): void {
    this.s.botT[side] += dt
    const w = this.s.wells[side]
    if (this.s.botT[side] < PACE[this.ctx.difficulty] || w.cool > 0) return
    this.s.botT[side] = 0
    // The fruit after this one is in the Next bubble: players see it too.
    const next = this.seq[(w.seq + 1) % this.seq.length]
    w.aim = chooseX(w.jar, this.geo(side), w.next, this.ctx.difficulty, this.ctx.rng, next)
    this.dropFruit(side)
  }

  /**
   * Drag anywhere over the jar to aim the fruit on the rail; let go to drop.
   * The finger's speed as it lets go throws the fruit: a sideways flick sends
   * it across, a downward flick slams it in. A slow release drops it straight.
   */
  private playerAim(side: Side, dt: number): void {
    const w = this.s.wells[side]
    const f = this.frames[side]
    const geo = this.geo(side)
    const inp = this.ctx.input.player(side)
    let fg = this.ptr[side]
    if (fg === null) {
      const p = inp.downs.find((d) => {
        const l = toLocal(f, d.x, d.y)
        // Anywhere over the jar: the finger aims, the fruit stays on the rail.
        return l.y >= geo.header && l.y <= geo.floor + 60 && l.x >= 0 && l.x <= f.w
      })
      if (!p) return
      const l = toLocal(f, p.x, p.y)
      fg = { id: p.id, lx: l.x, ly: l.y, vx: 0, vy: 0 }
      this.ptr[side] = fg
    }
    const id = fg.id
    const cur = inp.held.get(id) ?? inp.ups.find((u) => u.id === id)
    if (!cur) {
      this.ptr[side] = null
      return
    }
    const l = toLocal(f, cur.x, cur.y)
    // Smoothed finger speed: one jittery step must not throw the fruit.
    fg.vx = lerp(fg.vx, (l.x - fg.lx) / dt, 0.45)
    fg.vy = lerp(fg.vy, (l.y - fg.ly) / dt, 0.45)
    fg.lx = l.x
    fg.ly = l.y
    w.aim = clampX(geo, w.next, l.x)
    if (inp.held.has(id)) return
    this.ptr[side] = null
    const vx = Math.abs(fg.vx) > FLICK_X ? fg.vx * THROW : 0
    const vy = fg.vy > FLICK_Y ? fg.vy * THROW : 0
    // Released while the claw reloads: the drop waits for it instead of being lost.
    if (w.cool > 0) this.queued[side] = [vx, vy]
    else this.dropFruit(side, vx, vy)
  }

  private dropFruit(side: Side, vx = 0, vy = 0): void {
    const w = this.s.wells[side]
    if (w.cool > 0 || w.overAt >= 0) return
    const geo = this.geo(side)
    drop(w.jar, geo, w.aim, w.next, this.time, vx, vy)
    w.cool = DROP_COOL
    w.dropAt = this.time
    w.seq++
    w.next = this.seq[w.seq % this.seq.length] ?? 0
    // The fruit in hand changed size: keep it inside the walls.
    w.aim = clampX(geo, w.next, w.aim)
    const k = Math.min(1, Math.hypot(vx, vy) / 900)
    this.ctx.audio.play(k > 0.25 ? 'whoosh' : 'swish', 1.1 - w.next * 0.03 + k * 0.3)
    this.swing[side].kick(vx * -0.004)
    if (k > 0.25) this.ctx.audio.buzz(6 + Math.round(k * 8))
  }

  /** Physics for one jar, and the juice for what it did this step. */
  private advance(side: Side, dt: number): void {
    const w = this.s.wells[side]
    if (w.overAt >= 0) return
    const res = tick(w.jar, this.geo(side), dt, this.time, this.danger)
    if (res.merges.length) w.scoreAt = this.time
    for (const m of res.merges) this.juiceMerge(side, m)
    // A fruit lingering over the line: a warning beep every half second.
    let worst = 0
    for (const b of w.jar.bodies) worst = Math.max(worst, b.hi)
    const stepNo = Math.floor(worst * 2)
    if (stepNo > this.warnStep[side] && !this.isBot(side)) {
      this.ctx.audio.play('buzz', 0.9 + stepNo * 0.1)
      this.ctx.audio.buzz(15)
    }
    this.warnStep[side] = stepNo
    if (res.hits > 0 && res.impact > 260) this.juiceImpact(side, res.impact, res.ix, res.iy)
    if (res.over) {
      w.overAt = this.time
      this.juiceOver(side)
    }
  }

  /** A fruit landing or knocking: the harder, the louder, dustier and shakier. */
  private juiceImpact(side: Side, speed: number, x: number, y: number): void {
    const { fx, audio } = this.ctx
    const k = Math.min(1, speed / 1700)
    if (this.time - this.bounceAt > 0.05 || k > 0.6) {
      this.bounceAt = this.time
      audio.play(k > 0.55 ? 'thud' : 'bounce', 1.15 - k * 0.45)
    }
    this.wobble[side].kick(k * 90)
    if (speed > 650) {
      const at = toWorld(this.frames[side], x, y)
      fx.puff(at.x, at.y, 'rgba(255,255,255,0.45)', Math.round(2 + k * 6))
    }
    if (speed > 1000) {
      fx.shake(0.05 + k * 0.15)
      audio.buzz(Math.round(6 + k * 14))
    }
    if (speed > 1500) fx.stop(2)
  }

  private juiceMerge(side: Side, m: Merge): void {
    const at = toWorld(this.frames[side], m.x, m.y)
    // Chain: merges in quick succession climb in pitch.
    this.chain[side] = this.time - this.chainAt[side] < CHAIN ? this.chain[side] + 1 : 1
    this.chainAt[side] = this.time
    const chain = this.chain[side]
    const ghosts = this.ghosts[side] as Ghost[]
    if (ghosts.length > 12) ghosts.shift()
    ghosts.push({
      k: m.k - 1,
      ax: m.ax,
      ay: m.ay,
      bx: m.bx,
      by: m.by,
      x: m.x,
      y: m.y,
      t0: this.time,
    })
    this.wobble[side].kick(30 + Math.min(m.k, KINDS) * 12)
    if (m.k >= KINDS) {
      this.ctx.audio.play('powerup')
      this.ctx.fx.ring(at.x, at.y, C.yellow, 340)
      this.ctx.fx.burst(at.x, at.y, C.yellow, { count: 40, speed: 620, size: 14, life: 0.9 })
      this.ctx.fx.flash(C.yellow, 0.22)
      this.ctx.fx.shake(0.6)
      this.ctx.fx.stop(8)
      this.ctx.fx.float(`+${m.points}`, at.x, at.y, C.yellow, 84, side)
      return
    }
    const k = m.k
    const { fx, audio } = this.ctx
    const color = FRUIT_COLOR[k] ?? C.white
    const r = radius(k, this.geo(side))
    audio.play('pop', 0.8 + k * 0.06 + Math.min(6, chain - 1) * 0.08)
    fx.ring(at.x, at.y, color, r * 1.6 + 30)
    fx.burst(at.x, at.y, color, {
      count: 4 + k,
      speed: 220 + k * 30,
      size: 22 + k * 2,
      life: 0.5,
      kind: 'emoji',
      glyph: GLYPH[k] ?? '🍒',
    })
    fx.sparks(at.x, at.y, color, 4 + k * 2)
    fx.float(`+${m.points}`, at.x, at.y - 40, C.yellow, 44 + k * 2, side)
    if (chain >= 2) fx.float(`Combo x${chain}`, at.x, at.y + 50, C.white, 40, side)
    if (k >= 4) audio.buzz(6 + k * 2)
    if (k >= 5) fx.shake(0.06 + k * 0.03)
    if (k >= 7) {
      fx.stop(3 + (k - 7) * 2)
      audio.play('score', 0.8 + (k - 7) * 0.1)
    }
    if (k >= 8) fx.flash(color, 0.18)
  }

  private juiceOver(side: Side): void {
    const geo = this.geo(side)
    const at = toWorld(this.frames[side], (geo.left + geo.right) / 2, geo.danger)
    this.ctx.audio.play('thud')
    this.ctx.audio.buzz(30)
    this.ctx.fx.shake(0.5)
    this.ctx.fx.flash(C.red, 0.25)
    this.ctx.fx.burst(at.x, at.y, C.red, { count: 24, speed: 520, size: 12, life: 0.6 })
    this.wobble[side].kick(160)
  }

  /**
   * The game ends at the time limit, when every jar is full (solo: its jar), or
   * as soon as one jar is full and the other is already ahead of it.
   */
  private settle(): void {
    if (this.over) return
    const [a, b] = this.s.wells
    const done = this.solo
      ? a.overAt >= 0
      : decided(
          { score: a.jar.score, over: a.overAt >= 0 },
          { score: b.jar.score, over: b.overAt >= 0 },
        ) !== null
    if (done || this.time >= this.limit) this.end()
  }

  private end(): void {
    const [a, b] = this.s.wells
    this.s.endAt = this.time
    this.ctx.audio.play('whoosh')
    if (this.solo) {
      this.s.winner = 0
      if (a.overAt < 0) this.ctx.fx.confetti()
      const score = a.jar.score
      const prev = store.records[RECORD]
      const best = submitRecord(RECORD, score, false)
      const note = best ? `New record: ${score}` : `Score ${score} · best ${prev ?? score}`
      this.finish(0, { note, delay: 2 })
      return
    }
    const winner = a.jar.score === b.jar.score ? 'draw' : a.jar.score > b.jar.score ? 0 : 1
    this.s.winner = winner
    if (winner !== 'draw') {
      const geo = this.geo(winner)
      const at = toWorld(
        this.frames[winner],
        (geo.left + geo.right) / 2,
        (geo.danger + geo.floor) / 2,
      )
      this.ctx.fx.confetti(winner)
      this.ctx.fx.shake(0.35)
      this.ctx.fx.stop(6)
      this.ctx.fx.flash(SIDE[winner].main, 0.3)
      this.ctx.fx.ring(at.x, at.y, SIDE[winner].light, 420)
      this.ctx.audio.buzz(30)
    }
    this.finish(winner, { score: [a.jar.score, b.jar.score], delay: 2 })
  }

  render(g: Draw, alpha = 1): void {
    g.fillView(C.ink)
    for (const side of this.sides()) {
      const f = this.frames[side]
      inFrame(g, f, () => {
        const v = localView(g, f)
        g.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, shade(SIDE[side].main, -0.78))
        this.renderWell(g, side, f.w, f.h, alpha)
      })
    }
    if (!this.solo) g.rect(g.stage.view.x - 2, MID - 7, g.stage.view.w + 4, 14, C.ink)
  }

  private renderWell(g: Draw, side: Side, w: number, h: number, alpha: number): void {
    const well = this.s.wells[side]
    const geo = geometry(w, h, this.solo, HEADER)
    const dt = 1 / 60
    // The fruit in hand swings like a pendulum when the aim moves fast.
    const aim = lerp(this.prevAim[side], well.aim, alpha)
    const last = this.lastAim[side]
    const vAim = Number.isNaN(last) ? 0 : (aim - last) / dt
    this.lastAim[side] = aim
    const swing = this.swing[side]
    swing.rest = clamp(-vAim * 0.00022, -0.22, 0.22)
    swing.update(dt)
    this.wobble[side].update(dt)
    const ghosts = this.ghosts[side] as Ghost[]
    while (ghosts.length && this.time - (ghosts[0] as Ghost).t0 > 0.2) ghosts.shift()
    drawHeader(g, w, side, {
      name: this.ctx.names[side],
      score: well.jar.score,
      scoreAt: well.scoreAt,
      remaining: this.limit - this.time,
      now: this.time,
    })
    const prev = this.prev
    drawJar(
      g,
      geo,
      side,
      w,
      {
        jar: well.jar,
        aim,
        swing: clamp(swing.value, -0.3, 0.3),
        wobble: clamp(this.wobble[side].value * 0.06, -8, 8),
        ghosts,
        pos: (b, out) => {
          const p = prev.get(b)
          out[0] = p ? lerp(p[0], b.x, alpha) : b.x
          out[1] = p ? lerp(p[1], b.y, alpha) : b.y
        },
        next: well.next,
        after: this.seq[(well.seq + 1) % this.seq.length] ?? 0,
        dropAt: well.dropAt,
        live: well.overAt < 0 && this.s.endAt < 0,
        danger: this.danger,
        hint: !this.isBot(side) && well.seq === 0 && this.time < 8,
        controls: g.viewer === null || g.viewer === side,
      },
      this.time,
    )
    const { endAt, winner } = this.s
    const score = `${well.jar.score} pts`
    if (endAt >= 0) {
      // The verdict, on each jar.
      const won = winner === side
      const title = this.solo
        ? well.overAt >= 0
          ? 'Jar full!'
          : 'Time!'
        : winner === 'draw'
          ? 'Draw!'
          : won
            ? 'Winner!'
            : 'So close!'
      drawCard(g, geo, side, title, score, {
        at: endAt,
        now: this.time,
        color: this.solo || won ? SIDE[side].main : shade(SIDE[side].main, -0.5),
        crown: !this.solo && won,
      })
    } else if (well.overAt >= 0) {
      drawCard(g, geo, side, 'Jar full!', score, { at: well.overAt, now: this.time })
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.ptr = [null, null]
    this.queued = [null, null]
    this.prev = new WeakMap()
    this.prevAim = [this.s.wells[0].aim, this.s.wells[1].aim]
    this.lastAim = [NaN, NaN]
    this.ghosts = [[], []]
  }
}

export default () => new FruitMerge()
