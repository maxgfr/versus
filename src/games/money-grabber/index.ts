import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C } from '../../core/render/palette.ts'
import { CatchBot } from './bot.ts'
import { renderMoney } from './render.ts'
import {
  BASKET_SPEED,
  BASKET_Y,
  type Drop,
  type Ev,
  type Lane,
  LIMIT,
  laneNew,
  laneStep,
  schedule,
  winnerOf,
} from './rules.ts'

/** A height `d` units toward the middle of the table from world `y`, for `side`'s reader. */
const towardMid = (side: Side, y: number, d: number): number => (side === 0 ? y - d : y + d)

export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 15, max: 180, step: 15 }

export interface State {
  lanes: [Lane, Lane]
  /** Game time the clock ran out (-1 while playing). */
  endAt: number
}

class MoneyGrabber extends BaseGame<State> {
  /** The same rain for both lanes: derived from the shared seed, never sent. */
  private sched: Drop[] = []
  private bots: [CatchBot | null, CatchBot | null] = [null, null]
  private lastSec = -1

  /** Match length chosen on the ready screen, in seconds. */
  private limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.sched = schedule(ctx.seed, this.limit())
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new CatchBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [CatchBot | null, CatchBot | null]
    return { lanes: [laneNew(), laneNew()], endAt: -1 }
  }

  protected step(dt: number): void {
    const { s, ctx } = this
    const sec = Math.max(0, Math.ceil(this.limit() - this.time))
    if (sec !== this.lastSec) {
      this.lastSec = sec
      if (sec > 0 && sec <= 5) ctx.audio.play('tick', 1 + (5 - sec) * 0.06)
    }
    if (this.time >= this.limit()) {
      const [a, b] = s.lanes
      const w = winnerOf([a.score, b.score])
      s.endAt = this.time
      ctx.fx.shake(0.25)
      if (w !== 'draw') {
        ctx.fx.confetti(w)
        const p = frame(
          w,
          a.basket * (w === 0 ? 1 : 0) + b.basket * (w === 1 ? 1 : 0),
          BASKET_Y - 80,
        )
        ctx.fx.burst(p.x, p.y, '#ffc83d', {
          count: 30,
          speed: 700,
          size: 12,
          life: 1,
          kind: 'square',
        })
      }
      this.finish(w, { score: [a.score, b.score], delay: 2.2 })
      return
    }
    for (const side of [0, 1] as Side[]) {
      const lane = s.lanes[side]
      const bot = this.bots[side]
      let target: number | null = null
      let speed = BASKET_SPEED
      if (bot) {
        target = bot.step(lane, dt)
        speed = bot.speed
      } else {
        // The basket follows the finger along this side's edge.
        for (const p of ctx.input.player(side).held.values()) {
          target = frame(side, p.x, p.y).x
          break
        }
      }
      this.emit(side, laneStep(lane, dt, this.time, this.sched, target, speed))
    }
  }

  private emit(side: Side, evs: Ev[]): void {
    const { ctx } = this
    const fx = ctx.fx
    for (const ev of evs) {
      if (ev.k === 'drop') continue
      const p = frame(side, ev.x, ev.y)
      if (ev.k === 'catch') {
        if (ev.kind === 1) {
          // Bills rustle, and sound brighter than coins.
          ctx.audio.play('coin', 1.25)
          fx.burst(p.x, p.y, C.green, { count: 12, speed: 320, size: 9, life: 0.5, gravity: 500 })
        } else if (ev.kind === 2) {
          ctx.audio.play('powerup', 1.2)
          ctx.audio.play('coin', 0.9)
          fx.shake(0.15)
          fx.burst(p.x, p.y, '#ffc83d', {
            count: 22,
            speed: 480,
            size: 11,
            life: 0.7,
            gravity: 600,
          })
          fx.sparks(p.x, p.y, '#ffffff', 10)
          fx.stop(2)
        } else {
          ctx.audio.play('coin', 1 + Math.random() * 0.1)
          fx.burst(p.x, p.y, '#ffc83d', { count: 8, speed: 260, size: 8, life: 0.45, gravity: 600 })
        }
        fx.ring(p.x, towardMid(side, p.y, 60), '#ffc83d', 90 + ev.value * 8)
        floatFor(fx, side, `+$${ev.value}`, p.x, towardMid(side, p.y, 200))
        if (ev.dive) {
          // A diving catch: the basket was flying. Sparks trail off its slide.
          ctx.audio.play('swish', 1.2 + ev.speed * 0.3)
          ctx.audio.buzz(12)
          fx.shake(0.08 + ev.speed * 0.1)
          fx.sparks(p.x, p.y, '#ffffff', Math.round(6 + ev.speed * 10))
          fx.float('DIVE!', p.x, towardMid(side, p.y, 300), C.yellow, 48, side)
        }
        continue
      }
      // A bomb: it costs points, shakes the table and stuns the basket.
      ctx.audio.play('explode', 1.1)
      ctx.audio.play('buzz', 0.8)
      fx.shake(0.5)
      fx.stop(6)
      fx.flash(C.red, 0.2)
      fx.burst(p.x, p.y, '#2b2338', {
        count: 22,
        speed: 520,
        size: 20,
        life: 0.8,
        gravity: -60,
        drag: 2.5,
      })
      fx.burst(p.x, p.y, C.orange, {
        count: 22,
        speed: 760,
        size: 7,
        life: 0.45,
        kind: 'spark',
        colors: [C.orange, C.yellow, C.red],
      })
      fx.ring(p.x, p.y, C.orange, 240)
      fx.float(`${ev.value}`, p.x, towardMid(side, p.y, 120), C.red, 84, side)
    }
  }

  /** What is still falling keeps falling (uncaught) while the ending plays. */
  protected override afterEnd(dt: number): void {
    for (const l of this.s.lanes) {
      for (const it of l.items) it.y += it.vy * dt
    }
  }

  render(g: Draw, alpha = 1): void {
    const { s, ctx } = this
    renderMoney(g, s.lanes, this.time, {
      back: this.over ? 0 : (1 - alpha) / 60,
      names: ctx.names,
      sec: Math.max(0, Math.ceil(this.limit() - this.time)),
      over: this.over,
      endAt: s.endAt,
    })
  }
}

export default () => new MoneyGrabber()
