import { BaseGame, other, type MatchSpec, type Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { taps, tapPoints, tapRipple } from '../../engines/reflex/index.ts'
import { SlapBot } from './bot.ts'
import { renderSlap } from './render.ts'
import {
  A_REST,
  D_REST,
  IMPACT,
  duelNew,
  handTarget,
  matchWinner,
  stepDuel,
  type Duel,
  type Ev,
  TARGET,
  type Touch,
} from './rules.ts'

/** Seconds after the match is decided before the result screen. */
const END_DELAY = 1.6

export interface State {
  duel: Duel
  /** Each palm's distance from the midline, own side positive. */
  hand: [number, number]
  /** Game time of the last point (drives the impact pose). */
  hitAt: number
  /** The last notable moment, stamped so every device animates it the same. */
  mark: { kind: Mark; at: number; by: Side }
  /** The match winner once decided. */
  winner: Side | null
  /** Points to win (the players' choice). */
  target: number
}

export type Mark = '' | 'connect' | 'flinch' | 'dodge' | 'swap' | 'fake'

/** World position of a side's palm at a given distance from the midline. */
const palmWorld = (side: Side, dist: number) => frame(side, W / 2, MID + dist)

/** Match length: first to N points. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 1, max: 15 }

class HandSlap extends BaseGame<State> {
  private bots: [SlapBot | null, SlapBot | null] = [null, null]

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new SlapBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [SlapBot | null, SlapBot | null]
    const att: Side = ctx.rng.chance(0.5) ? 1 : 0
    return {
      duel: duelNew(att),
      hand: [D_REST, D_REST],
      hitAt: -10,
      mark: { kind: '', at: -10, by: att },
      winner: null,
      target: ctx.target || match.default,
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    const d = s.duel
    const att = d.att
    const def = other(att)

    // Who touched what this step: humans from their own input, bots from their plan.
    const attBot = this.bots[att]
    const defBot = this.bots[def]
    const a: Touch = attBot
      ? attBot.drive(dt, 'att', { phase: d.phase, t: d.t, cool: d.cool })
      : { press: taps(ctx, att) > 0, held: ctx.input.player(att).down, tap: false }
    const b: Touch = defBot
      ? defBot.drive(dt, 'def', { phase: d.phase, t: d.t })
      : { press: false, held: false, tap: taps(ctx, def) > 0 }

    for (const side of [0, 1] as Side[]) {
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
    }

    const evs = stepDuel(d, dt, a, b, ctx.rng)
    for (const ev of evs) this.onEvent(ev, att)

    // Palms ease to where the duel wants them. The attacker's strike is quick.
    for (const side of [0, 1] as Side[]) {
      const target = handTarget(d, side)
      const k = side === d.att && d.phase === 'strike' ? 18 : 9
      s.hand[side] = target + (s.hand[side] - target) * Math.exp(-k * dt)
    }

    const winner = matchWinner(d, s.target)
    if (winner !== null && s.winner === null) {
      s.winner = winner
      this.finish(winner, { score: [d.points[0], d.points[1]], delay: END_DELAY })
      this.ctx.fx.confetti(winner)
      this.ctx.fx.shake(0.3)
    }
  }

  /** Effects for one thing that happened in the duel. `att` is who attacked at the start of the step. */
  private onEvent(ev: Ev, att: Side): void {
    const { fx, audio } = this.ctx
    const mark = (kind: Mark, by: Side) => (this.s.mark = { kind, at: this.time, by })
    const def = other(att)
    const palmA = palmWorld(att, A_REST)
    const impact = palmWorld(att, IMPACT)
    const beside = frame(att, W / 2 + 230, MID - 20)
    switch (ev) {
      case 'wind':
        audio.play('tick', 1.2)
        fx.puff(palmA.x, palmA.y, 'rgba(255,255,255,0.5)', 4)
        break
      case 'fake':
        audio.play('swish', 1.3)
        mark('fake', att)
        fx.float('FAKE!', beside.x, beside.y, 'rgba(255,255,255,0.9)', 64, att)
        break
      case 'commit':
        audio.play('whoosh', 1)
        fx.shake(0.08)
        break
      case 'pull': {
        audio.play('swish', 1.5)
        mark('dodge', def)
        const p = frame(def, W / 2 + 270, MID + 170)
        const palm = palmWorld(def, D_REST)
        fx.float('DODGE!', p.x, p.y, SIDE[def].light, 76, def)
        fx.puff(palm.x, palm.y, 'rgba(255,255,255,0.5)', 6)
        break
      }
      case 'whiff': {
        audio.play('swish', 0.8)
        const p = palmWorld(att, IMPACT)
        fx.burst(p.x, p.y, 'rgba(255,255,255,0.6)', {
          count: 8,
          speed: 300,
          size: 10,
          life: 0.3,
          gravity: 0,
        })
        fx.shake(0.06)
        break
      }
      case 'swap':
        audio.play('flip', 1.1)
        audio.play('powerup', 1.2)
        mark('swap', def)
        break
      case 'connect':
        this.s.hitAt = this.time
        mark('connect', att)
        this.s.hand[def] += 56
        audio.play('slap', 1)
        audio.play('thud', 1.1)
        audio.play('coin', 1)
        fx.burst(impact.x, impact.y, '#fff3c4', { count: 16, speed: 560, size: 12, life: 0.45 })
        fx.burst(impact.x, impact.y, C.yellow, {
          count: 14,
          speed: 900,
          size: 8,
          life: 0.3,
          gravity: 0,
          kind: 'spark',
        })
        fx.ring(impact.x, impact.y, SIDE[att].light, 260)
        fx.shake(0.5)
        fx.flash(SIDE[att].main, 0.22)
        fx.stop(5)
        fx.float('SLAP!', beside.x, beside.y, SIDE[att].light, 100, att)
        break
      case 'flinch': {
        this.s.hitAt = this.time
        mark('flinch', att)
        audio.play('boing', 1)
        const p = palmWorld(def, D_REST)
        fx.burst(p.x, p.y, '#fff3c4', { count: 10, speed: 380, size: 10, life: 0.4 })
        fx.shake(0.15)
        fx.float('GOTCHA!', beside.x, beside.y, SIDE[att].light, 88, att)
        break
      }
    }
  }

  render(g: Draw): void {
    renderSlap(g, this.s, this.time, {
      names: this.ctx.names,
      over: this.over,
      bots: this.ctx.bots,
    })
  }
}

export default () => new HandSlap()
