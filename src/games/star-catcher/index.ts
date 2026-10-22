import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C } from '../../core/render/palette.ts'
import { StarBot } from './bot.ts'
import { renderSky } from './render.ts'
import {
  BASKET_SPEED,
  BASKET_Y,
  COMET,
  type Drop,
  type Ev,
  GOLD,
  LIMIT,
  SHOWER,
  STAR,
  type Sky,
  schedule,
  skyNew,
  skyStep,
  winnerOf,
} from './rules.ts'

/** A height `d` units toward the middle of the table from world `y`, for `side`'s reader. */
const towardMid = (side: Side, y: number, d: number): number => (side === 0 ? y - d : y + d)

export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 20, max: 120, step: 10 }

export interface State {
  skies: [Sky, Sky]
  /** Game time the clock ran out (-1 while playing). */
  endAt: number
}

class StarCatcher extends BaseGame<State> {
  /** The same pattern for both skies: derived from the shared seed, never sent. */
  private sched: Drop[] = []
  private bots: [StarBot | null, StarBot | null] = [null, null]
  private lastSec = -1
  // Cosmetic only (not synced): last step's basket spots, for interpolation.
  private prevBasket: [number, number] | null = null

  /** Match length chosen on the ready screen, in seconds. */
  private limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.sched = schedule(ctx.seed, this.limit())
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new StarBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [StarBot | null, StarBot | null]
    return { skies: [skyNew(), skyNew()], endAt: -1 }
  }

  protected step(dt: number): void {
    const { s, ctx } = this
    const sec = Math.max(0, Math.ceil(this.limit() - this.time))
    if (sec !== this.lastSec) {
      this.lastSec = sec
      if (sec > 0 && sec <= 5) ctx.audio.play('tick', 1 + (5 - sec) * 0.06)
    }
    // The star shower starts: tell both players.
    const shower = this.limit() * (1 - SHOWER)
    if (this.time - dt < shower && this.time >= shower) {
      ctx.audio.play('powerup', 0.8)
      ctx.audio.buzz(20)
      ctx.fx.flash('#fff3b8', 0.15)
      for (const side of [0, 1] as Side[]) floatFor(ctx.fx, side, 'Star shower!')
    }
    this.prevBasket = [s.skies[0].basket, s.skies[1].basket]
    if (this.time >= this.limit()) {
      const [a, b] = s.skies
      const w = winnerOf([a.score, b.score])
      s.endAt = this.time
      ctx.fx.shake(0.2)
      if (w !== 'draw') {
        ctx.fx.confetti(w)
        const p = frame(w, s.skies[w].basket, BASKET_Y - 60)
        ctx.fx.burst(p.x, p.y, '#ffc93c', {
          count: 30,
          speed: 700,
          size: 9,
          life: 1,
          kind: 'spark',
          colors: ['#ffc93c', '#ffffff', '#fff3b8'],
        })
      }
      this.finish(w, { score: [a.score, b.score], delay: 2.2 })
      return
    }
    for (const side of [0, 1] as Side[]) {
      const sky = s.skies[side]
      const bot = this.bots[side]
      let target: number | null = null
      let speed = BASKET_SPEED
      if (bot) {
        target = bot.step(sky, dt)
        speed = bot.speed
      } else {
        // The basket follows the finger along this side's edge.
        for (const p of ctx.input.player(side).held.values()) {
          target = frame(side, p.x, p.y).x
          break
        }
      }
      this.emit(side, skyStep(sky, dt, this.time, this.sched, target, speed))
    }
  }

  private emit(side: Side, evs: Ev[]): void {
    const { ctx } = this
    const fx = ctx.fx
    for (const ev of evs) {
      if (ev.k === 'drop') continue
      const p = frame(side, ev.x, ev.y)
      if (ev.k === 'miss') {
        // Only the valuable ones get a groan; plain stars just fade.
        if (ev.kind !== STAR) {
          ctx.audio.play('swish', 0.7)
          fx.puff(p.x, p.y, 'rgba(255,255,255,0.35)', 4)
        }
        continue
      }
      // The chime climbs with the streak; every fifth in a row gets a call-out.
      const up = Math.min(0.6, ev.streak * 0.04)
      if (ev.streak >= 5 && ev.streak % 5 === 0) {
        fx.float(`${ev.streak} in a row!`, p.x, towardMid(side, p.y, 320), '#fff3b8', 48, side)
        ctx.audio.play('coin', 1.8)
        fx.ring(p.x, p.y, C.yellow, 240)
      }
      ctx.audio.buzz(Math.round(6 + ev.points * 6))
      if (ev.kind === GOLD) {
        ctx.audio.play('powerup', 1.05 + up)
        fx.burst(p.x, p.y, '#ffd23f', {
          count: 24,
          speed: 520,
          size: 10,
          life: 0.8,
          gravity: 240,
          colors: ['#ffd23f', '#ffffff', '#fff3b8'],
          kind: 'spark',
        })
        fx.stop(3)
        fx.shake(0.12)
        fx.ring(p.x, p.y, '#ffd23f', 200)
      } else if (ev.kind === COMET) {
        ctx.audio.play('whoosh', 1.2)
        ctx.audio.play('coin', 1.5 + up)
        fx.shake(0.1)
        fx.burst(p.x, p.y, '#bfefff', { count: 20, speed: 480, size: 12, life: 0.6, gravity: 120 })
        fx.ring(p.x, p.y, C.cyan, 160)
      } else if (ev.kind === STAR) {
        ctx.audio.play('coin', 1.3 + up)
        fx.burst(p.x, p.y, '#fff3b8', {
          count: 12,
          speed: 340,
          size: 6,
          life: 0.5,
          gravity: 300,
          kind: 'spark',
        })
        fx.ring(p.x, p.y, '#fff3b8', 110)
      }
      floatFor(fx, side, `+${ev.points}`, p.x, towardMid(side, p.y, 200))
    }
  }

  /** What is still falling keeps falling (uncaught) while the ending plays. */
  protected override afterEnd(dt: number): void {
    for (const l of this.s.skies) {
      for (const it of l.items) it.y += it.vy * dt
    }
  }

  render(g: Draw, alpha: number): void {
    const { s, ctx } = this
    const pb = this.prevBasket
    renderSky(g, s.skies, this.time, {
      names: ctx.names,
      sec: Math.max(0, Math.ceil(this.limit() - this.time)),
      over: this.over,
      endAt: s.endAt,
      lag: (1 - alpha) / 60,
      basket: pb
        ? [lerp(pb[0], s.skies[0].basket, alpha), lerp(pb[1], s.skies[1].basket, alpha)]
        : [s.skies[0].basket, s.skies[1].basket],
      human: [!this.isBot(0), !this.isBot(1)],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevBasket = null
  }
}

export default () => new StarCatcher()
