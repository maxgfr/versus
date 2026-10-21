import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import {
  type ControlLook,
  firePressed,
  type SideControl,
  sideControls,
  snapControl,
} from '../../engines/arena/index.ts'
import { KnightBot } from './bot.ts'
import { renderJoust } from './render.ts'
import { type Drive, type Ev, newWorld, stepWorld, type World } from './rules.ts'

export interface State {
  w: World
  /** Stick and charge button looks, so the online guest can draw them. */
  ctl: ControlLook[]
}

/** Points to take the joust (first to three by default). */
export const match: MatchSpec = { unit: 'points', default: 3, min: 1, max: 9 }

class FatalKnights extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (KnightBot | null)[] = []
  private ev: Ev[] = []
  /** Host-only: time of the last bump sound, so touching horses do not buzz. */
  private bumpT = -9

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [...sideControls(ctx.stage, 0, false), ...sideControls(ctx.stage, 1, false)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new KnightBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      w: newWorld(),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    const drives: Drive[] = ([0, 1] as Side[]).map((side) => {
      const c = this.controls[side] as SideControl
      const bot = this.bots[side]
      if (bot) {
        const d = bot.decide(s.w, side, dt)
        c.stick.set(d.jx, d.jy)
        if (d.press) c.fire.press(1)
        return d
      }
      const input = ctx.input.player(side)
      c.stick.update(input)
      c.fire.update(input)
      return { jx: c.stick.x, jy: c.stick.y, press: firePressed(c, input) }
    })
    this.ev.length = 0
    const scorer = stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.controls.map((c) => {
      const k = s.w.k[c.side]
      const cd = k.ready - s.w.t
      return snapControl(c, Math.min(1, Math.max(0, 1 - cd / 2.6)))
    })
    if (scorer !== null && s.w.pts[scorer] >= this.target) {
      ctx.fx.confetti(scorer)
      this.finish(scorer, { score: [s.w.pts[0], s.w.pts[1]], delay: 2.6 })
    }
  }

  protected override afterEnd(dt: number): void {
    // The knights glide back and the stamp plays on during the ending.
    this.s.w.t += dt
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'charge':
        audio.play('whoosh', 0.85 + rng.next() * 0.1)
        fx.puff(e.x, e.y, 'rgba(236,224,196,0.5)', 8)
        fx.shake(0.12)
        break
      case 'clash':
        audio.play('hit', 0.9)
        audio.play('zap', 1.1)
        audio.buzz(30)
        fx.sparks(e.x, e.y, C.yellow, 16)
        fx.ring(e.x, e.y, C.white, 120)
        fx.shake(0.4)
        fx.stop(4)
        break
      case 'point':
        audio.play('coin', 1)
        audio.play('explode', 0.7)
        audio.buzz(70)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 30,
          speed: 620,
          size: 14,
          life: 0.7,
          gravity: 200,
          colors: [SIDE[e.side].main, SIDE[e.side].light, C.yellow, C.white],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 220)
        fx.ring(e.x, e.y, C.yellow, 140)
        fx.burst(e.x, e.y, '#c9ced9', {
          count: 8,
          speed: 520,
          size: 12,
          life: 0.7,
          gravity: 900,
          kind: 'square',
          colors: ['#c9ced9', '#8d929e'],
        })
        fx.float('+1', e.x, e.y - 80, SIDE[e.side].light, 72, e.side)
        fx.flash(SIDE[e.side].light, 0.3)
        fx.shake(0.7)
        fx.stop(10)
        break
      case 'bump':
        if (this.time - this.bumpT < 0.35) break
        this.bumpT = this.time
        audio.play('bounce', 1)
        fx.puff(e.x, e.y, 'rgba(230,230,220,0.5)', 4)
        break
      case 'wall':
        audio.play('wall', 1.1)
        fx.puff(e.x, e.y, 'rgba(230,230,220,0.5)', 5)
        break
    }
  }

  render(g: Draw): void {
    renderJoust(g, this.s, this.ctx.names, this.target, this.over, this.time)
  }
}

export default () => new FatalKnights()
