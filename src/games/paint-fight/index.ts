import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { Button, Joystick } from '../../core/controls.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, shade } from '../../core/render/palette.ts'
import {
  type ControlLook,
  firePressed,
  type SideControl,
  snapControl,
} from '../../engines/arena/index.ts'
import { H, W } from '../../core/stage.ts'
import { PaintBot } from './bot.ts'
import { renderPaint } from './render.ts'
import {
  BOARD_BOTTOM,
  type Drive,
  type Ev,
  matchWinner,
  newWorld,
  SPLASH_CD,
  stepWorld,
  shares,
  type World,
} from './rules.ts'

export interface State {
  w: World
  /** Control visuals, so an online guest can draw sticks and buttons. */
  ctl: ControlLook[]
}

/** Match length in seconds (the clock runs the whole match). */
export const match: MatchSpec = { unit: 'seconds', default: 60, min: 15, max: 180, step: 15 }

class Paint extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (PaintBot | null)[] = []
  private ev: Ev[] = []
  private lastSec = -1

  private get duration(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [...this.buildControls(0), ...this.buildControls(1)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new PaintBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      w: newWorld(ctx.teams),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  /**
   * Joystick and splash button per roller in the strip below the floor, laid
   * out for red (lane 0 on the left of its seat) and mirrored for blue. With
   * teams each half has two of them. The row sits mid-strip, safe-area aware.
   */
  private buildControls(side: Side): SideControl[] {
    const teams = this.ctx.teams
    const y0 = BOARD_BOTTOM + 70
    const y1 = Math.max(this.ctx.stage.edge(0), BOARD_BOTTOM + 260)
    // Low enough for the board, high enough that the knob stays on screen at full tilt.
    const cy = Math.min((y0 + y1) / 2, y1 - 125)
    const zy = BOARD_BOTTOM
    const zh = y1 + 200 - zy
    const lanes: {
      lane: 0 | 1
      zone: [number, number, number, number]
      hx: number
      bx: number
      rad: number
      br: number
    }[] = teams
      ? [
          { lane: 0, zone: [-200, zy, 520, zh], hx: 160, bx: 390, rad: 72, br: 60 },
          { lane: 1, zone: [500, zy, 290, zh], hx: 630, bx: 868, rad: 72, br: 60 },
        ]
      : [{ lane: 0, zone: [-200, zy, 850, zh], hx: 250, bx: 810, rad: 84, br: 78 }]
    return lanes.map((l) => {
      const [zx, zyy, zw, zhh] = l.zone
      const zone =
        side === 0
          ? { x: zx, y: zyy, w: zw, h: zhh }
          : { x: W - (zx + zw), y: H - (zyy + zhh), w: zw, h: zhh }
      const hx = side === 0 ? l.hx : W - l.hx
      const hy = side === 0 ? cy : H - cy
      const bx = side === 0 ? l.bx : W - l.bx
      // Touches are routed by the world's left and right halves, so blue's lanes flip.
      const worldLane = side === 0 ? l.lane : ((1 - l.lane) as 0 | 1)
      return {
        side,
        lane: l.lane,
        stick: new Joystick(side, zone, l.rad, hx, hy, teams ? worldLane : undefined),
        fire: new Button(side, bx, hy, l.br),
      }
    })
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    for (const c of this.controls) {
      c.stick.update(ctx.input.player(c.side))
      c.fire.update(ctx.input.player(c.side))
    }
    const drives: (Drive | undefined)[] = s.w.rollers.map((ro) => {
      const c = this.controls.find((k) => k.side === ro.side && k.lane === ro.lane)
      const bot = this.bots[ro.side]
      if (bot) {
        const d = bot.decide(s.w, ro, dt)
        if (c) {
          c.stick.set(d.jx, d.jy)
          if (d.splash) c.fire.press(4)
        }
        return d
      }
      if (!c) return undefined
      return {
        jx: c.stick.x,
        jy: c.stick.y,
        splash: firePressed(c, ctx.input.player(c.side)),
      }
    })
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.controls.map((c) => {
      const ro = s.w.rollers.find((k) => k.side === c.side && k.lane === c.lane)
      return snapControl(c, ro ? 1 - ro.cd / SPLASH_CD : 1)
    })
    const left = Math.ceil(this.duration - this.time)
    if (left !== this.lastSec && left <= 5 && left > 0) {
      this.lastSec = left
      ctx.audio.play(left <= 3 ? 'count' : 'tick', left <= 3 ? 1 : 1.2)
    }
    if (this.time >= this.duration) {
      const w = matchWinner(s.w)
      const [red, blue] = s.w.counts
      const pct = shares(s.w).map((x) => Math.round(x * 100))
      if (w !== 'draw') {
        ctx.fx.confetti(w)
        ctx.fx.flash(SIDE[w].light, 0.3)
      }
      ctx.audio.play('buzz')
      ctx.fx.shake(0.3)
      this.finish(w, { score: [red, blue], note: `${pct[0]}% to ${pct[1]}%`, delay: 2.2 })
    }
  }

  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    stepWorld(this.s.w, [], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'paint':
        if (rng.chance(0.3)) audio.play('slide', 0.9 + rng.next() * 0.3)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 2,
          speed: 90,
          size: 8,
          life: 0.35,
          gravity: 0,
          drag: 2,
        })
        break
      case 'splash':
        audio.play('splash', 1.2 + rng.next() * 0.2)
        audio.buzz(20)
        fx.burst(e.x, e.y, SIDE[e.side].main, {
          count: 22,
          speed: 380,
          size: 16,
          life: 0.55,
          gravity: 0,
          drag: 2.5,
          colors: [SIDE[e.side].main, SIDE[e.side].light, '#ffffff'],
        })
        fx.burst(e.x, e.y, SIDE[e.side].main, {
          count: 10,
          speed: 520,
          size: 22,
          life: 0.35,
          gravity: 0,
          drag: 4,
          colors: [SIDE[e.side].main, shade(SIDE[e.side].main, -0.2)],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 160)
        if (e.n > 0) fx.float(`+${e.n}`, e.x, e.y - 70, C.yellow, 56, e.side)
        fx.shake(0.25)
        fx.stop(3)
        break
    }
  }

  render(g: Draw): void {
    renderPaint(g, this.s, this.time, {
      names: this.ctx.names,
      over: this.over,
      duration: this.duration,
      winner: this.over ? matchWinner(this.s.w) : null,
    })
  }
}

export default () => new Paint()
