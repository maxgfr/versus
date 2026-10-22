import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
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
import { type Look, renderJoust } from './render.ts'
import {
  CHARGE_CD,
  CHARGE_SPEED,
  type Drive,
  type Ev,
  newWorld,
  type Pose,
  stepWorld,
  type World,
} from './rules.ts'

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
  // Cosmetic only (never synced): last step's poses for interpolation.
  private prev: (Pose | undefined)[] = []
  private look: Look = { alpha: 1, prev: this.prev }

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
    s.w.k.forEach((k, i) => {
      const p = this.prev[i]
      if (p) {
        p.x = k.x
        p.y = k.y
        p.a = k.a
      } else this.prev[i] = { x: k.x, y: k.y, a: k.a }
    })
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
      return snapControl(c, Math.min(1, Math.max(0, 1 - cd / CHARGE_CD)))
    })
    if (scorer !== null && s.w.pts[scorer] >= this.target) {
      ctx.fx.confetti(scorer)
      ctx.fx.flash(SIDE[scorer].main, 0.3)
      this.finish(scorer, { score: [s.w.pts[0], s.w.pts[1]], delay: 2.6 })
    }
  }

  protected override afterEnd(dt: number): void {
    // The knights glide back and the stamp plays on during the ending.
    this.s.w.t += dt
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest has no previous step to blend from.
    this.prev.length = 0
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'charge':
        audio.play('whoosh', 0.85 + Math.random() * 0.1)
        fx.puff(e.x, e.y, 'rgba(236,224,196,0.5)', 8)
        fx.shake(0.12)
        break
      case 'clash': {
        // Lance on shield: the harder they came together, the louder the ring.
        const k = Math.min(1, e.speed / (CHARGE_SPEED * 1.4))
        audio.play('hit', 0.8 + k * 0.4)
        audio.play('zap', 1 + k * 0.3)
        audio.buzz(20 + Math.round(k * 30))
        fx.sparks(e.x, e.y, C.yellow, Math.round(10 + k * 16))
        fx.ring(e.x, e.y, C.white, 90 + k * 70)
        fx.shake(0.2 + k * 0.35)
        fx.stop(2 + Math.round(k * 4))
        break
      }
      case 'double':
        audio.play('hit', 0.8)
        audio.play('thud')
        fx.sparks(e.x, e.y, C.white, 18)
        fx.ring(e.x, e.y, C.white, 160)
        fx.shake(0.35)
        fx.stop(5)
        for (const side of [0, 1] as Side[]) floatFor(fx, side, 'Double hit!')
        break
      case 'point': {
        // A touch at full charge lands like a thunderclap.
        const k = Math.min(1, e.speed / CHARGE_SPEED)
        audio.play('coin', 1)
        audio.play('explode', 0.85 - k * 0.2)
        audio.buzz(50 + Math.round(k * 40))
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
        fx.flash(SIDE[e.side].light, 0.2 + k * 0.15)
        fx.shake(0.45 + k * 0.35)
        fx.stop(6 + Math.round(k * 6))
        break
      }
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

  render(g: Draw, alpha: number): void {
    this.look.alpha = alpha
    renderJoust(g, this.s, this.ctx.names, this.target, this.over, this.time, this.look)
  }
}

export default () => new FatalKnights()
