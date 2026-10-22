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
import { type Rounds, roundEnd, roundsNew, roundsStep } from '../../engines/reflex/index.ts'
import { PenguinBot } from './bot.ts'
import { type Look, renderIce, rinkXY } from './render.ts'
import {
  DASH_CD,
  type Drive,
  type Ev,
  newWorld,
  roundWinner,
  stepWorld,
  type World,
} from './rules.ts'

export interface State {
  w: World
  rounds: Rounds
  /** Stick and dash button looks, so the online guest can draw them. */
  ctl: ControlLook[]
}

/** Rounds to win (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Pause between rounds, seconds. */
const BETWEEN = 2.2

class FrozenPenguins extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (PenguinBot | null)[] = []
  private ev: Ev[] = []
  // Cosmetic only (never synced): last step's positions for interpolation.
  private prev: ({ x: number; y: number } | undefined)[] = []
  private look: Look = { alpha: 1, prev: this.prev }

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [...sideControls(ctx.stage, 0, false), ...sideControls(ctx.stage, 1, false)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new PenguinBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      w: newWorld(),
      rounds: roundsNew(this.target),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    s.w.p.forEach((p, i) => {
      const q = this.prev[i]
      if (q) {
        q.x = p.x
        q.y = p.y
      } else this.prev[i] = { x: p.x, y: p.y }
    })
    if (roundsStep(s.rounds, this.time, BETWEEN)) {
      s.w = newWorld()
      this.prev.length = 0
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
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
    s.ctl = this.controls.map((c) => {
      const p = s.w.p[c.side]
      const ready = Math.min(1, Math.max(0, 1 - (p.ready - s.w.t) / DASH_CD))
      return snapControl(c, ready)
    })
    if (!playing) {
      // Between rounds the fallen penguin keeps sinking; the ice stays still.
      s.w.t += dt
      return
    }
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    const w = roundWinner(s.w)
    if (w === null) return
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      ctx.fx.flash(SIDE[w].main, 0.25)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.6 })
    } else if (w !== 'draw') floatFor(ctx.fx, w, 'Still dry!')
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest has no previous step to blend from.
    this.prev.length = 0
  }

  protected override afterEnd(dt: number): void {
    this.s.w.t += dt
  }

  private feedback(ev: Ev): void {
    const { fx, audio } = this.ctx
    // Effects land where the rink is drawn (it is scaled about the floe's centre).
    const [x, y] = rinkXY(ev.x, ev.y)
    const e = { ...ev, x, y }
    switch (e.k) {
      case 'dash':
        // A full push is a big whoosh and a spray of ice; a nudge a little hop.
        audio.play('whoosh', 1.15 - e.power * 0.2 + Math.random() * 0.1)
        fx.puff(e.x, e.y, 'rgba(240,250,255,0.55)', Math.round(3 + e.power * 6))
        fx.burst(e.x, e.y, '#e8f6ff', {
          count: Math.round(4 + e.power * 8),
          speed: 260 + e.power * 200,
          size: 8,
          life: 0.35,
          gravity: 0,
          drag: 3,
          kind: 'spark',
        })
        fx.shake(0.05 + e.power * 0.1)
        if (e.power > 0.8) audio.buzz(10)
        break
      case 'bump':
        audio.play('bounce', 0.9 + Math.min(0.5, e.speed / 800))
        if (e.speed > 400) audio.play('slap', 1)
        fx.ring(e.x, e.y, C.white, 60 + Math.min(120, e.speed / 6))
        audio.buzz(10 + Math.round(Math.min(40, e.speed / 30)))
        fx.sparks(e.x, e.y, C.white, Math.round(6 + Math.min(16, e.speed / 60)))
        fx.shake(0.2 + Math.min(0.3, e.speed / 1500))
        fx.stop(e.speed > 500 ? 4 : 2)
        break
      case 'fall':
        audio.play('splash', 1)
        audio.buzz(60)
        fx.burst(e.x, e.y, '#e8f6ff', {
          count: 26,
          speed: 420,
          size: 16,
          life: 0.8,
          gravity: 260,
          colors: ['#ffffff', '#bfe9ff', SIDE[e.side].light],
        })
        fx.burst(e.x, e.y, '#ffffff', {
          count: 18,
          speed: 700,
          size: 12,
          life: 0.7,
          gravity: 1400,
          spread: 1.2,
          dir: -Math.PI / 2,
          colors: ['#ffffff', '#bfe9ff'],
        })
        fx.ring(e.x, e.y, '#bfe9ff', 180)
        fx.ring(e.x, e.y, C.white, 110)
        fx.flash('#bfe9ff', 0.25)
        fx.shake(0.6)
        fx.stop(10)
        break
    }
  }

  render(g: Draw, alpha: number): void {
    this.look.alpha = alpha
    renderIce(g, this.s, this.time, this.ctx.names, this.over, this.look)
  }
}

export default () => new FrozenPenguins()
