import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C } from '../../core/render/palette.ts'
import { FishBot } from './bot.ts'
import { renderFishing } from './render.ts'
import {
  type Ev,
  FISH,
  frenzyOf,
  LIMIT,
  NO_TAPS,
  type Rod,
  rodNew,
  rodStep,
  type Taps,
} from './rules.ts'

/** A height `d` units toward the middle of the table from world `y`, for `side`'s reader. */
const towardMid = (side: Side, y: number, d: number): number => (side === 0 ? y - d : y + d)

export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 15, max: 180, step: 15 }

export interface State {
  rods: [Rod, Rod]
  /** Game time the clock ran out (-1 while playing). */
  endAt: number
}

class UnfairFishing extends BaseGame<State> {
  private bots: [FishBot | null, FishBot | null] = [null, null]
  private lastSec = -1

  /** Match length chosen on the ready screen, in seconds. */
  private limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new FishBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [FishBot | null, FishBot | null]
    return { rods: [rodNew(), rodNew()], endAt: -1 }
  }

  protected step(dt: number): void {
    const { s, ctx } = this
    const sec = Math.max(0, Math.ceil(this.limit() - this.time))
    if (sec !== this.lastSec) {
      this.lastSec = sec
      if (sec > 0 && sec <= 5) ctx.audio.play('tick', 1 + (5 - sec) * 0.06)
    }
    if (this.time >= this.limit()) {
      const [a, b] = s.rods
      const winner = a.points === b.points ? 'draw' : a.points > b.points ? 0 : 1
      s.endAt = this.time
      ctx.fx.shake(0.25)
      if (winner !== 'draw') ctx.fx.confetti(winner)
      this.finish(winner, { score: [a.points, b.points], delay: 2.2 })
      return
    }
    // The feeding frenzy: announce it once, then bites come quicker and bigger.
    const late = frenzyOf(this.time, this.limit())
    if (late > 0 && frenzyOf(this.time - dt, this.limit()) === 0) {
      ctx.audio.play('powerup', 0.85)
      ctx.audio.buzz(25)
      ctx.fx.flash('#bfefff', 0.15)
      for (const side of [0, 1] as Side[]) floatFor(ctx.fx, side, 'Feeding frenzy!')
    }
    for (const side of [0, 1] as Side[]) {
      const rod = s.rods[side]
      const bot = this.bots[side]
      let inp: Taps = NO_TAPS
      if (bot) {
        inp = bot.act(rod, dt)
      } else {
        // Every press on this side's half counts: the first one casts, the rest hook and reel.
        const pi = ctx.input.player(side)
        const first = pi.downs[0]
        inp = {
          n: pi.downs.length,
          at: first ? frame(side, first.x, first.y) : null,
        }
      }
      this.emit(side, rod, rodStep(rod, dt, this.time, inp, ctx.rng, late))
    }
  }

  private emit(side: Side, rod: Rod, evs: Ev[]): void {
    const { ctx } = this
    const fx = ctx.fx
    const float = frame(side, rod.x, rod.y)
    for (const ev of evs) {
      switch (ev.k) {
        case 'cast':
          ctx.audio.play('swish', 0.9)
          fx.ring(float.x, float.y, C.white, 120)
          fx.burst(float.x, float.y, '#bfefff', {
            count: 10,
            speed: 220,
            size: 9,
            life: 0.5,
            gravity: 520,
          })
          break
        case 'reelin':
          ctx.audio.play('slide', 1.2)
          break
        case 'bite':
          ctx.audio.play('boing', 1.1)
          fx.ring(float.x, float.y, C.yellow, 260)
          fx.float('BITE!', float.x, towardMid(side, float.y, 90), C.yellow, 84, side)
          break
        case 'hook':
          ctx.audio.play('splash', 1.1)
          ctx.audio.play('pop', 0.8)
          fx.burst(float.x, float.y, '#bfefff', {
            count: 22,
            speed: 520,
            size: 12,
            life: 0.7,
            gravity: 900,
          })
          fx.ring(float.x, float.y, '#d8f6ff', 200)
          fx.float('Hooked!', float.x, towardMid(side, float.y, 150), C.white, 64, side)
          fx.stop(4)
          fx.shake(0.2)
          break
        case 'tug': {
          // The faster you mash, the higher the reel clicks and the more the water churns.
          const k = Math.min(1, rod.mash.rate / 10)
          ctx.audio.play('tap', 0.85 + k * 0.45)
          if (Math.random() < 0.3 + 0.5 * k)
            fx.puff(float.x, float.y, 'rgba(220,245,255,0.7)', Math.round(1 + k * 3))
          if (rod.mash.combo > 0 && rod.mash.combo % 10 === 0) ctx.audio.buzz(8)
          break
        }
        case 'surge': {
          ctx.audio.play('whoosh', 0.7)
          fx.shake(0.25)
          fx.burst(float.x, float.y, '#bfefff', {
            count: 14,
            speed: 360,
            size: 10,
            life: 0.5,
            gravity: 600,
          })
          break
        }
        case 'won': {
          const fish = FISH[ev.kind] as (typeof FISH)[number]
          ctx.audio.play('splash', 1.3)
          ctx.audio.play('coin', 1 + ev.value * 0.02)
          if (ev.value >= 6) {
            ctx.audio.play('powerup', 1)
            fx.shake(0.3)
            fx.stop(5)
          }
          fx.burst(float.x, float.y, C.yellow, {
            count: 18 + ev.value * 2,
            speed: 520,
            size: 12,
            life: 0.8,
            gravity: 500,
            colors: [C.yellow, C.white, '#bfefff'],
            kind: 'square',
          })
          floatFor(fx, side, `+${fish.value}`, float.x, towardMid(side, float.y, 120))
          if (ev.kind === FISH.length - 1) {
            fx.flash(C.yellow, 0.25)
            fx.confetti(side)
          }
          break
        }
        case 'lost': {
          if (ev.why === 'snap') {
            ctx.audio.play('slap', 0.8)
            ctx.audio.play('zap', 0.7)
            fx.shake(0.45)
            fx.stop(5)
            fx.flash(C.red, 0.2)
            fx.float('Snapped!', float.x, towardMid(side, float.y, 90), C.red, 76, side)
          } else if (ev.why === 'slack') {
            ctx.audio.play('buzz', 1.1)
            fx.float('Slack!', float.x, towardMid(side, float.y, 90), C.red, 76, side)
          } else {
            ctx.audio.play('error', 1)
            fx.float('Missed', float.x, towardMid(side, float.y, 90), C.red, 76, side)
          }
          fx.puff(float.x, float.y, 'rgba(220,245,255,0.6)', 5)
          break
        }
      }
    }
  }

  render(g: Draw): void {
    const { s, ctx } = this
    renderFishing(g, s.rods, this.time, {
      names: ctx.names,
      sec: Math.max(0, Math.ceil(this.limit() - this.time)),
      over: this.over,
      endAt: s.endAt,
    })
  }
}

export default () => new UnfairFishing()
