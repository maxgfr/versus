import { BaseGame, other, type MatchSpec, type Side } from '../../core/game.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
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
  HOLD_FORCE,
  IMPACT,
  duelNew,
  handTarget,
  matchWinner,
  stepDuel,
  type Duel,
  type Ev,
  type Phase,
  TARGET,
  type Touch,
} from './rules.ts'

/** Seconds after the match is decided before the result screen. */
const END_DELAY = 1.6
/** Finger speed toward the midline (world units/s) that counts as a flick, and the span up to full force. */
const FLICK_V0 = 2200
const FLICK_SPAN = 8000

export interface State {
  duel: Duel
  /** Each palm's distance from the midline, own side positive. */
  hand: [number, number]
  /** Game time of the last point (drives the impact pose). */
  hitAt: number
  /** The last notable moment, stamped so every device animates it the same. `k` is its force 0..1. */
  mark: { kind: Mark; at: number; by: Side; k: number }
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
  // Cosmetic only (not synced): previous palms for interpolation, springs, and
  // what render last saw, so every device (the online guest too) kicks them.
  private prevHand: [number, number] | null = null
  private squash: [Spring, Spring] = [new Spring(1, 380, 12), new Spring(1, 380, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private seen: { at: number; phase: Phase; points: [number, number] } = {
    at: -10,
    phase: 'rest',
    points: [0, 0],
  }

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
      mark: { kind: '', at: -10, by: att, k: 0 },
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
    this.prevHand = [s.hand[0], s.hand[1]]

    // Who touched what this step: humans from their own input, bots from their plan.
    const attBot = this.bots[att]
    const defBot = this.bots[def]
    const view = {
      phase: d.phase,
      t: d.t,
      cool: d.cool,
      pend: d.pend,
      flinched: d.flinched,
      strike: d.strike,
    }
    const a: Touch = attBot
      ? attBot.drive(dt, 'att', view)
      : {
          press: taps(ctx, att) > 0,
          held: ctx.input.player(att).down,
          tap: false,
          flick: this.flick(att, dt),
        }
    const b: Touch = defBot
      ? defBot.drive(dt, 'def', view)
      : { press: false, held: false, tap: taps(ctx, def) > 0 }

    for (const side of [0, 1] as Side[]) {
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
    }

    const evs = stepDuel(d, dt, a, b, ctx.rng)
    for (const ev of evs) this.juice(ev, att)

    // Palms ease to where the duel wants them; a harder slap travels faster.
    for (const side of [0, 1] as Side[]) {
      const target = handTarget(d, side)
      const k = side === d.att && d.phase === 'strike' ? 14 + d.force * 14 : 9
      s.hand[side] = target + (s.hand[side] - target) * Math.exp(-k * dt)
    }

    const winner = matchWinner(d, s.target)
    if (winner !== null && s.winner === null) {
      s.winner = winner
      this.finish(winner, { score: [d.points[0], d.points[1]], delay: END_DELAY })
      const { fx, audio } = ctx
      const col = SIDE[winner]
      const p = palmWorld(winner, A_REST)
      fx.confetti(winner)
      fx.flash(col.main, 0.3)
      fx.shake(0.35)
      fx.ring(p.x, p.y, col.light, 380)
      fx.burst(p.x, p.y, col.main, {
        count: 36,
        speed: 900,
        size: 14,
        life: 0.9,
        gravity: 0,
        drag: 2.2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      audio.buzz(40)
    }
  }

  /**
   * How hard the attacker's finger is pushed toward the midline this step:
   * 0 (no flick) or HOLD_FORCE..1. A finger that just left the glass still
   * counts, since a flick often ends with a lift.
   */
  private flick(side: Side, dt: number): number {
    const inp = this.ctx.input.player(side)
    let v = 0
    for (const p of inp.held.values()) v = Math.max(v, (side === 0 ? p.py - p.y : p.y - p.py) / dt)
    for (const p of inp.ups) v = Math.max(v, (side === 0 ? p.py - p.y : p.y - p.py) / dt)
    if (v < FLICK_V0) return 0
    return Math.min(1, HOLD_FORCE + (v - FLICK_V0) / FLICK_SPAN)
  }

  /**
   * Effects for one thing that happened in the duel. `att` is who attacked at
   * the start of the step. The slap's force `k` scales pitch, sparks, shake,
   * hit-stop and the haptic buzz.
   */
  private juice(ev: Ev, att: Side): void {
    const { fx, audio } = this.ctx
    const k = this.s.duel.force
    const mark = (kind: Mark, by: Side) => (this.s.mark = { kind, at: this.time, by, k })
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
        audio.play('whoosh', 0.9 + k * 0.5)
        fx.shake(0.05 + k * 0.1)
        if (k > HOLD_FORCE) {
          // A flick tears the air: streaks off the palm toward the mat.
          fx.burst(palmA.x, palmA.y, 'rgba(255,255,255,0.7)', {
            count: Math.round(4 + k * 8),
            speed: 500 + k * 700,
            size: 6,
            life: 0.25,
            gravity: 0,
            spread: 0.5,
            dir: att === 0 ? -Math.PI / 2 : Math.PI / 2,
            kind: 'spark',
          })
          audio.buzz(6)
        }
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
      case 'whiff':
        // The slap meets the empty mat: dust and a dull thud, as hard as it was thrown.
        audio.play('thud', 0.8 + k * 0.3)
        audio.play('swish', 0.8)
        fx.burst(impact.x, impact.y, 'rgba(230,220,200,0.7)', {
          count: Math.round(6 + k * 10),
          speed: 260 + k * 260,
          size: 14,
          life: 0.45,
          gravity: 0,
          drag: 3,
        })
        fx.shake(0.06 + k * 0.12)
        break
      case 'swap':
        audio.play('flip', 1.1)
        audio.play('powerup', 1.2)
        mark('swap', def)
        break
      case 'connect':
        this.s.hitAt = this.time
        mark('connect', att)
        this.s.hand[def] += 40 + k * 40
        audio.play('slap', 0.85 + k * 0.4)
        audio.play('thud', 1.2 - k * 0.3)
        audio.play('coin', 1)
        audio.buzz(Math.round(14 + k * 26))
        fx.burst(impact.x, impact.y, '#fff3c4', {
          count: Math.round(10 + k * 14),
          speed: 420 + k * 360,
          size: 12,
          life: 0.45,
        })
        fx.burst(impact.x, impact.y, C.yellow, {
          count: Math.round(8 + k * 16),
          speed: 700 + k * 600,
          size: 8,
          life: 0.3,
          gravity: 0,
          kind: 'spark',
        })
        fx.ring(impact.x, impact.y, SIDE[att].light, 200 + k * 140)
        fx.shake(0.3 + k * 0.35)
        fx.flash(SIDE[att].main, 0.14 + k * 0.16)
        fx.stop(Math.round(3 + k * 4))
        fx.float(
          k > 0.8 ? 'SMACK!' : 'SLAP!',
          beside.x,
          beside.y,
          SIDE[att].light,
          88 + k * 30,
          att,
        )
        break
      case 'flinch': {
        this.s.hitAt = this.time
        mark('flinch', att)
        audio.play('boing', 1)
        audio.buzz(12)
        const p = palmWorld(def, D_REST)
        fx.burst(p.x, p.y, '#fff3c4', { count: 10, speed: 380, size: 10, life: 0.4 })
        fx.shake(0.15)
        fx.float('GOTCHA!', beside.x, beside.y, SIDE[att].light, 88, att)
        break
      }
    }
  }

  /** Kick the springs from what changed in state since the last frame (so the guest animates too). */
  private animate(): void {
    const s = this.s
    const d = s.duel
    const seen = this.seen
    if (d.phase !== seen.phase) {
      // Anticipation on the lift, stretch as the slap leaves.
      if (d.phase === 'wind') this.squash[d.att].kick(2.5)
      if (d.phase === 'strike') this.squash[d.att].kick(3 + d.force * 4)
      seen.phase = d.phase
    }
    const m = s.mark
    if (m.at !== seen.at) {
      seen.at = m.at
      if (m.kind === 'connect') {
        this.squash[other(m.by)].kick(-5 - m.k * 6)
        this.squash[m.by].kick(-3 - m.k * 4)
      } else if (m.kind === 'flinch') this.squash[other(m.by)].kick(-3.5)
      else if (m.kind === 'dodge') this.squash[m.by].kick(3)
      else if (m.kind === 'swap') this.squash[other(m.by)].kick(-2 - m.k * 3)
    }
    for (const side of [0, 1] as Side[]) {
      if (d.points[side] > seen.points[side]) this.pulse[side].kick(14)
      seen.points[side] = d.points[side]
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    this.animate()
    const dt = 1 / 60
    for (const sp of this.squash) sp.update(dt)
    for (const sp of this.pulse) sp.update(dt)
    const prev = this.prevHand ?? s.hand
    const hand: [number, number] = [
      lerp(prev[0], s.hand[0], alpha),
      lerp(prev[1], s.hand[1], alpha),
    ]
    // 0..1 palm speed, for streaks behind a flying slap.
    const blur = (side: Side) => Math.min(1, Math.abs(s.hand[side] - prev[side]) / 60)
    renderSlap(g, s, this.time, {
      names: this.ctx.names,
      over: this.over,
      bots: this.ctx.bots,
      hand,
      squash: [this.squash[0].value, this.squash[1].value],
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      blur: [blur(0), blur(1)],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevHand = null
  }
}

export default () => new HandSlap()
