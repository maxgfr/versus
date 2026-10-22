import { BaseGame, other, STEP, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { TongueBot } from './bot.ts'
import { renderField } from './render.ts'
import {
  flickSpeed,
  FRENZY,
  GAME_TIME,
  mouth,
  OUT_SPEED,
  padAt,
  POINTS,
  reelIn,
  scoresOf,
  stepFlies,
  stepWorld,
  timeLeft,
  tipOf,
  winnerOf,
  worldNew,
  type FieldEvent,
  type World,
} from './rules.ts'

/** A press this close to your frog's mouth starts a flick (drag and release) instead of a tap. */
const FLICK_GRAB = 260
/** A flick must travel this far to count. */
const FLICK_MIN = 60

/** Match length in seconds: the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: GAME_TIME, min: 20, max: 120, step: 10 }

export interface State extends World {
  /** Game time the clock ran out (-1 while playing): drives the ending tweens. */
  endAt: number
}

class StickyTongues extends BaseGame<State> {
  private bots: [TongueBot | null, TongueBot | null] = [null, null]
  /** Last whole second announced on the countdown. */
  private lastTick = -1
  private frenzy = false
  // Cosmetic only (not synced): tongue lengths at the last step, for interpolation.
  private prevLen: [number, number] = [0, 0]

  /** Seconds the match lasts. */
  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new TongueBot(ctx.rng.fork(), ctx.difficulty, side as Side) : null,
    ) as [TongueBot | null, TongueBot | null]
    return { ...worldNew(ctx.rng), endAt: -1 }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.prevLen = [s.frogs[0].tongue.len, s.frogs[1].tongue.len]
    for (const side of [0, 1] as Side[]) {
      const f = s.frogs[side]
      const bot = this.bots[side]
      if (bot) {
        const aim = bot.step(this.time, s)
        if (aim) f.queue = { x: aim.x, y: aim.y, t: this.time, speed: aim.speed }
        continue
      }
      const inp = ctx.input.player(side)
      const m = mouth(side)
      // A press near your frog is a flick: drag toward a fly and let go, the
      // harder the flick the faster the tongue. Any other press aims a tap.
      for (const p of inp.ups) {
        if (Math.hypot(p.x0 - m.x, p.y0 - m.y) > FLICK_GRAB) continue
        const dx = p.x - p.x0
        const dy = p.y - p.y0
        const d = Math.hypot(dx, dy)
        if (d < FLICK_MIN) continue
        const v = d / Math.max(STEP, this.time - p.t0)
        f.queue = {
          x: m.x + (dx / d) * 600,
          y: m.y + (dy / d) * 600,
          t: this.time,
          speed: flickSpeed(v),
        }
      }
      const downs = inp.downs.filter((p) => Math.hypot(p.x - m.x, p.y - m.y) > FLICK_GRAB)
      const p = downs[downs.length - 1]
      if (!p) continue
      f.queue = { x: p.x, y: p.y, t: this.time }
      tapRipple(ctx, side, p.x, p.y)
    }

    // The last seconds are a frenzy: more flies, faster, more golden ones.
    const frenzy = timeLeft(this.time, this.total) <= FRENZY
    if (frenzy && !this.frenzy) {
      ctx.audio.play('powerup', 1.1)
      ctx.fx.flash(C.yellow, 0.15)
      floatFor(ctx.fx, 0, 'Frenzy!')
      floatFor(ctx.fx, 1, 'Frenzy!')
    }
    this.frenzy = frenzy
    for (const e of stepWorld(s, dt, ctx.rng, this.time, frenzy)) this.onEvent(e)

    const sec = Math.ceil(timeLeft(this.time, this.total))
    if (sec !== this.lastTick && sec <= 5 && sec > 0) {
      this.lastTick = sec
      if (sec <= 3) ctx.audio.play('count', sec === 1 ? 1.2 : 1)
      else ctx.audio.play('tick', 1.1)
    }
    if (this.time >= this.total) this.end()
  }

  /** The buzzer: freeze the frogs, crown the winner's pad, then the result screen. */
  private end(): void {
    const s = this.s
    const { fx, audio } = this.ctx
    s.endAt = this.time
    const w = winnerOf(s)
    audio.play('buzz', 0.8)
    fx.flash(C.white, 0.35)
    fx.shake(0.35)
    fx.stop(8)
    if (w !== 'draw') {
      const p = padAt(w)
      fx.ring(p.x, p.y, SIDE[w].light, 320)
      fx.burst(p.x, p.y, C.yellow, {
        count: 30,
        speed: 760,
        size: 12,
        kind: 'spark',
        colors: [C.yellow, C.white, SIDE[w].light],
      })
      fx.float('🏆', p.x, p.y + (w === 0 ? -200 : 200), C.white, 110, w)
    }
    fx.confetti(w === 'draw' ? undefined : w)
    this.finish(w, { score: scoresOf(s), delay: 2.4 })
  }

  private onEvent(e: FieldEvent): void {
    const { fx, audio } = this.ctx
    const s = this.s
    const col = SIDE[e.side].light
    switch (e.kind) {
      case 'shot': {
        // A hard flick cracks out: higher, brighter, a buzz.
        const k = Math.max(0, (s.frogs[e.side].tongue.speed - OUT_SPEED) / 1000)
        audio.play('whoosh', (e.side === 0 ? 1.15 : 0.95) + k * 0.3)
        if (k > 0.4) audio.buzz(8)
        fx.burst(e.x, e.y, col, {
          count: 6 + Math.round(k * 10),
          speed: 220 + k * 300,
          size: 8,
          life: 0.3,
          kind: 'spark',
        })
        break
      }
      case 'catch': {
        const pts = e.golden ? POINTS.golden : POINTS.plain
        // Snatched from under the other frog's tongue, or from across the midline?
        const rival = s.frogs[other(e.side)].tongue
        const rt = rival.phase === 'out' ? tipOf(other(e.side), rival) : null
        const across = e.side === 0 ? e.y < MID : e.y > MID
        const snatched = across || (rt !== null && Math.hypot(rt.x - e.x, rt.y - e.y) < 220)
        if (e.golden) {
          fx.burst(e.x, e.y, C.yellow, {
            count: 30,
            speed: 620,
            size: 13,
            kind: 'spark',
            colors: [C.yellow, C.white, C.orange],
          })
          fx.ring(e.x, e.y, C.yellow, 240)
          fx.shake(0.28)
          fx.flash(C.yellow, 0.18)
          fx.stop(4)
          audio.play('coin', 1.1)
          audio.play('powerup', 1.2)
        } else {
          fx.burst(e.x, e.y, C.white, { count: 12, speed: 380, size: 9, kind: 'spark' })
          fx.burst(e.x, e.y, col, { count: 6, speed: 240, size: 10, life: 0.4, gravity: 0 })
          fx.ring(e.x, e.y, col, 120)
          fx.stop(2)
          audio.play('pop', 1 + (Math.random() - 0.5) * 0.16)
        }
        const dir = e.side === 0 ? -1 : 1
        fx.float(
          `+${pts}`,
          e.x,
          e.y + dir * 74,
          e.golden ? C.yellow : col,
          e.golden ? 100 : 72,
          e.side,
        )
        if (snatched) {
          fx.float('Snatched!', e.x, e.y + dir * 150, C.white, 54, e.side)
          audio.play('slap', 1.2)
        }
        break
      }
      case 'eat':
        fx.puff(e.x, e.y, alpha(C.white, 0.7), 6)
        fx.burst(e.x, e.y, SIDE[e.side].main, { count: 8, speed: 260, size: 9, life: 0.35 })
        fx.shake(e.golden ? 0.18 : 0.06)
        audio.play('chomp', e.golden ? 1.2 : 1)
        if (e.golden) audio.play('score', 1.1)
        break
      case 'miss':
        fx.puff(e.x, e.y, alpha(C.white, 0.3), 3)
        break
    }
  }

  protected override afterEnd(dt: number): void {
    this.prevLen = [this.s.frogs[0].tongue.len, this.s.frogs[1].tongue.len]
    stepFlies(this.s, dt, this.ctx.rng)
    reelIn(this.s, dt)
  }

  render(g: Draw, a: number): void {
    renderField(g, this.s, this.time, {
      alpha: a,
      prevLen: this.prevLen,
      frenzy: this.s.endAt < 0 && timeLeft(this.time, this.total) <= FRENZY,
      names: this.ctx.names,
      left: timeLeft(this.time, this.total),
      total: this.total,
      endAt: this.s.endAt,
    })
  }
}

export default () => new StickyTongues()
