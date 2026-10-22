import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import {
  mashNew,
  mashStep,
  mashTap,
  roundEnd,
  roundsNew,
  roundsStep,
  tapRipple,
  type MashState,
  type Rounds,
} from '../../engines/reflex/index.ts'
import { RopeBot } from './bot.ts'
import { knotY, renderRope, teamLayout } from './render.ts'
import { haulPower, pull, pullFactor, ropeNew, ropeWinner, TARGET, type Rope } from './rules.ts'

export interface State {
  rope: Rope
  mash: [MashState, MashState]
  rounds: Rounds
  /** Seconds into the current round. */
  roundT: number
  /** Rope shake 0..1, from recent tapping. */
  wobble: number
  /** Strength (in taps) of each side's latest pull, for the lean-back on every device. */
  force: [number, number]
}

/** Round wins needed to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class PullTheRope extends BaseGame<State> {
  private bots: [RopeBot | null, RopeBot | null] = [null, null]
  // Cosmetic only (not synced): interpolation and springs, driven from state changes.
  private prevPos = 0
  private lean: [Spring, Spring] = [new Spring(0, 260, 11), new Spring(0, 260, 11)]
  private knotSquash = new Spring(1, 420, 12)
  private seen: [number, number] = [0, 0]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new RopeBot(ctx.rng.fork(), ctx.difficulty, side as Side) : null,
    ) as [RopeBot | null, RopeBot | null]
    return {
      rope: ropeNew(),
      mash: [mashNew(), mashNew()],
      rounds: roundsNew(this.target),
      roundT: 0,
      wobble: 0,
      force: [0, 0],
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.prevPos = s.rope.pos
    for (const m of s.mash) mashStep(m, dt, this.time)
    s.wobble *= Math.exp(-4 * dt)
    if (roundsStep(s.rounds, this.time, 1.8)) {
      s.rope = ropeNew()
      this.prevPos = 0
      s.roundT = 0
    }
    if (s.rounds.phase === 'between') {
      // The winners keep hauling for a moment; the losers skid toward the mud.
      this.slide(dt)
      return
    }
    s.roundT += dt
    const f: [number, number] = [0, 0]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      let n = 0
      let extra = 0
      if (bot) {
        n = bot.step(dt, s.rope.pos, s.roundT)
        extra = bot.extra
      } else {
        const inp = ctx.input.player(side)
        n = inp.downs.length
        for (const p of inp.downs) tapRipple(ctx, side, p.x, p.y)
        // A stroke toward your own edge is a haul: it pulls on release, by length and speed.
        const dir = side === 0 ? 1 : -1
        for (const p of inp.ups) {
          const h = haulPower((p.y - p.y0) * dir, this.time - p.t0)
          if (h <= 0) continue
          extra += h
          ctx.fx.burst(p.x, p.y, SIDE[side].light, {
            count: 3 + Math.round(h * 8),
            speed: 300 + h * 500,
            size: 8,
            life: 0.3,
            gravity: 0,
            spread: 0.8,
            dir: side === 0 ? Math.PI / 2 : -Math.PI / 2,
            kind: 'spark',
          })
        }
      }
      if (n) mashTap(s.mash[side], this.time, n)
      f[side] = n + extra
      if (f[side] > 0) this.juicePull(side, f[side], extra)
    }
    const lean = s.mash[0].rate - s.mash[1].rate
    pull(s.rope, f[0], f[1], dt, pullFactor(s.roundT, ctx.teams), lean, s.roundT)
    s.wobble = Math.min(1, s.wobble + (f[0] + f[1]) * 0.18)

    const w = ropeWinner(s.rope)
    if (w === null) return
    this.juiceRound(w)
    if (roundEnd(s.rounds, w, this.time, ctx.names)) {
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 1.8 })
    }
  }

  private slide(dt: number): void {
    const r = this.s.rope
    r.vel *= Math.exp(-2.5 * dt)
    r.pos = Math.max(-1.12, Math.min(1.12, r.pos + r.vel * dt))
  }

  /** A side pulled with `force` taps' worth this step (`haul` of it from strokes). */
  private juicePull(side: Side, force: number, haul: number): void {
    const { ctx } = this
    const s = this.s
    s.force[side] = force
    const k = Math.min(1, (force - 1) / 0.8)
    ctx.audio.play('tap', (side === 0 ? 0.9 : 1.1) + Math.random() * 0.1 - k * 0.15)
    if (haul > 0.15) {
      ctx.audio.play('whoosh', 0.8 + k * 0.5)
      ctx.audio.buzz(8 + Math.round(k * 12))
    }
    // Dust kicks up at the team's feet, more for a heave.
    if (Math.random() < 0.35 + k * 0.6) {
      const m = teamLayout(side, s.rope.pos)[(Math.random() * 3) | 0] ?? { x: W / 2, y: 900 }
      ctx.fx.puff(
        m.x + (Math.random() - 0.5) * 80,
        m.y + 50,
        'rgba(240,220,170,0.75)',
        3 + Math.round(k * 4),
      )
    }
    // Near a line every pull strains the whole rope.
    const near = Math.abs(s.rope.pos)
    if (near > 0.72) ctx.fx.shake(0.04 + (near - 0.72) * 0.2 + k * 0.06)
    else if (k > 0.6) ctx.fx.shake(0.05 * k)
  }

  private juiceRound(w: Side): void {
    const { ctx } = this
    const ky = knotY(w === 0 ? 1 : -1)
    const col = SIDE[w]
    ctx.fx.burst(W / 2, ky, col.main, {
      count: 40,
      speed: 900,
      size: 14,
      life: 0.9,
      gravity: 0,
      drag: 2.2,
      spread: Math.PI,
      dir: w === 0 ? Math.PI / 2 : -Math.PI / 2,
      colors: [col.main, col.light, C.yellow, C.white],
      kind: 'square',
    })
    ctx.fx.burst(W / 2, 900, '#7a5230', { count: 22, speed: 560, size: 16, gravity: 600 })
    ctx.fx.ring(W / 2, ky, col.light, 300)
    ctx.fx.flash(col.main, 0.3)
    ctx.fx.shake(0.5)
    ctx.fx.stop(6)
    floatFor(ctx.fx, w, 'HEAVE!')
    ctx.audio.play('splash')
    ctx.audio.play('score')
    ctx.audio.buzz(30)
  }

  protected override afterEnd(dt: number): void {
    this.prevPos = this.s.rope.pos
    this.slide(dt)
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const dt = 1 / 60
    // Every pull (seen through the synced tap counter) leans that team back.
    for (const side of [0, 1] as Side[]) {
      const taps = s.mash[side].taps
      if (taps !== this.seen[side]) {
        if (taps > this.seen[side]) {
          const k = Math.min(1.8, s.force[side] || 1)
          this.lean[side].kick(-320 * k)
          this.knotSquash.kick(-2 * k)
        }
        this.seen[side] = taps
      }
      this.lean[side].update(dt)
    }
    this.knotSquash.update(dt)
    renderRope(g, s, this.time, {
      teams: this.ctx.teams,
      names: this.ctx.names,
      over: this.over,
      pos: lerp(this.prevPos, s.rope.pos, alpha),
      lean: [this.lean[0].value, this.lean[1].value],
      knot: this.knotSquash.value,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevPos = this.s.rope.pos
  }
}

export default () => new PullTheRope()
