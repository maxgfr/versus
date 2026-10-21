import { DragAim } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import type { MatchSpec } from '../../core/game.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { hud, render } from './render.ts'
import {
  advance,
  type Arrow,
  BOW,
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

  protected setup(): State {
    // The player whose turn it is may pull anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind(), this.target)
  }

  private rollWind(): number {
    const rng = this.ctx.rng
    return rng.chance(0.2) ? 0 : rng.range(-WIND_MAX, WIND_MAX)
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
        note: `Best score after ${this.target} arrows each`,
        delay: 2.6,
      })
      this.ctx.fx.confetti(r === 'draw' ? undefined : r)
      if (r !== 'draw') this.ctx.fx.flash(SIDE[r].light, 0.2)
      return
    }
    super.step(dt)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    this.s.aim = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
    if (a.shot) this.release(a.shot)
  }

  protected botPlay(): void {
    const side = this.s.turn
    this.release(this.botShot ?? choose(side, this.s.wind, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private release(shot: ShotParams): void {
    loose(this.s, shot, this.time)
    this.s.looseAt = this.time
    for (const a of this.aims) a.cancel()
    const side = this.s.turn
    const { fx, audio } = this.ctx
    audio.play('zap', 0.6 + 0.2 * shot.power)
    audio.play('swish', 1.1 + 0.3 * shot.power)
    fx.ring(BOW[side].x, BOW[side].y, alpha(C.white, 0.6), 90 + 60 * shot.power)
    fx.shake(0.06 + 0.08 * shot.power)
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
    this.landed(e.arrow)
  }

  private landed(a: Arrow): void {
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
    audio.play('thud', 1 + a.score * 0.03)
    audio.play('hit', 1.4)
    fx.shake(0.15 + a.score * 0.02)
    fx.burst(a.x, a.y, '#e8c97a', {
      count: 8,
      speed: 220,
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

  render(g: Draw): void {
    const s = this.s
    let draw: Parameters<typeof render>[2]['draw'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      const live = this.aims[side].aim
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
        hint:
          s.phase === 'aim' &&
          !this.isBot(s.turn) &&
          s.stuck.length === 0 &&
          !this.aims[s.turn].aim,
      },
      this.time,
    )
    hud(g, s)
    this.drawTurns(g, undefined, s.phase === 'aim')
  }
}

export default () => new Archery()
