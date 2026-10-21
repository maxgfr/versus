import { Joystick } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { PiranhaBot } from './bot.ts'
import { renderRiver } from './render.ts'
import { type Ev, HOME, newWorld, schoolsFor, stepWorld, winnerOf, type World } from './rules.ts'

/** Seconds of crossing: the players pick the length on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: 60, min: 20, max: 120, step: 10 }

/** A joystick's look, copied into the state so the online guest can draw it. */
export interface PadLook {
  bx: number
  by: number
  kx: number
  ky: number
  on: boolean
}

export interface State extends World {
  pads: [PadLook, PadLook]
  /** Game time of each side's last crossing (score pop), last far-bank touch and last bite. */
  scoredAt: [number, number]
  farAt: [number, number]
  bitAt: [number, number]
  /** Where each side was bitten (for the splash tween), the whistle time and the outcome. */
  bitX: [number, number]
  bitY: [number, number]
  endAt: number
  winner: Side | 'draw' | null
}

class PiranhaRush extends BaseGame<State> {
  private pads!: [Joystick, Joystick]
  private bots: (PiranhaBot | null)[] = [null, null]
  private ev: Ev[] = []
  private lastTick = -1

  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    // Each half steers its own swimmer; the zone covers the whole half, the stick floats under the thumb.
    this.pads = ([0, 1] as Side[]).map((side) => {
      const home = frame(side, 250, 1560)
      const zone = side === 0 ? { x: 0, y: 900, w: 1000, h: 900 } : { x: 0, y: 0, w: 1000, h: 900 }
      return new Joystick(side, zone, 110, home.x, home.y)
    }) as [Joystick, Joystick]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new PiranhaBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      ...newWorld(schoolsFor(ctx.rng)),
      pads: this.looks(),
      scoredAt: [-9, -9],
      farAt: [-9, -9],
      bitAt: [-9, -9],
      bitX: [0, 0],
      bitY: [0, 0],
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
    const drives: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]
    for (const side of [0, 1] as Side[]) {
      const pad = this.pads[side]
      const bot = this.bots[side]
      if (bot) {
        const v = bot.drive(s, side, dt)
        pad.set(v.x, v.y)
      } else {
        pad.update(ctx.input.player(side))
      }
      drives[side] = { x: pad.x, y: pad.y }
    }

    this.ev.length = 0
    stepWorld(s, dt, drives, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.pads = this.looks()

    const sec = Math.ceil(this.total - s.t)
    if (sec !== this.lastTick && sec <= 5 && sec > 0) {
      this.lastTick = sec
      if (sec <= 3) ctx.audio.play('count', sec === 1 ? 1.2 : 1)
      else ctx.audio.play('tick', 1.1)
    }
    if (s.t >= this.total) this.end()
  }

  /** The whistle: most crossings wins. */
  private end(): void {
    const s = this.s
    const { fx } = this.ctx
    const w = winnerOf(s)
    s.endAt = this.time
    s.winner = w
    this.ctx.audio.play('buzz')
    fx.flash(C.white, 0.3)
    if (w !== 'draw') fx.confetti(w)
    this.finish(w, { score: [s.swim[0].crossings, s.swim[1].crossings], delay: 2.4 })
  }

  /** The fish keep sweeping while the result comes up. */
  protected override afterEnd(dt: number): void {
    // The schools are a pure function of time: just let the clock run (no more bites).
    this.s.t += dt
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'far':
        this.s.farAt[e.side] = this.time
        audio.play('powerup', 1.1 + rng.next() * 0.1)
        fx.ring(e.x, e.y, C.yellow, 120)
        fx.sparks(e.x, e.y, C.yellow, 10)
        fx.float('Now back!', e.x, e.y + (e.side === 0 ? -80 : 80), C.yellow, 44, e.side)
        break
      case 'cross':
        this.s.scoredAt[e.side] = this.time
        audio.play('score', 1.1)
        audio.play('coin', 1.05)
        fx.burst(e.x, e.y, C.cyan, {
          count: 22,
          speed: 360,
          size: 12,
          life: 0.7,
          gravity: 200,
          colors: [C.cyan, C.white, SIDE[e.side].light],
          kind: 'dot',
        })
        fx.ring(e.x, e.y, SIDE[e.side].main, 200)
        floatFor(fx, e.side, '+1', e.x, e.y + (e.side === 0 ? -90 : 90))
        break
      case 'bite': {
        const s = this.s
        s.bitAt[e.side] = this.time
        s.bitX[e.side] = e.x
        s.bitY[e.side] = e.y
        const home = HOME[e.side] as { x: number; y: number }
        fx.puff(home.x, home.y, 'rgba(220,240,255,0.6)', 6)
        audio.play('chomp', 1.1)
        audio.play('splash', 0.7)
        audio.buzz(40)
        fx.burst(e.x, e.y, C.water, {
          count: 28,
          speed: 460,
          size: 14,
          life: 0.8,
          gravity: 500,
          colors: [C.water, C.white, '#9ee6ff'],
          kind: 'dot',
        })
        fx.burst(e.x, e.y, C.red, { count: 10, speed: 260, size: 12, life: 0.5, gravity: 300 })
        fx.shake(0.35)
        fx.stop(4)
        fx.float('Chomp!', e.x, e.y, C.orange, 62, e.side)
        break
      }
    }
  }

  render(g: Draw): void {
    renderRiver(g, this.s, this.ctx.names, this.total - this.s.t, this.time)
  }
}

export default () => new PiranhaRush()
