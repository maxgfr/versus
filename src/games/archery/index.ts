import { DragAim } from '../../core/controls.ts'
import { Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import type { MatchSpec } from '../../core/game.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose, steady } from './bot.ts'
import { hud, render } from './render.ts'
import {
  advance,
  type Arrow,
  BOW,
  countBack,
  done,
  type Event,
  landingOf,
  loose,
  MAX_PULL,
  MIN_POWER,
  newState,
  result,
  ARROWS,
  type State,
  swayAt,
  WIND_MAX,
  windScale,
} from './rules.ts'

const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

/** Arrows each: the match length. Capped where the arrows-left pips still fit the edge. */
export const match: MatchSpec = { unit: 'rounds', default: ARROWS, min: 1, max: 6 }

class Archery extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, MAX_PULL, MIN_POWER),
    new DragAim(1, EVERYWHERE, MAX_PULL, MIN_POWER),
  ]
  /** The computer plans its arrow when its turn starts, then draws toward it while "thinking". */
  private botShot: ShotParams | null = null
  // Cosmetic only (not synced): the boss thumping on a strike, score pulses, archer squash.
  private thump = new Spring(0, 260, 9)
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private squash: [Spring, Spring] = [new Spring(1, 300, 11), new Spring(1, 300, 11)]
  /** Quarter of the draw reached so far, for the creaking tension clicks. */
  private notch = 0

  protected setup(): State {
    // The player whose turn it is may pull anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind(0), this.target)
  }

  /** The wind builds toward the last arrows (`loosed` so far), so the finish is tense. */
  private rollWind(loosed = this.s.shot[0] + this.s.shot[1]): number {
    const max = WIND_MAX * windScale(loosed, this.target)
    const rng = this.ctx.rng
    return rng.chance(0.2) ? 0 : rng.range(-max, max)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    if (done(this.s)) {
      const r = result(this.s)
      this.s.endAt = this.time
      this.finish(r, {
        score: [this.s.totals[0], this.s.totals[1]],
        note: countBack(this.s) ?? `Best score after ${this.target} arrows each`,
        delay: 2.6,
      })
      this.ctx.fx.confetti(r === 'draw' ? undefined : r)
      if (r !== 'draw') {
        this.ctx.fx.flash(SIDE[r].light, 0.3)
        this.ctx.fx.shake(0.3)
        this.pulse[r].kick(16)
      }
      return
    }
    super.step(dt)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    this.s.aim = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
    // The string creaks a little higher at every quarter of the draw.
    const notch = a.aim ? Math.floor(a.aim.power * 4) : 0
    if (notch > this.notch) {
      this.ctx.audio.play('tick', 0.9 + notch * 0.18)
      this.ctx.audio.buzz(3 + notch * 2)
    }
    this.notch = notch
    if (a.shot) this.release(a.shot)
  }

  protected botPlay(): void {
    const side = this.s.turn
    const d = this.ctx.difficulty
    const shot = this.botShot ?? choose(side, this.s.wind, d, this.ctx.rng)
    // Let go holding against the sway of this very moment.
    this.release(steady(shot, side, this.time, d))
    this.botShot = null
  }

  private release(shot: ShotParams): void {
    loose(this.s, shot, this.time)
    this.s.looseAt = this.time
    for (const a of this.aims) a.cancel()
    this.notch = 0
    const side = this.s.turn
    const { fx, audio } = this.ctx
    const k = shot.power
    audio.play('zap', 0.6 + 0.3 * k)
    audio.play('swish', 1 + 0.45 * k)
    audio.buzz(Math.round(6 + 14 * k))
    fx.ring(BOW[side].x, BOW[side].y, alpha(C.white, 0.6), 80 + 90 * k)
    fx.shake(0.04 + 0.12 * k)
    // The archer springs back from the release.
    this.squash[side].kick(-2 - 5 * k)
  }

  private juice(e: Event): void {
    const { audio } = this.ctx
    if (e.kind === 'turn') {
      audio.play('tick')
      this.botShot = this.isBot(e.side)
        ? choose(e.side, this.s.wind, this.ctx.difficulty, this.ctx.rng)
        : null
      return
    }
    this.landed(e.arrow, e.power)
  }

  private landed(a: Arrow, k: number): void {
    const { fx, audio } = this.ctx
    a.at = this.time
    if (a.score === 0) {
      audio.play('thud', 0.7)
      audio.play('error')
      fx.puff(a.x, a.y, 'rgba(200,230,200,0.6)', 8)
      fx.shake(0.12)
      floatFor(fx, a.side, 'Miss', a.x, a.y - 90)
      return
    }
    // A harder draw strikes harder: a deeper thud, more straw, the boss rocks.
    audio.play('thud', 1.15 - k * 0.3 + a.score * 0.02)
    audio.play('hit', 1.2 + a.score * 0.03)
    audio.buzz(Math.round(8 + 14 * k + a.score))
    fx.shake(0.08 + k * 0.1 + a.score * 0.015)
    this.thump.kick(4 + 8 * k)
    this.pulse[a.side].kick(6 + a.score)
    fx.burst(a.x, a.y, '#e8c97a', {
      count: Math.round(5 + 8 * k),
      speed: 160 + 160 * k,
      size: 7,
      life: 0.45,
      gravity: 0,
      drag: 4,
      kind: 'square',
    })
    fx.ring(a.x, a.y, SIDE[a.side].light, 90 + a.score * 10)
    if (a.score >= 9) {
      fx.stop(a.score === 10 ? 6 : 3)
      audio.play('score')
      fx.burst(a.x, a.y, C.yellow, {
        count: 18,
        speed: 340,
        size: 10,
        life: 0.7,
        gravity: 200,
        drag: 2.4,
        colors: [C.yellow, C.white, SIDE[a.side].main],
        kind: 'square',
      })
    }
    if (a.score === 10) {
      fx.flash(C.yellow, 0.25)
      fx.confetti(a.side)
    }
    const label = a.score === 10 ? 'Bullseye! 10' : a.score >= 8 ? `Nice! ${a.score}` : `${a.score}`
    fx.float(
      label,
      a.x,
      a.y - 90,
      a.score >= 9 ? C.yellow : C.white,
      a.score >= 9 ? 62 : 52,
      a.side,
    )
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const dt = 1 / 60
    this.thump.update(dt)
    for (const p of this.pulse) p.update(dt)
    for (const q of this.squash) q.update(dt)
    let draw: Parameters<typeof render>[2]['draw'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      // The synced draw, so the online guest sees its own aim too (its widgets never update there).
      const live = s.aim
      if (live) {
        const shot = { dx: live.dx, dy: live.dy, power: live.power }
        draw = {
          power: live.power,
          angle: Math.atan2(shot.dy, shot.dx) + swayAt(this.time, side, shot.power),
          landing: landingOf(side, shot, this.time, s.wind),
        }
      } else if (this.isBot(side) && this.botShot) {
        // Draw toward the planned arrow while the computer thinks.
        const k = Math.min(1, this.thinking / 0.5)
        const shot = this.botShot
        draw = {
          power: shot.power * k,
          angle: Math.atan2(shot.dy, shot.dx),
          landing: landingOf(side, shot, this.time, s.wind),
        }
      }
    }
    render(
      g,
      s,
      {
        draw,
        // Each human gets the hint before their own first arrow, not only whoever shoots first.
        hint: s.phase === 'aim' && !this.isBot(s.turn) && s.shot[s.turn] === 0 && !s.aim,
        ft: s.flight && !this.over ? Math.min(s.flight.dur, s.flight.t + alpha * dt) : 0,
        thump: this.thump.value,
        squash: [this.squash[0].value, this.squash[1].value],
      },
      this.time,
    )
    hud(g, s, [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)])
    this.drawTurns(g, undefined, s.phase === 'aim')
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.notch = 0
  }
}

export default () => new Archery()
