import { Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { MatchSpec } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { BOT_SPEED, choose } from './bot.ts'
import { Flick } from './flick.ts'
import { handOf, hud, render } from './render.ts'
import {
  advance,
  type Dart,
  DARTS_PER_TURN,
  type Event,
  done,
  forceOf,
  landingOf,
  newState,
  type Pt,
  release,
  result,
  ROUNDS,
  sagOf,
  type State,
  throwDart,
} from './rules.ts'

/** Rounds of three darts each: the match length. */
export const match: MatchSpec = { unit: 'rounds', default: ROUNDS, min: 1, max: 10 }

/** Floats for the thrower sit over the middle of the board. */
const BOARD_X = 500

class Darts extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  private flicks: [Flick, Flick] = [new Flick(0), new Flick(1)]
  /** Cosmetic: the totals pop when they go up. */
  private pulse: [Spring, Spring] = [new Spring(0, 260, 11), new Spring(0, 260, 11)]

  protected setup(): State {
    // The player whose turn it is may flick from anywhere.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng.chance(0.5) ? 0 : 1, this.target)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  /** The computer steps up quickly, and quicker still between darts of the same visit. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    const base = d === 'easy' ? 0.6 : d === 'normal' ? 0.5 : 0.4
    return (this.s.throws > 0 ? base * 0.6 : base) + this.ctx.rng.range(0, 0.25)
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
      const fx = this.ctx.fx
      fx.confetti(r === 'draw' ? undefined : r)
      if (r !== 'draw') {
        fx.flash(SIDE[r].light, 0.25)
        fx.shake(0.3)
        fx.stop(5)
        fx.ring(BOARD_X, 900, SIDE[r].light, 520)
        floatFor(fx, r, 'Winner!')
      }
      return
    }
    super.step(dt)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const fl = this.flicks[side]
    fl.update(this.ctx.input.player(side))
    this.s.aim = fl.aim ? landingOf(side, fl.aim) : null
    this.s.aimSpeed = fl.aim ? fl.speed : 0
    const t = fl.throwFlick
    if (t) {
      // The release speed decides: a limp release sags short, a wild one wobbles.
      this.throwTo(release(side, t.f, t.speed, this.ctx.rng), t.speed)
      if (sagOf(t.speed) > 20)
        floatFor(this.ctx.fx, side, 'Too soft!', BOARD_X, side === 0 ? 1380 : 420)
    }
  }

  protected botPlay(): void {
    const side = this.s.turn
    this.throwTo(landingOf(side, choose(side, this.ctx.difficulty, this.ctx.rng)), BOT_SPEED)
  }

  private throwTo(to: Pt, speed: number): void {
    const side = this.s.turn
    const force = forceOf(speed)
    throwDart(this.s, to, force)
    this.s.aim = null
    this.s.aimSpeed = 0
    for (const f of this.flicks) f.cancel()
    const { audio } = this.ctx
    audio.play('swish', (side === 0 ? 1.0 : 1.08) + force * 0.35)
    if (force > 0.6) audio.play('whoosh', 0.9 + force * 0.4)
  }

  /** This turn's darts for the side that just threw. */
  private turnDarts(side: 0 | 1): Dart[] {
    const mine = this.s.darts.filter((d) => d.side === side)
    return mine.slice(mine.length - this.s.throws)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'stick' && e.dart.pts > 0) this.pulse[e.dart.side].kick(10 + e.dart.pts / 6)
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
    // The thunk: a short, heavy hit and a puff of sisal, harder for a harder throw.
    const k = d.force
    audio.play('thud', (d.ring === 'bull' ? 1.2 : 1) + k * 0.2)
    audio.play('hit', 1.35 + k * 0.3)
    audio.buzz(Math.round(8 + k * 16))
    fx.shake(0.1 + k * 0.16)
    fx.puff(d.x, d.y, 'rgba(240,225,190,0.55)', Math.round(3 + k * 5))
    fx.burst(d.x, d.y, '#e8d6a8', {
      count: Math.round(4 + k * 10),
      speed: 160 + k * 220,
      size: 6,
      life: 0.4,
      gravity: 0,
      drag: 4,
      kind: 'square',
    })
    if (k > 0.75) fx.stop(2)
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
    // Online, each phone shows only its own player's reticle and coaching.
    const mine = g.viewer === null || g.viewer === side
    for (const p of this.pulse) p.update(1 / 60)
    render(
      g,
      s,
      {
        aim: s.phase === 'aim' && !this.over && mine ? s.aim : null,
        speed: s.aimSpeed,
        hint: mine && s.phase === 'aim' && !this.isBot(side) && s.darts.length === 0 && !s.aim,
      },
      this.time,
    )
    for (const f of this.flicks) f.render(g)
    hud(g, s, [Math.max(0, this.pulse[0].value), Math.max(0, this.pulse[1].value)])
    this.drawTurns(g, undefined, s.phase === 'aim')
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    for (const p of this.pulse) p.set(0)
  }
}

export default () => new Darts()
