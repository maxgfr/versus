import { Button } from '../../core/controls.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { CrossBot } from './bot.ts'
import { GO_AT, GO_R, renderJam, scoreAt } from './render.ts'
import { type Ev, newWorld, stepWorld, winnerOf, type World } from './rules.ts'

/** Seconds the crossing runs: the players pick the length on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: 45, min: 15, max: 120, step: 15 }

/** A crashed car spinning off the road (drawn as a timed tween, so the guest sees it too). */
export interface Wreck {
  side: Side
  x: number
  y: number
  /** Direction of the cross car that hit it. */
  dir: 1 | -1
  at: number
}

export interface State extends World {
  /** Go button pressed flags, so the online guest can draw them. */
  pressed: [boolean, boolean]
  wrecks: Wreck[]
  /** World time of each side's last car across (score pop) and last refused tap (button wobble). */
  scoredAt: [number, number]
  refusedAt: [number, number]
  /** World time the whistle blew (-1 while playing) and the outcome. */
  endAt: number
  winner: Side | 'draw' | null
}

class TrafficJam extends BaseGame<State> {
  private bots: (CrossBot | null)[] = [null, null]
  private buttons: Button[] = []
  private ev: Ev[] = []

  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.buttons = ([0, 1] as Side[]).map(
      (side) => new Button(side, GO_AT[side].x, GO_AT[side].y, GO_R, 'GO'),
    )
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new CrossBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      ...newWorld(ctx.rng.int(1, 0x7fffffff)),
      pressed: [false, false],
      wrecks: [],
      scoredAt: [-9, -9],
      refusedAt: [-9, -9],
      endAt: -1,
      winner: null,
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    const presses: [boolean, boolean] = [false, false]
    // Holding Go is the gas pedal for the cars already on the street.
    const gas: [boolean, boolean] = [false, false]
    for (const side of [0, 1] as Side[]) {
      const btn = this.buttons[side] as Button
      const bot = this.bots[side]
      if (bot?.decide(s, side, dt)) btn.press(1)
      if (bot?.gas(s, side)) btn.press(1)
      btn.update(ctx.input.player(side))
      presses[side] = btn.hit
      gas[side] = btn.pressed
      if (btn.pressed && !s.pressed[side] && s.racers[side].cars.length) ctx.audio.play('zap', 0.7)
      s.pressed[side] = btn.pressed
    }
    const before = Math.ceil(this.total - s.t)
    this.ev.length = 0
    stepWorld(s, dt, presses, this.ev, true, gas)
    for (const e of this.ev) this.feedback(e)
    s.wrecks = s.wrecks.filter((w) => s.t - w.at < 1.4)
    // Last seconds tick down out loud.
    const left = Math.ceil(this.total - s.t)
    if (left !== before && left <= 5 && left > 0) ctx.audio.play('tick', 1 + (5 - left) * 0.06)
    if (s.t >= this.total) this.end()
  }

  /** The whistle: the side with more cars across wins. */
  private end(): void {
    const s = this.s
    const { fx } = this.ctx
    const w = winnerOf(s)
    s.endAt = s.t
    s.winner = w
    this.ctx.audio.play('buzz')
    fx.flash(C.white, 0.3)
    fx.shake(0.3)
    if (w !== 'draw') fx.confetti(w)
    this.finish(w, { score: [s.racers[0].across, s.racers[1].across], delay: 2.4 })
  }

  /** Traffic keeps flowing during the ending. */
  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    stepWorld(this.s, dt, [false, false], this.ev, false)
    this.s.wrecks = this.s.wrecks.filter((w) => this.s.t - w.at < 1.4)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'launch':
        audio.play('whoosh', 0.9 + rng.next() * 0.2)
        fx.puff(e.x, e.y + (e.side === 0 ? 40 : -40), 'rgba(235,235,245,0.55)', 4)
        break
      case 'across':
        audio.play('coin', 1 + rng.next() * 0.08)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 16,
          speed: 320,
          size: 10,
          life: 0.5,
          gravity: 0,
          colors: [SIDE[e.side].light, C.yellow, C.white],
        })
        fx.sparks(e.x, e.y, C.yellow, 8)
        this.s.scoredAt[e.side] = this.s.t
        {
          // The point lands by the scorer's own score figure.
          const at = scoreAt(e.side, this.ctx.stage)
          fx.burst(at.x, at.y, SIDE[e.side].light, {
            count: 12,
            speed: 260,
            size: 9,
            life: 0.45,
            gravity: 0,
            colors: [SIDE[e.side].light, C.yellow, C.white],
          })
          floatFor(fx, e.side, '+1', at.x + 10, at.y + (e.side === 0 ? -110 : 110))
        }
        break
      case 'crash':
        this.s.wrecks.push({ side: e.side, x: e.x, y: e.y, dir: e.dir, at: this.s.t })
        audio.play('thud', 1.1)
        audio.play('explode', 1.2)
        audio.buzz(40)
        fx.burst(e.x, e.y, C.orange, {
          count: 26,
          speed: 520,
          size: 16,
          life: 0.6,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, C.white],
        })
        fx.burst(e.x, e.y, '#55506a', {
          count: 10,
          speed: 200,
          size: 26,
          life: 0.9,
          gravity: -60,
          drag: 2.5,
        })
        fx.ring(e.x, e.y, C.yellow, 170)
        fx.shake(0.45)
        fx.stop(5)
        fx.float('Crash!', e.x, e.y + (e.side === 0 ? -70 : 70), C.orange, 58, e.side)
        break
      case 'close':
        audio.play('whoosh', 1.4)
        audio.buzz(12)
        fx.sparks(e.x, e.y, C.yellow, 10)
        fx.float('Close one!', e.x, e.y + (e.side === 0 ? -80 : 80), C.yellow, 46, e.side)
        break
      case 'refuse':
        this.s.refusedAt[e.side] = this.s.t
        audio.play('error')
        audio.buzz(15)
        break
    }
  }

  render(g: Draw, alpha: number): void {
    renderJam(g, this.s, this.total - this.s.t, this.ctx.names, g.t, (1 - alpha) / 60)
  }
}

export default () => new TrafficJam()
