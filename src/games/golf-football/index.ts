import { floatFor } from '../../core/fx/fx.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { ShotParams } from '../../engines/aim/index.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { hud, render } from './render.ts'
import {
  advance,
  BAR,
  type Event,
  fire,
  forwardY,
  goalY,
  GOAL_X,
  newState,
  type Outcome,
  previewOf,
  result,
  spotOf,
  type State,
  WIND_MAX,
} from './rules.ts'
import { Swipe } from './swipe.ts'

const LABEL: Record<Outcome, string> = {
  good: "It's good!",
  low: 'Under the bar',
  over: 'Too high',
  wide: 'Wide!',
  short: 'Short!',
  post: 'Off the post!',
  bar: 'Off the bar!',
}

class GolfFootball extends TurnGame<State> {
  private swipes: [Swipe, Swipe] = [new Swipe(0), new Swipe(1)]
  /** The computer plans its kick when its turn starts, then swings toward it while "thinking". */
  private botShot: ShotParams | null = null

  protected setup(): State {
    // The player whose turn it is may swipe anywhere on the pitch.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng, this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind())
  }

  private rollWind(): number {
    const rng = this.ctx.rng
    return rng.chance(0.25) ? 0 : rng.range(-WIND_MAX, WIND_MAX)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    const winner = result(this.s)
    if (winner !== null) {
      this.s.endAt = this.time
      this.finish(winner, {
        score: [this.s.points[0], this.s.points[1]],
        note: this.s.sudden ? 'Sudden death decided it' : 'Most points after five kicks each',
        delay: 2.8,
      })
      this.ctx.fx.confetti(winner)
      this.ctx.fx.flash(SIDE[winner].light, 0.2)
      return
    }
    super.step(dt)
  }

  /** The ball keeps bouncing through the ending. */
  protected override afterEnd(dt: number): void {
    // The final score is level on kicks, so the beat never hands over a new turn.
    for (const e of advance(this.s, dt, () => this.s.wind)) if (e.kind === 'bounce') this.juice(e)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const sw = this.swipes[side]
    sw.update(this.ctx.input.player(side))
    this.s.aiming = sw.aim
    if (sw.shot) this.kick(sw.shot)
  }

  protected botPlay(): void {
    this.kick(this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private kick(shot: ShotParams): void {
    const side = this.s.turn
    const spot = spotOf(this.s, side)
    fire(this.s, shot)
    this.s.kickAt = this.time
    for (const sw of this.swipes) sw.cancel()
    const { fx, audio } = this.ctx
    audio.play('slap', 0.8)
    audio.play('whoosh', 0.8 + shot.power * 0.4)
    fx.ring(spot.x, spot.y, C.white, 90)
    fx.puff(spot.x, spot.y, 'rgba(255,255,255,0.8)', 10)
    fx.burst(spot.x, spot.y, C.grass, {
      count: 10,
      speed: 320,
      size: 10,
      life: 0.5,
      gravity: 0,
      drag: 3,
      dir: forwardY(side) < 0 ? Math.PI / 2 : -Math.PI / 2,
      spread: 1.4,
      colors: [C.grass, C.grassDark, C.white],
      kind: 'square',
    })
    fx.shake(0.1 + 0.12 * shot.power)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'turn') {
      audio.play('tick')
      this.botShot = this.isBot(e.side)
        ? choose(this.s, e.side, this.ctx.difficulty, this.ctx.rng)
        : null
      return
    }
    if (e.kind === 'sudden') {
      this.s.suddenAt = this.time
      audio.play('powerup')
      fx.flash(C.yellow, 0.25)
      fx.shake(0.2)
      return
    }
    if (e.kind === 'bounce') {
      audio.play('bounce', 0.7 + Math.min(0.5, e.speed / 1200))
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', 4)
      return
    }
    this.s.outAt = this.time
    const goal = goalY(e.side)
    // Where the ball crosses the plane on screen (heights stand up away from the kicker).
    const sy = goal + forwardY(e.side) * e.z * 0.6
    if (e.outcome === 'good') {
      audio.play('score')
      audio.play('coin', 1.2)
      audio.buzz(30)
      fx.burst(e.x, sy, C.yellow, {
        count: 34,
        speed: 520,
        size: 14,
        life: 0.9,
        gravity: 0,
        drag: 2.2,
        colors: [C.yellow, C.white, SIDE[e.side].light],
        kind: 'square',
      })
      fx.ring(e.x, sy, SIDE[e.side].light, 260)
      fx.ring(GOAL_X, goal + forwardY(e.side) * BAR * 0.6, C.yellow, 200)
      fx.flash(SIDE[e.side].light, 0.25)
      fx.shake(0.4)
      fx.stop(6)
      floatFor(fx, e.side, LABEL.good)
      return
    }
    if (e.outcome === 'post' || e.outcome === 'bar') {
      audio.play('wall', 0.7)
      audio.play('hit', 0.6)
      audio.buzz(25)
      fx.sparks(e.x, sy, C.white, 16)
      fx.ring(e.x, sy, C.white, 110)
      fx.shake(0.35)
      fx.stop(5)
    } else if (e.outcome === 'low') {
      audio.play('whoosh', 0.7)
      fx.shake(0.12)
    } else if (e.outcome === 'short') {
      audio.play('thud')
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.6)', 8)
      fx.shake(0.2)
    } else {
      audio.play('whoosh')
    }
    audio.play('error', 0.9)
    floatFor(fx, e.side, LABEL[e.outcome])
  }

  render(g: Draw): void {
    const s = this.s
    let aim: Parameters<typeof render>[2]['aim'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      if (s.aiming) {
        aim = { power: s.aiming.power, preview: previewOf(s, side, s.aiming) }
      } else if (this.isBot(side) && this.botShot) {
        // Swing the line toward the planned kick while thinking.
        const k = Math.min(1, this.thinking / 0.5)
        const planned = { dx: this.botShot.dx, dy: this.botShot.dy, power: this.botShot.power * k }
        aim = { power: planned.power, preview: previewOf(s, side, planned) }
      }
    }
    render(
      g,
      s,
      {
        aim,
        hint:
          s.phase === 'aim' &&
          !this.isBot(s.turn) &&
          s.kicks[0] === 0 &&
          s.kicks[1] === 0 &&
          !s.aiming,
      },
      this.time,
    )
    for (const side of [0, 1] as Side[]) this.swipes[side].render(g)
    hud(g, s)
    this.drawTurns(g, undefined, s.phase === 'aim')
  }
}

export default () => new GolfFootball()
