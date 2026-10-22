import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { Button, Joystick } from '../../core/controls.ts'
import { Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
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
import { type Look, renderPaint } from './render.ts'
import {
  BOARD_BOTTOM,
  type Drive,
  type Ev,
  matchWinner,
  newWorld,
  ROLL_SPEED,
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

/** Seconds left when the paint frenzy starts: the last quarter, 5 to 15 s. */
export const frenzyAt = (duration: number): number => Math.max(5, Math.min(15, duration / 4))

class Paint extends BaseGame<State> {
  private controls: SideControl[] = []
  /** One bot per roller (2 vs 2 teammates each keep their own goal). */
  private bots: (PaintBot | null)[] = []
  private ev: Ev[] = []
  private lastSec = -1
  // Cosmetic only (never synced): last step's positions for interpolation,
  // squash springs per roller, share-bar pulses and the frame clock.
  private prev: ({ x: number; y: number } | undefined)[] = []
  private squash: Spring[] = []
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private lastT = -1
  private look: Look = { alpha: 1, prev: this.prev, squash: [], pulse: [0, 0] }

  private get duration(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [...this.buildControls(0), ...this.buildControls(1)]
    const w = newWorld(ctx.teams)
    this.bots = w.rollers.map((ro) =>
      ctx.bots[ro.side] ? new PaintBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    this.squash = w.rollers.map(() => new Spring(1, 360, 11))
    return {
      w,
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
    this.remember()
    for (const c of this.controls) {
      c.stick.update(ctx.input.player(c.side))
      c.fire.update(ctx.input.player(c.side))
    }
    const drives: (Drive | undefined)[] = s.w.rollers.map((ro, i) => {
      const c = this.controls.find((k) => k.side === ro.side && k.lane === ro.lane)
      const bot = this.bots[i]
      if (bot) {
        // Steer clear of the teammate's goal.
        const mate = this.bots.find((b, j) => b && j !== i && s.w.rollers[j]?.side === ro.side)
        const d = bot.decide(s.w, ro, dt, mate ? { x: mate.goalX, y: mate.goalY } : undefined)
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
    // The closing stretch turns into a paint frenzy: splashes reload twice as fast.
    if (!s.w.frenzy && this.duration - this.time <= frenzyAt(this.duration)) {
      s.w.frenzy = true
      ctx.audio.play('powerup')
      ctx.fx.flash(C.yellow, 0.2)
      for (const side of [0, 1] as Side[]) floatFor(ctx.fx, side, 'Paint frenzy!')
    }
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    const full = s.w.frenzy ? SPLASH_CD / 2 : SPLASH_CD
    s.ctl = this.controls.map((c) => {
      const ro = s.w.rollers.find((k) => k.side === c.side && k.lane === c.lane)
      return snapControl(c, ro ? Math.max(0, 1 - ro.cd / full) : 1)
    })
    const left = Math.ceil(this.duration - this.time)
    if (left !== this.lastSec && left <= 5 && left > 0) {
      this.lastSec = left
      ctx.audio.play(left <= 3 ? 'count' : 'tick', left <= 3 ? 1 : 1.2)
    }
    if (this.time >= this.duration) {
      const w = matchWinner(s.w)
      if (w !== 'draw') this.pulse[w].kick(16)
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
    this.remember()
    this.ev.length = 0
    stepWorld(this.s.w, [], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'paint':
        if (Math.random() < 0.3) audio.play('slide', 0.9 + Math.random() * 0.3)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 2,
          speed: 90,
          size: 8,
          life: 0.35,
          gravity: 0,
          drag: 2,
        })
        break
      case 'splash': {
        // A thrown splash (rolling at speed) flies further and lands bigger;
        // stealing the rival's paint hits hardest.
        const k = Math.min(1, e.power * 0.6 + (e.stolen / 9) * 0.8)
        const col = SIDE[e.side]
        audio.play('splash', 1.25 - k * 0.3 + Math.random() * 0.1)
        audio.buzz(15 + Math.round(k * 25))
        fx.burst(e.x, e.y, col.main, {
          count: Math.round(18 + k * 14),
          speed: 340 + k * 220,
          size: 16,
          life: 0.55,
          gravity: 0,
          drag: 2.5,
          colors: [col.main, col.light, '#ffffff'],
        })
        fx.burst(e.x, e.y, col.main, {
          count: 10,
          speed: 520,
          size: 22,
          life: 0.35,
          gravity: 0,
          drag: 4,
          colors: [col.main, shade(col.main, -0.2)],
        })
        fx.ring(e.x, e.y, col.light, 140 + k * 60)
        if (e.n > 0)
          fx.float(
            e.stolen > 0 ? `+${e.n} stolen!` : `+${e.n}`,
            e.x,
            e.y - 70,
            C.yellow,
            48 + k * 16,
            e.side,
          )
        fx.shake(0.18 + k * 0.2)
        fx.stop(2 + Math.round(k * 2))
        const ro = this.s.w.rollers.find((r) => r.side === e.side && this.s.w.t - r.splashT < 0.02)
        if (ro) this.squash[ro.id]?.kick(-3 - k * 3)
        if (e.n > 0) this.pulse[e.side].kick(4 + e.n)
        if (e.stolen > 0) this.pulse[e.side === 0 ? 1 : 0].kick(-3)
        break
      }
      case 'bump': {
        // Rollers knocking together: louder and shakier the harder they meet.
        const k = Math.min(1, (e.speed - ROLL_SPEED * 0.6) / ROLL_SPEED)
        audio.play('boing', 0.9 + k * 0.3)
        audio.buzz(10 + Math.round(k * 20))
        fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 8))
        fx.ring(e.x, e.y, C.white, 60 + k * 50)
        fx.shake(0.08 + k * 0.15)
        for (const r of this.s.w.rollers)
          if (Math.hypot(r.x - e.x, r.y - e.y) < 80) this.squash[r.id]?.kick(-2 - k * 3)
        break
      }
    }
  }

  /** Last step's positions, for interpolation (cosmetic, outside the state). */
  private remember(): void {
    this.s.w.rollers.forEach((ro, i) => {
      const p = this.prev[i]
      if (p) {
        p.x = ro.x
        p.y = ro.y
      } else this.prev[i] = { x: ro.x, y: ro.y }
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest has no previous step to blend from.
    this.prev.length = 0
    if (this.squash.length !== this.s.w.rollers.length)
      this.squash = this.s.w.rollers.map(() => new Spring(1, 360, 11))
  }

  render(g: Draw, alpha: number): void {
    const fdt = this.lastT < 0 ? 0 : Math.min(0.05, Math.max(0, g.t - this.lastT))
    this.lastT = g.t
    const look = this.look
    look.alpha = alpha
    look.squash = this.squash.map((sp) => Math.max(0.7, Math.min(1.3, sp.update(fdt))))
    for (const side of [0, 1] as Side[])
      look.pulse[side] = Math.max(0, Math.min(1.5, this.pulse[side].update(fdt) / 10))
    renderPaint(
      g,
      this.s,
      this.time,
      {
        names: this.ctx.names,
        over: this.over,
        duration: this.duration,
        winner: this.over ? matchWinner(this.s.w) : null,
      },
      look,
    )
  }
}

export default () => new Paint()
