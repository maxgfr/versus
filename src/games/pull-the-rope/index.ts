import { BaseGame, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import {
  mashNew,
  mashStep,
  mashTap,
  roundEnd,
  roundsNew,
  roundsStep,
  tapPoints,
  tapRipple,
  taps,
  type MashState,
  type Rounds,
} from '../../engines/reflex/index.ts'
import { RopeBot } from './bot.ts'
import { knotY, renderRope, teamLayout } from './render.ts'
import { pull, pullFactor, ropeNew, ropeWinner, TARGET, type Rope } from './rules.ts'

export interface State {
  rope: Rope
  mash: [MashState, MashState]
  rounds: Rounds
  /** Seconds into the current round. */
  roundT: number
  /** Rope shake 0..1, from recent tapping. */
  wobble: number
}

class PullTheRope extends BaseGame<State> {
  private bots: [RopeBot | null, RopeBot | null] = [null, null]

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new RopeBot(ctx.rng.fork(), ctx.difficulty, side as Side) : null,
    ) as [RopeBot | null, RopeBot | null]
    return {
      rope: ropeNew(),
      mash: [mashNew(), mashNew()],
      rounds: roundsNew(TARGET),
      roundT: 0,
      wobble: 0,
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    for (const m of s.mash) mashStep(m, dt, this.time)
    s.wobble *= Math.exp(-4 * dt)
    if (roundsStep(s.rounds, this.time, 2.2)) {
      s.rope = ropeNew()
      s.roundT = 0
    }
    if (s.rounds.phase === 'between') {
      // The winners keep hauling for a moment; the losers skid toward the mud.
      s.rope.vel *= Math.exp(-2.5 * dt)
      s.rope.pos = Math.max(-1.12, Math.min(1.12, s.rope.pos + s.rope.vel * dt))
      return
    }
    s.roundT += dt
    const n: [number, number] = [0, 0]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      n[side] = bot ? bot.step(dt, s.rope.pos) : taps(ctx, side)
      if (!n[side]) continue
      mashTap(s.mash[side], this.time, n[side])
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
      ctx.audio.play('tap', side === 0 ? 0.9 + ctx.rng.next() * 0.1 : 1.1 + ctx.rng.next() * 0.1)
      if (ctx.rng.chance(0.35)) {
        const m = ctx.rng.pick(teamLayout(side, s.rope.pos))
        ctx.fx.puff(m.x + ctx.rng.range(-40, 40), m.y + 50, 'rgba(240,220,170,0.75)', 3)
      }
    }
    pull(s.rope, n[0], n[1], dt, pullFactor(s.roundT, ctx.teams))
    s.wobble = Math.min(1, s.wobble + (n[0] + n[1]) * 0.18)
    if (Math.abs(s.rope.pos) > 0.72 && n[0] + n[1] > 0) ctx.fx.shake(0.06)

    const w = ropeWinner(s.rope)
    if (w === null) return
    const ky = knotY(w === 0 ? 1 : -1)
    ctx.fx.burst(500, ky, SIDE[w].main, { count: 26, speed: 700, size: 14 })
    ctx.fx.burst(500, 900, '#7a5230', { count: 18, speed: 520, size: 16, gravity: 600 })
    ctx.fx.ring(500, ky, SIDE[w].light, 260)
    ctx.fx.flash(SIDE[w].main, 0.3)
    ctx.fx.shake(0.5)
    ctx.fx.stop(6)
    ctx.audio.play('splash')
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names)) {
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 1.8 })
    }
  }

  protected override afterEnd(dt: number): void {
    const s = this.s
    s.rope.vel *= Math.exp(-2.5 * dt)
    s.rope.pos = Math.max(-1.12, Math.min(1.12, s.rope.pos + s.rope.vel * dt))
  }

  render(g: Draw): void {
    renderRope(g, this.s, this.time, {
      teams: this.ctx.teams,
      names: this.ctx.names,
      over: this.over,
    })
  }
}

export default () => new PullTheRope()
