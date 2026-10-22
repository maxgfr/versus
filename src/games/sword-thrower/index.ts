import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import { clock, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { Bot } from './bot.ts'
import { drawFuse, drawScore, drawTimeUp, render } from './render.ts'
import { advance, coast, type Event, leader, MATCH, newState, type State } from './rules.ts'

type Game = State & { endAt: number }

/** Seconds the match lasts; the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: MATCH, min: 15, max: 180, step: 15 }

class SwordThrower extends BaseGame<Game> {
  private bots: [Bot | null, Bot | null] = [null, null]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): Game {
    const rng = this.ctx.rng
    this.bots = [0, 1].map((side) =>
      this.isBot(side as Side) ? new Bot(this.ctx.difficulty, rng.fork()) : null,
    ) as [Bot | null, Bot | null]
    return { ...newState(rng, this.target), endAt: -1 }
  }

  protected step(dt: number): void {
    const want: [boolean, boolean] = [false, false]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      want[side] = bot ? bot.tick(this.s, side, dt) : this.ctx.input.player(side).downs.length > 0
    }
    for (const e of advance(this.s, dt, want)) this.juice(e)
    if (this.s.left <= 0) this.whistle()
  }

  /** Time up: the horn, a flash, confetti from the winner's end, then the result. */
  private whistle(): void {
    const { fx, audio } = this.ctx
    const s = this.s
    s.endAt = this.time
    const w = leader(s)
    audio.play('buzz', 0.8)
    audio.buzz(60)
    fx.flash(C.white, 0.35)
    fx.shake(0.35)
    if (w !== null) fx.confetti(w)
    this.finish(w ?? 'draw', {
      score: [s.score[0], s.score[1]],
      note: w === null ? 'Even' : `${w === 0 ? 'Red' : 'Blue'} stuck the most swords`,
      delay: 2.4,
    })
  }

  protected override afterEnd(dt: number): void {
    coast(this.s, dt)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'throw':
        audio.play('swish', 0.9 + this.ctx.rng.range(0, 0.2))
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.45)', 4)
        return
      case 'stick': {
        const col = SIDE[e.side].main
        // A streak of sticks climbs in pitch and kicks harder each time.
        const k = Math.min(1, (e.streak - 1) / 5)
        audio.play('hit', Math.min(1.7, 1 + e.count * 0.04))
        audio.play('coin', Math.min(1.8, 1 + e.streak * 0.08))
        audio.buzz(Math.round(12 + k * 18))
        if (e.streak >= 3)
          fx.float(
            `${e.streak} in a row!`,
            e.x,
            e.y + (e.side === 0 ? 120 : -120),
            C.yellow,
            46,
            e.side,
          )
        fx.burst(e.x, e.y, col, {
          count: 18,
          speed: 560,
          size: 12,
          life: 0.45,
          gravity: 0,
          drag: 3,
          colors: [col, C.white, C.yellow],
        })
        // Wood chips off the face.
        fx.burst(e.x, e.y, C.cream, {
          count: 8,
          speed: 380,
          size: 9,
          life: 0.5,
          gravity: 0,
          drag: 2.5,
          kind: 'square',
          colors: [C.cream, '#e2c9a0', SIDE[other(e.side)].light],
        })
        fx.sparks(e.x, e.y, C.yellow, Math.round(10 + k * 12))
        fx.ring(e.x, e.y, SIDE[e.side].light, 110 + k * 80)
        fx.shake(0.18 + k * 0.15)
        fx.stop(Math.round(3 + k * 2))
        floatFor(fx, e.side, '+1', e.x, e.y)
        return
      }
      case 'clang':
        audio.play(e.own ? 'wall' : 'bounce', e.own ? 1 : 1.6)
        audio.play('zap', 1.8)
        fx.sparks(e.x, e.y, '#ffffff', 14)
        fx.sparks(e.x, e.y, C.yellow, 6)
        fx.shake(0.12)
        fx.stop(2)
        fx.float(e.own ? 'Ouch!' : 'Clang!', e.x, e.y, SIDE[e.side].light, 54, e.side)
        return
      case 'clear':
        audio.play('powerup', 1.1)
        audio.play('explode', 1.4)
        audio.buzz(40)
        fx.burst(e.x, e.y, C.yellow, {
          count: 30,
          speed: 720,
          size: 13,
          life: 0.8,
          gravity: 0,
          drag: 2.4,
          kind: 'square',
          colors: [C.yellow, C.white, C.orange],
        })
        fx.ring(e.x, e.y, C.yellow, 300)
        fx.flash(C.yellow, 0.18)
        fx.shake(0.35)
        fx.stop(5)
        fx.float('Full shield!', e.x, e.y, C.yellow, 60, other(e.shield))
        return
      case 'miss':
        audio.play('whoosh', 1.4)
        return
      case 'frenzy':
        audio.play('powerup', 0.8)
        audio.buzz(30)
        fx.flash(C.orange, 0.15)
        for (const side of [0, 1] as Side[]) floatFor(fx, side, 'Frenzy! Quick reload')
        return
      case 'tick':
        audio.play(e.left <= 3 ? 'count' : 'tick', e.left <= 3 ? 1.2 : 1)
        return
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    render(g, s, this.time, s.endAt, [!this.isBot(0), !this.isBot(1)], (1 - alpha) / 60)
    drawFuse(g, s, this.time)
    const w = s.left <= 0 ? leader(s) : null
    for (const side of [0, 1] as Side[]) {
      namePill(g, side, this.ctx.names[side], { active: w === side })
      drawScore(g, s, side, w === side, this.time)
    }
    if (s.left > 0) clock(g, s.left, MID)
    drawTimeUp(g, s.endAt >= 0 ? this.time - s.endAt : 0)
  }
}

export default () => new SwordThrower()
