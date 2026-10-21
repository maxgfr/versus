import { floatFor } from '../../core/fx/fx.ts'
import type { MatchSpec } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { Flick } from './flick.ts'
import { handOf, hud, render } from './render.ts'
import {
  advance,
  type Dart,
  DARTS_PER_TURN,
  type Event,
  done,
  landingOf,
  newState,
  type Pt,
  result,
  ROUNDS,
  type State,
  throwDart,
  wobble,
} from './rules.ts'

/** Rounds of three darts each: the match length. */
export const match: MatchSpec = { unit: 'rounds', default: ROUNDS, min: 1, max: 10 }

class Darts extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  private flicks: [Flick, Flick] = [new Flick(0), new Flick(1)]

  protected setup(): State {
    // The player whose turn it is may flick from anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.target)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    for (const e of advance(this.s, dt)) this.juice(e)
    if (done(this.s)) {
      const r = result(this.s)
      this.s.endAt = this.time
      this.finish(r, {
        score: [this.s.totals[0], this.s.totals[1]],
        note: `Highest total after ${this.target} rounds`,
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
    const fl = this.flicks[side]
    fl.update(this.ctx.input.player(side))
    this.s.aim = fl.aim ? landingOf(side, fl.aim) : null
    const t = fl.throwFlick
    if (t) {
      // The wobble comes from the flick's speed: a fast flick is less accurate.
      this.throwTo(landingOf(side, t.f, wobble(this.ctx.rng, t.speed)))
    }
  }

  protected botPlay(): void {
    const side = this.s.turn
    this.throwTo(landingOf(side, choose(side, this.ctx.difficulty, this.ctx.rng)))
  }

  private throwTo(to: Pt): void {
    const side = this.s.turn
    throwDart(this.s, to)
    this.s.aim = null
    for (const f of this.flicks) f.cancel()
    const { audio } = this.ctx
    audio.play('swish', side === 0 ? 1.1 : 1.18)
  }

  /** This turn's darts for the side that just threw. */
  private turnDarts(side: 0 | 1): Dart[] {
    const mine = this.s.darts.filter((d) => d.side === side)
    return mine.slice(mine.length - this.s.throws)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'turn') {
      this.s.turnAt = this.time
      audio.play('tick')
      return
    }
    if (e.kind === 'round') {
      this.s.roundAt = this.time
      audio.play('count', 1.2)
      return
    }
    const d = e.dart
    d.at = this.time
    if (d.ring === 'miss') {
      audio.play('wall', 0.8)
      audio.play('error')
      fx.puff(d.x, d.y, 'rgba(200,200,220,0.5)', 6)
      fx.shake(0.12)
      floatFor(fx, d.side, 'Miss', d.x, d.y - 80)
      return
    }
    // The thunk: a short, heavy hit and a puff of sisal.
    audio.play('thud', d.ring === 'bull' ? 1.25 : 1.05)
    audio.play('hit', 1.5)
    fx.shake(0.18)
    fx.puff(d.x, d.y, 'rgba(240,225,190,0.55)', 5)
    fx.burst(d.x, d.y, '#e8d6a8', {
      count: 6,
      speed: 200,
      size: 6,
      life: 0.4,
      gravity: 0,
      drag: 4,
      kind: 'square',
    })
    const big = d.ring === 'bull' || d.ring === 'treble' || d.ring === 'double'
    if (big) {
      audio.play('score', d.ring === 'treble' ? 1.1 : 1)
      fx.stop(d.ring === 'bull' ? 6 : 3)
      fx.ring(d.x, d.y, SIDE[d.side].light, d.ring === 'bull' ? 200 : 130)
      fx.burst(d.x, d.y, SIDE[d.side].light, {
        count: d.ring === 'bull' ? 30 : 16,
        speed: 380,
        size: 11,
        life: 0.7,
        gravity: 0,
        drag: 2.6,
        colors: [C.yellow, C.white, SIDE[d.side].main],
        kind: 'square',
      })
    } else {
      fx.sparks(d.x, d.y, C.white, 6)
    }
    if (d.ring === 'bull') {
      audio.play('coin', 1.2)
      fx.flash(C.yellow, 0.25)
      fx.confetti(d.side)
    }
    const label =
      d.ring === 'bull'
        ? 'Bull! 50'
        : d.ring === 'outer'
          ? 'Outer bull 25'
          : d.ring === 'single'
            ? `${d.pts}`
            : `${d.label} · ${d.pts}`
    fx.float(label, d.x, d.y - 80, big ? C.yellow : C.white, big ? 60 : 50, d.side)
    // End of a turn: name a big visit.
    if (this.s.throws >= DARTS_PER_TURN) {
      const sum = this.turnDarts(d.side).reduce((a, x) => a + x.pts, 0)
      const word = sum === 180 ? 'One hundred and eighty!' : sum >= 100 ? `Ton! ${sum}` : ''
      if (word) {
        audio.play('powerup')
        audio.buzz(40)
        fx.flash(SIDE[d.side].light, 0.25)
        fx.shake(0.35)
        if (sum === 180) fx.confetti(d.side)
        floatFor(fx, d.side, word)
      } else floatFor(fx, d.side, `+${sum}`, handOf(d.side).x - 80)
    }
  }

  render(g: Draw): void {
    const s = this.s
    const side = s.turn
    render(
      g,
      s,
      {
        aim: s.phase === 'aim' && !this.over ? s.aim : null,
        hint: s.phase === 'aim' && !this.isBot(side) && s.darts.length === 0 && !s.aim,
      },
      this.time,
    )
    for (const f of this.flicks) f.render(g)
    hud(g, s)
    this.drawTurns(g, undefined, s.phase === 'aim')
  }
}

export default () => new Darts()
