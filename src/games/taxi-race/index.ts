import { Joystick } from '../../core/controls.ts'
import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { TaxiBot } from './bot.ts'
import { renderCity } from './render.ts'
import {
  type Ev,
  gridOf,
  MAPS,
  newWorld,
  type Pt,
  stepWorld,
  winnerOf,
  type World,
} from './rules.ts'

/** Seconds on the clock: the players pick the length on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: 60, min: 30, max: 180, step: 30 }

/** A joystick's look, copied into the state so the online guest can draw it. */
export interface PadLook {
  bx: number
  by: number
  kx: number
  ky: number
  on: boolean
}

/** A passenger hopping in, out or tumbling from a cab: timed tweens, so the online guest sees them. */
export interface Hop {
  kind: 'in' | 'out' | 'drop'
  side: Side
  id: number
  x: number
  y: number
  at: number
}

export interface State extends World {
  pads: [PadLook, PadLook]
  hops: Hop[]
  /** Game time of each side's last delivery (score pop) and of the final horn (-1 while playing). */
  scoredAt: [number, number]
  endAt: number
  winner: Side | 'draw' | null
}

/** Each player's steering strip, below (red) and above (blue) the city. */
const ZONE = [
  { x: 0, y: 1500, w: 1000, h: 300 },
  { x: 0, y: 0, w: 1000, h: 300 },
]

/** Keeps a floating label's centre far enough from the side edges that it never gets clipped. */
const inX = (x: number): number => Math.max(170, Math.min(830, x))

class TaxiRace extends BaseGame<State> {
  private pads!: [Joystick, Joystick]
  private bots: (TaxiBot | null)[] = [null, null]
  private ev: Ev[] = []
  private lastTick = -1

  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    const map = ctx.rng.int(0, MAPS.length - 1)
    this.pads = ([0, 1] as Side[]).map((side) => {
      const home = frame(side, 300, 1600)
      return new Joystick(side, ZONE[side] as (typeof ZONE)[0], 110, home.x, home.y)
    }) as [Joystick, Joystick]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new TaxiBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      ...newWorld(map),
      pads: this.looks(),
      hops: [],
      scoredAt: [-9, -9],
      endAt: -1,
      winner: null,
    }
  }

  private looks(): [PadLook, PadLook] {
    return this.pads.map((p) => ({
      bx: p.baseX,
      by: p.baseY,
      kx: p.knobX,
      ky: p.knobY,
      on: p.active,
    })) as [PadLook, PadLook]
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    const grid = gridOf(s.map)
    const drives: [Pt | null, Pt | null] = [null, null]
    for (const side of [0, 1] as Side[]) {
      const pad = this.pads[side]
      const bot = this.bots[side]
      if (bot) {
        const v = bot.drive(s, grid, side, dt)
        pad.set(v.x, v.y)
      } else {
        pad.update(ctx.input.player(side))
      }
      drives[side] = { x: pad.x, y: pad.y }
    }

    this.ev.length = 0
    stepWorld(s, dt, drives, ctx.rng, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.pads = this.looks()
    s.hops = s.hops.filter((h) => this.time - h.at < 1)

    const sec = Math.ceil(this.total - s.t)
    if (sec !== this.lastTick && sec <= 5 && sec > 0) {
      this.lastTick = sec
      if (sec <= 3) ctx.audio.play('count', sec === 1 ? 1.2 : 1)
      else ctx.audio.play('tick', 1.1)
    }
    if (s.t >= this.total) this.end()
  }

  /** The horn: most fares wins. */
  private end(): void {
    const s = this.s
    const { fx } = this.ctx
    const w = winnerOf(s)
    s.endAt = this.time
    s.winner = w
    this.ctx.audio.play('buzz')
    fx.flash(C.white, 0.3)
    if (w !== 'draw') fx.confetti(w)
    this.finish(w, { score: [s.taxis[0].fares, s.taxis[1].fares], delay: 2.4 })
  }

  /** The city keeps its lights on while the result comes up. */
  protected override afterEnd(): void {
    this.s.hops = this.s.hops.filter((h) => this.time - h.at < 1)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'pick':
        this.s.hops.push({ kind: 'in', side: e.side, id: e.id, x: e.x, y: e.y, at: this.time })
        audio.play('pop', 0.95 + rng.next() * 0.15)
        audio.play('boing', 1.3)
        fx.ring(e.x, e.y, SIDE[e.side].light, 120)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', 4)
        fx.float('Hop in!', inX(e.x), e.y - 70, SIDE[e.side].light, 46, e.side)
        break
      case 'deliver':
        this.s.hops.push({ kind: 'out', side: e.side, id: e.id, x: e.x, y: e.y, at: this.time })
        this.s.scoredAt[e.side] = this.time
        audio.play('coin', 1 + rng.next() * 0.08)
        audio.play('score', 1.2)
        fx.burst(e.x, e.y, C.yellow, {
          count: 10,
          speed: 520,
          size: 34,
          life: 0.9,
          gravity: 900,
          kind: 'emoji',
          glyph: '⭐',
        })
        fx.shake(0.15)
        fx.burst(e.x, e.y, C.yellow, {
          count: 22,
          speed: 380,
          size: 12,
          life: 0.7,
          colors: [C.yellow, C.white, SIDE[e.side].light],
        })
        fx.ring(e.x, e.y, SIDE[e.side].main, 180)
        fx.float(`+${e.value}`, inX(e.x), e.y - 90, C.yellow, 84, e.side)
        break
      case 'drop':
        this.s.hops.push({ kind: 'drop', side: e.side, id: e.id, x: e.x, y: e.y, at: this.time })
        audio.play('slide', 0.8)
        audio.play('error', 1.2)
        fx.sparks(e.x, e.y, C.orange, 12)
        {
          // A bump can drop both fares at once: push each label out past its own cab,
          // away from the rival, so the two never stack on top of each other.
          const me = this.s.taxis[e.side]
          const other = this.s.taxis[e.side === 0 ? 1 : 0]
          const dx = me.x - other.x
          const dy = me.y - other.y
          const d = Math.hypot(dx, dy) || 1
          fx.float('Dropped!', inX(e.x + (dx / d) * 110), e.y + (dy / d) * 90, C.orange, 58, e.side)
        }
        break
      case 'bump':
        audio.play('thud', 1.15)
        audio.buzz(24)
        fx.sparks(e.x, e.y, C.yellow, 14)
        fx.shake(0.22)
        fx.stop(3)
        break
    }
  }

  render(g: Draw): void {
    renderCity(g, this.s, gridOf(this.s.map), this.ctx.names, this.total - this.s.t, this.time)
  }
}

export default () => new TaxiRace()
