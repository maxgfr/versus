import { floatFor } from '../../core/fx/fx.ts'
import type { MatchSpec, Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, shade } from '../../core/render/palette.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { type Plan, plan as planThrow } from './bot.ts'
import { drawHud, fmt, render } from './render.ts'
import {
  accuracy,
  advance,
  canSpin,
  type Event,
  leader,
  newState,
  over,
  passed,
  release,
  startSpin,
  starterOf,
  stepSpin,
  type State,
  THROWS,
} from './rules.ts'

/** Throws each athlete makes; the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'rounds', default: THROWS, min: 1, max: 10 }

class HammerThrow extends TurnGame<State> {
  /** The computer's plan for its throw, made when it starts winding. */
  private plan: Plan | null = null
  /** The pointer that is holding the spin (human turns). */
  private ptr = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // In local 2P the player whose turn it is may spin from anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(starterOf(this.ctx.rng), this.target)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim' || this.plan !== null
  }

  protected override animate(dt: number): void {
    const s = this.s
    if (this.plan && s.spin) {
      // The computer winds up, then lets go as the handle passes its planned angle.
      const from = s.spin.theta
      for (const e of stepSpin(s, dt)) this.juice(e)
      if (passed(from, s.spin.theta, this.plan.theta) && ++this.plan.seen >= this.plan.passes) {
        this.plan = null
        const e = release(s)
        if (e) this.juice(e)
      }
    }
    for (const e of advance(s, dt)) this.juice(e)
    if (s.phase === 'beat' && s.beat <= 0 && over(s) && !this.over) {
      const w = leader(s)
      const m0 = fmt(s.best[0])
      const m1 = fmt(s.best[1])
      s.endAt = s.t
      if (w !== null) {
        this.ctx.fx.confetti(w)
        this.ctx.audio.play('powerup', 1.2)
      }
      this.finish(w ?? 'draw', {
        note: `${m0} m against ${m1} m`,
        delay: 2.6,
      })
    }
  }

  protected override afterEnd(dt: number): void {
    // Keep the clock running so the medal and the flags finish their animation.
    this.s.t += dt
  }

  protected stepTurn(dt: number): void {
    const s = this.s
    const side = s.turn
    const pi = this.ctx.input.player(side)
    if (s.spin === null) {
      const down = pi.downs[0]
      if (!down || !canSpin(s, side)) return
      this.ptr = down.id
      startSpin(s, side)
      this.ctx.audio.play('tick', 0.8)
      // A tap that lets go in the same step throws straight away.
      if (pi.ups.some((p) => p.id === this.ptr)) this.letGo()
      return
    }
    for (const e of stepSpin(s, dt)) this.juice(e)
    if (pi.ups.some((p) => p.id === this.ptr)) this.letGo()
  }

  private letGo(): void {
    const e = release(this.s)
    this.ptr = -1
    if (e) this.juice(e)
  }

  protected botPlay(): void {
    const side = this.s.turn
    this.plan = planThrow(side, this.ctx.difficulty, this.ctx.rng)
    startSpin(this.s, side)
    this.ctx.audio.play('tick', 0.8)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    switch (e.kind) {
      case 'whirl':
        audio.play('tick', 0.9 + (this.s.spin?.omega ?? 3) / 10)
        return
      case 'throw': {
        audio.play('swish', 0.9 + e.omega * 0.03)
        audio.play('whoosh', 1)
        audio.buzz(12)
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', 6)
        fx.sparks(e.x, e.y, C.white, 8)
        fx.shake(0.12)
        const f = this.s.flight
        if (f && accuracy(f.side, f.theta) > 0.985) {
          audio.play('zap', 1.4)
          fx.ring(e.x, e.y, C.yellow, 140)
          fx.float('Perfect!', e.x, e.y, C.yellow, 54, f.side)
        }
        return
      }
      case 'land': {
        if (e.foul) {
          audio.play('error', 1)
          floatFor(fx, e.side, 'Foul!', e.x, e.y)
          fx.burst(e.x, e.y, '#8d86a8', {
            count: 10,
            speed: 320,
            size: 10,
            life: 0.6,
            kind: 'square',
          })
          return
        }
        audio.play('thud', 0.8)
        audio.play(e.best ? 'score' : 'coin', 1)
        audio.buzz(25)
        fx.burst(e.x, e.y, '#7a5532', {
          count: 22,
          speed: 480,
          size: 13,
          life: 0.7,
          gravity: 0,
          drag: 2.6,
          kind: 'square',
          colors: ['#7a5532', '#5b3d23', C.grass, shade(C.grass, -0.3)],
        })
        fx.puff(e.x, e.y, 'rgba(200,170,120,0.6)', 8)
        fx.ring(e.x, e.y, SIDE[e.side].light, 200)
        fx.shake(0.35)
        fx.stop(4)
        if (e.best && this.s.thrown[e.side] > 1) {
          fx.float('New best!', e.x, e.y + (e.side === 0 ? 120 : -120), C.yellow, 56, e.side)
        }
        return
      }
      case 'turn':
        audio.play('tick', 1)
        return
    }
  }

  render(g: Draw): void {
    const s = this.s
    render(g, s, this.time, [!this.isBot(0), !this.isBot(1)])
    const spin = s.spin && this.isBot(s.spin.side) ? s.spin.side : null
    this.drawTurns(
      g,
      [spin === 0 ? 'Spinning…' : undefined, spin === 1 ? 'Spinning…' : undefined],
      s.phase === 'aim',
    )
    for (const side of [0, 1] as Side[]) drawHud(g, s, side, this.time)
  }
}

export default () => new HammerThrow()
