import { floatFor } from '../../core/fx/fx.ts'
import { lerp, prog, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { type Drag, type Look, render } from './render.ts'
import {
  type Ball,
  type Event,
  FLICK_FAST,
  FLICK_SLOW,
  hoopAt,
  newWorld,
  over,
  shoot,
  step,
  swipeOK,
  winner,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** The swipe each player is making right now (for the preview), null when none. */
  drag: [Drag | null, Drag | null]
  /** Baskets that touched nothing but net count as swishes (for the call-out). */
  clean: [boolean, boolean]
  /** Set once the match is decided: the outcome and when (this.time). */
  end: { winner: Side | 'draw'; at: number } | null
}

/** Seconds on the clock; most baskets wins. */
export const match: MatchSpec = { unit: 'seconds', default: 45, min: 15, max: 180, step: 15 }

class BasketBall extends BaseGame<State> {
  private mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): last step's balls, for interpolation.
  private prev: Ball[] | null = null
  private lastTick = -1
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private squash: [Spring, Spring] = [new Spring(1, 420, 13), new Spring(1, 420, 13)]
  private trail: [{ x: number; y: number; z: number }[], { x: number; y: number; z: number }[]] = [
    [],
    [],
  ]
  private wasEnded = false
  /** Each side's finger speed (world units/s), smoothed: a flick's speed sets the shot's tempo. */
  private vel: [number, number] = [0, 0]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      w: newWorld(this.target, this.ctx.rng),
      drag: [null, null],
      clean: [true, true],
      end: null,
    }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = w.balls.map((b) => ({ ...b }))
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        this.s.drag[side] = null
        const sw = decide(w, side, this.ctx.difficulty, this.ctx.rng, this.mem[side], dt)
        if (sw) this.launch(side, sw.dx, sw.dy, sw.len, sw.flick)
        continue
      }
      const inp = this.ctx.input.player(side)
      const f = inp.first() ?? inp.ups[0]
      // The finger's speed over the last few steps: the flick at release, not the swipe's average.
      if (f) {
        const v = Math.hypot(f.x - f.px, f.y - f.py) / dt
        this.vel[side] = Math.max(v, lerp(this.vel[side], v, 0.35))
      } else this.vel[side] = 0
      // A finished swipe is a shot: from where the finger went down to where it came up.
      for (const p of inp.ups) {
        const dx = p.x - p.x0
        const dy = p.y - p.y0
        const len = Math.hypot(dx, dy)
        if (len > 0 && swipeOK(side, dy, len))
          this.launch(side, dx / len, dy / len, len, this.vel[side])
      }
      const p = inp.first()
      this.s.drag[side] = p ? { x0: p.x0, y0: p.y0, x: p.x, y: p.y, v: this.vel[side] } : null
    }
    for (const e of step(w, dt, this.ctx.rng)) this.juice(e)
    const sec = Math.ceil(w.left)
    if (!w.ended && sec <= 5 && sec !== this.lastTick) {
      this.lastTick = sec
      this.ctx.audio.play('tick', sec <= 3 ? 1.3 : 1)
    }
    if (w.ended && !this.wasEnded) {
      // The buzzer: the clock is out (or a sudden-death basket settled it).
      this.wasEnded = true
      this.ctx.audio.play('buzz')
      this.ctx.fx.flash(C.white, 0.18)
    }
    if (!this.over && over(w)) {
      const won = winner(w)
      this.s.end = { winner: won, at: this.time }
      this.finish(won, { score: [w.score[0], w.score[1]], delay: 2.2 })
      const { fx } = this.ctx
      if (won === 'draw') fx.flash(C.yellow, 0.2)
      else {
        fx.flash(SIDE[won].main, 0.3)
        fx.confetti(won)
        fx.shake(0.35)
      }
    }
  }

  private launch(side: Side, dx: number, dy: number, len: number, flick: number): void {
    const w = this.s.w
    const b = w.balls[side]
    const x = b.x
    const y = b.y
    if (!shoot(w, side, dx, dy, len, flick)) return
    const k = prog(flick, FLICK_SLOW, FLICK_FAST)
    this.s.drag[side] = null
    this.s.clean[side] = true
    this.ctx.audio.play('whoosh', 0.9 + k * 0.5 + len / 4000)
    this.ctx.fx.puff(x, y, 'rgba(255,236,210,0.45)', Math.round(5 + k * 7))
    if (k > 0.6) {
      // A snappy flick kicks dust back toward the shooter.
      this.ctx.fx.burst(x, y, C.white, {
        count: Math.round(4 + k * 8),
        speed: 380 + k * 300,
        size: 6,
        life: 0.3,
        gravity: 0,
        spread: 0.9,
        dir: Math.atan2(-dy, -dx),
        kind: 'spark',
      })
      this.ctx.audio.buzz(8)
    }
    this.squash[side].set(1)
    this.squash[side].kick(3 + k * 4)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'rim') {
      const k = Math.min(1, e.speed / 900)
      audio.play('hit', 0.9 + k * 0.5)
      fx.sparks(e.x, e.y, C.orange, Math.round(4 + k * 10))
      fx.shake(0.05 + k * 0.14)
      if (k > 0.6) fx.stop(2)
      audio.buzz(Math.round(6 + k * 10))
      this.squash[e.side].kick(-2 - k * 3)
      this.s.clean[e.side] = false
    } else if (e.kind === 'board') {
      const k = Math.min(1, e.speed / 1200)
      this.s.clean[e.side] = false
      audio.play('thud', 0.95 + k * 0.4)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.6)', Math.round(4 + k * 6))
      fx.shake(0.06 + k * 0.12)
      audio.buzz(Math.round(6 + k * 8))
      this.squash[e.side].kick(-2 - k * 4)
    } else if (e.kind === 'swish') {
      const col = SIDE[e.side]
      const hoop = hoopAt(e.side)
      audio.play('swish')
      audio.play('coin', 1.05)
      fx.stop(3)
      fx.burst(hoop.x, hoop.y, col.main, {
        count: 26,
        speed: 480,
        size: 12,
        life: 0.9,
        gravity: 300,
        drag: 1.8,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(hoop.x, hoop.y, col.light, 170)
      const clean = this.s.clean[e.side]
      floatFor(
        fx,
        e.side,
        clean ? 'SWISH!' : '+1',
        W / 2,
        e.side === 0 ? hoop.y + 170 : hoop.y - 170,
      )
      if (clean) {
        fx.shake(0.15)
        fx.burst(hoop.x, hoop.y, C.yellow, {
          count: 12,
          speed: 700,
          size: 7,
          life: 0.4,
          kind: 'spark',
        })
      }
      this.pulse[e.side].kick(14)
      audio.buzz(20)
    } else if (e.kind === 'land') {
      const k = Math.min(1, e.speed / 900)
      audio.play('bounce', 0.8 + k * 0.5)
      if (k > 0.3) fx.puff(e.x, e.y, 'rgba(255,236,210,0.35)', Math.round(3 + k * 5))
      this.squash[e.side].kick(-3 - k * 5)
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const balls = w.balls.map((b, i): Ball => {
      const p = prev?.[i]
      if (!p || p.state !== b.state || b.state === 'ready') return b
      return { ...b, x: lerp(p.x, b.x, alpha), y: lerp(p.y, b.y, alpha), z: lerp(p.z, b.z, alpha) }
    })
    // Trail behind a ball in flight, longer for a quick flat shot.
    for (const side of [0, 1] as Side[]) {
      const b = balls[side]
      const tr = this.trail[side]
      if (b && b.state === 'fly' && !b.grounded && Math.hypot(b.vx, b.vy) > 300) {
        const last = tr[tr.length - 1]
        if (!last || last.x !== b.x || last.y !== b.y) tr.push({ x: b.x, y: b.y, z: b.z })
      } else tr.shift()
      while (tr.length > 7) tr.shift()
    }
    for (const p of this.pulse) p.update(1 / 60)
    for (const q of this.squash) q.update(1 / 60)
    const look: Look = {
      w,
      hint: [this.hint(0), this.hint(1)],
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      end: this.s.end ? { winner: this.s.end.winner, t: this.time - this.s.end.at } : null,
      balls,
      drag: this.s.drag,
      squash: [this.squash[0].value, this.squash[1].value],
      trail: this.trail,
      names: this.ctx.names,
      target: this.target,
      status: [this.status(0), this.status(1)],
    }
    render(g, look)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    this.trail = [[], []]
  }

  /** Hint chevrons for a human who has not scored twice yet. */
  private hint(side: Side): boolean {
    return !this.isBot(side) && this.s.w.score[side] < 2 && this.s.w.time < 20
  }

  /** Text under a name pill: can this player shoot right now? */
  private status(side: Side): string | undefined {
    const w = this.s.w
    if (w.ended) return undefined
    if (w.balls[side].state === 'ready') return this.isBot(side) ? 'Shooting…' : 'Swipe to shoot'
    return undefined
  }
}

export default () => new BasketBall()
