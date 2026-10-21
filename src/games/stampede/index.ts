import { Joystick } from '../../core/controls.ts'
import { frame } from '../../core/frame.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { roundEnd, type Rounds, roundsNew, roundsStep } from '../../engines/reflex/index.ts'
import { StampedeBot } from './bot.ts'
import { renderStampede } from './render.ts'
import { type Ev, newWorld, roundOver, stepWorld, type World } from './rules.ts'

/** Round wins needed to take the match (first to N; each round is last blob standing). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 9 }

/** A joystick's look, copied into the state so the online guest can draw it. */
export interface PadLook {
  bx: number
  by: number
  kx: number
  ky: number
  on: boolean
}

export interface State extends World {
  rounds: Rounds
  pads: [PadLook, PadLook]
}

class Stampede extends BaseGame<State> {
  private pads!: [Joystick, Joystick]
  private bots: (StampedeBot | null)[] = [null, null]
  private ev: Ev[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    // Each half steers its own blob; the zone covers the half, the stick floats under the thumb.
    this.pads = ([0, 1] as Side[]).map((side) => {
      const home = frame(side, 250, 1540)
      const zone = side === 0 ? { x: 0, y: 900, w: 1000, h: 900 } : { x: 0, y: 0, w: 1000, h: 900 }
      return new Joystick(side, zone, 110, home.x, home.y)
    }) as [Joystick, Joystick]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new StampedeBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return { ...newWorld(), rounds: roundsNew(this.target), pads: this.looks() }
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
    const { ctx } = this
    if (roundsStep(this.s.rounds, this.time, 2.4)) {
      // A new round: the herds start over and both blobs go back to their spots.
      this.s = { ...newWorld(), rounds: this.s.rounds, pads: this.s.pads }
      ctx.audio.play('go')
      return
    }
    const s = this.s
    if (s.rounds.phase !== 'play') return

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
    stepWorld(s, dt, drives, ctx.rng, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.pads = this.looks()

    const w = roundOver(s)
    if (w === null) return
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2 })
    }
  }

  /** Herds keep stampeding through the ending. */
  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    stepWorld(this.s, dt, [null, null], this.ctx.rng, this.ev, false)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'warn':
        audio.play('count', 0.7)
        break
      case 'enter':
        audio.play('thud', 0.8 + rng.next() * 0.15)
        fx.shake(0.12)
        break
      case 'dust':
        fx.puff(e.x, e.y + 40, 'rgba(214,190,150,0.45)', 2)
        break
      case 'bump':
        audio.play('boing', 1.1 + rng.next() * 0.2)
        fx.ring(e.x, e.y, C.white, 70)
        fx.sparks(e.x, e.y, C.white, 6)
        break
      case 'hit': {
        audio.play('hit', 0.95 + rng.next() * 0.1)
        audio.play('thud', 1.05)
        audio.buzz(30)
        fx.burst(e.x, e.y, C.orange, {
          count: 22,
          speed: 520,
          size: 14,
          life: 0.55,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, C.white],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 150)
        fx.shake(0.4)
        fx.stop(4)
        fx.burst(e.x, e.y, C.white, {
          count: 4,
          speed: 300,
          size: 40,
          life: 0.7,
          gravity: 300,
          kind: 'emoji',
          glyph: '💫',
        })
        fx.float('Ouch!', e.x, e.y + (e.side === 0 ? -80 : 80), C.orange, 60, e.side)
        break
      }
      case 'out':
        audio.play('explode')
        audio.buzz(80)
        fx.burst(e.x, e.y, C.orange, {
          count: 34,
          speed: 640,
          size: 18,
          life: 0.7,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, '#ffffff'],
        })
        fx.burst(e.x, e.y, '#55506a', {
          count: 14,
          speed: 260,
          size: 30,
          life: 1.1,
          gravity: -80,
          drag: 2.5,
        })
        fx.flash(C.orange, 0.3)
        fx.shake(0.7)
        fx.stop(7)
        fx.burst(e.x, e.y, C.white, {
          count: 8,
          speed: 420,
          size: 44,
          life: 0.9,
          gravity: 400,
          kind: 'emoji',
          glyph: '🐾',
        })
        floatFor(fx, e.side, 'Trampled!', e.x, e.y + (e.side === 0 ? -110 : 110))
        break
    }
  }

  render(g: Draw): void {
    renderStampede(g, this.s, this.ctx.names, this.time, this.over, g.t)
  }
}

export default () => new Stampede()
