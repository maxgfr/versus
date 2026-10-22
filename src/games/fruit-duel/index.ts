import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { SliceBot } from './bot.ts'
import { renderDuel } from './render.ts'
import {
  BOMB,
  FRUITS,
  integrate,
  laneNew,
  laneStep,
  LIMIT,
  type Ev,
  type Lane,
  type Seg,
  schedule,
  type Throw,
  winnerOf,
} from './rules.ts'

export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 15, max: 180, step: 15 }

export interface State {
  lanes: [Lane, Lane]
  /** Game time the clock ran out (-1 while playing). */
  endAt: number
}

class FruitDuel extends BaseGame<State> {
  /** Same throws for both lanes: derived from the shared seed, never sent. */
  private sched: Throw[] = []
  private bots: [SliceBot | null, SliceBot | null] = [null, null]
  private lastSec = -1

  /** Match length chosen on the ready screen, in seconds. */
  private limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.sched = schedule(ctx.seed, this.limit())
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new SliceBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [SliceBot | null, SliceBot | null]
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
      if (w !== 'draw') ctx.fx.confetti(w)
      this.finish(w, { score: [a.score, b.score], delay: 2.2 })
      return
    }
    for (const side of [0, 1] as Side[]) {
      const lane = s.lanes[side]
      const paths: Seg[] = []
      const bot = this.bots[side]
      if (bot) {
        const seg = bot.step(lane, this.time, dt)
        if (seg) paths.push(seg)
      } else {
        // Every finger on this side's half cuts along the path it travelled this step.
        for (const p of ctx.input.player(side).held.values()) {
          const a = frame(side, p.px, p.py)
          const b = frame(side, p.x, p.y)
          paths.push([a.x, a.y, b.x, b.y])
        }
      }
      this.emit(side, laneStep(lane, dt, this.time, this.sched, paths))
    }
  }

  private emit(side: Side, evs: Ev[]): void {
    const { ctx } = this
    const fx = ctx.fx
    for (const ev of evs) {
      const p = frame(side, ev.x, ev.y)
      if (ev.k === 'launch') {
        ctx.audio.play('whoosh', 0.9 + Math.random() * 0.2)
        continue
      }
      if (ev.kind === BOMB) {
        ctx.audio.play('explode')
        ctx.audio.play('error', 0.8)
        fx.shake(0.75)
        fx.stop(8)
        fx.flash(C.orange, 0.35)
        fx.burst(p.x, p.y, '#2b2338', {
          count: 26,
          speed: 620,
          size: 22,
          life: 0.9,
          gravity: -80,
          drag: 2.5,
        })
        fx.burst(p.x, p.y, C.orange, {
          count: 26,
          speed: 900,
          size: 8,
          life: 0.5,
          kind: 'spark',
          colors: [C.orange, C.yellow, C.red],
        })
        fx.ring(p.x, p.y, C.yellow, 260)
        fx.ring(p.x, p.y, C.red, 380)
        fx.float(`${ev.value}`, p.x, p.y, C.red, 96, side)
        continue
      }
      const juice = (FRUITS[ev.kind] as (typeof FRUITS)[number]).juice
      // A faster blade: higher swish, a wider spray, a little kick.
      const k = ev.force
      ctx.audio.play('swish', 0.9 + ev.value * 0.05 + k * 0.35)
      ctx.audio.play('pop', 1 + Math.random() * 0.15)
      fx.burst(p.x, p.y, juice, {
        count: Math.round(16 + k * 16),
        speed: 520 + k * 420,
        size: 13,
        life: 0.6,
        gravity: 1100,
        drag: 2.2,
      })
      fx.burst(p.x, p.y, juice, {
        count: Math.round(6 + k * 8),
        speed: 800 + k * 500,
        size: 6,
        life: 0.3,
        kind: 'spark',
      })
      if (k > 0.55) {
        fx.shake(0.05 + k * 0.08)
        ctx.audio.buzz(Math.round(6 + k * 8))
      }
      fx.burst(p.x, p.y, '#ffffff', { count: 5, speed: 380, size: 6, life: 0.3, kind: 'spark' })
      fx.ring(p.x, p.y, juice, 120)
      floatFor(fx, side, `+${ev.value}`, p.x, p.y)
      if (ev.bonus > 0) {
        ctx.audio.play('powerup', 1 + ev.bonus * 0.08)
        fx.stop(3)
        fx.shake(0.15)
        const c = frame(side, W / 2, MID + 300)
        fx.float(`COMBO x${ev.cut}  +${ev.bonus}`, c.x, c.y, C.yellow, 76, side)
      }
    }
  }

  /** Whatever is still in the air falls away while the ending plays. */
  protected override afterEnd(dt: number): void {
    for (const lane of this.s.lanes) integrate(lane, dt, this.time)
  }

  render(g: Draw, alpha = 1): void {
    const { s, ctx } = this
    renderDuel(g, s.lanes, this.time, {
      back: this.over ? 0 : (1 - alpha) / 60,
      names: ctx.names,
      sec: Math.max(0, Math.ceil(this.limit() - this.time)),
      over: this.over,
      endAt: s.endAt,
    })
  }
}

export default () => new FruitDuel()
