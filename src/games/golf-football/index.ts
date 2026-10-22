import { lerp, Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import type { MatchSpec, Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { hud, render } from './render.ts'
import {
  advance,
  BAR,
  type Event,
  fire,
  type Kick,
  LOFT_HIGH,
  LOFT_LOW,
  forwardY,
  goalY,
  GOAL_X,
  KICKS,
  newState,
  type Outcome,
  previewOf,
  result,
  spotOf,
  type State,
  type Swing,
  WIND_MAX,
} from './rules.ts'
import { Swipe } from './swipe.ts'

/** Kicks each before sudden death: the match length. */
export const match: MatchSpec = { unit: 'rounds', default: KICKS, min: 1, max: 10 }

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
  private get target(): number {
    return this.ctx.target || match.default
  }

  private swipes: [Swipe, Swipe] = [new Swipe(0), new Swipe(1)]
  /** The computer plans its kick when its turn starts, then swings toward it while "thinking". */
  private botShot: Swing | null = null
  // Cosmetic only (not synced): the ball's previous step for interpolation, points pulses.
  private prev: Kick | null = null
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]

  protected setup(): State {
    // The player whose turn it is may swipe anywhere on the pitch.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    return newState(this.ctx.rng, this.ctx.rng.chance(0.5) ? 0 : 1, this.rollWind(), this.target)
  }

  private rollWind(): number {
    const rng = this.ctx.rng
    return rng.chance(0.25) ? 0 : rng.range(-WIND_MAX, WIND_MAX)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override step(dt: number): void {
    this.prev = this.s.kick ? { ...this.s.kick } : null
    for (const e of advance(this.s, dt, () => this.rollWind())) this.juice(e)
    const winner = result(this.s)
    if (winner !== null) {
      const s = this.s
      s.endAt = this.time
      const early = s.kicks[0] !== s.kicks[1] || s.kicks[0] < s.regular
      this.finish(winner, {
        score: [s.points[0], s.points[1]],
        note: s.sudden
          ? 'Sudden death decided it'
          : early
            ? 'Out of reach before the last kick'
            : `Most points after ${this.target} ${this.target === 1 ? 'kick' : 'kicks'} each`,
        delay: 2.8,
      })
      this.ctx.fx.confetti(winner)
      this.ctx.fx.flash(SIDE[winner].light, 0.3)
      this.ctx.fx.shake(0.3)
      this.pulse[winner].kick(16)
      return
    }
    super.step(dt)
  }

  /** The ball keeps bouncing through the ending (but no new turn is handed over). */
  protected override afterEnd(dt: number): void {
    if (this.s.phase !== 'beat' || this.s.beat <= dt) return
    this.prev = this.s.kick ? { ...this.s.kick } : null
    for (const e of advance(this.s, dt, () => this.s.wind)) if (e.kind === 'bounce') this.juice(e)
  }

  protected stepTurn(dt: number): void {
    const side = this.s.turn
    const sw = this.swipes[side]
    sw.update(this.ctx.input.player(side), dt)
    this.s.aiming = sw.aim
    if (sw.shot) this.kick(sw.shot)
  }

  protected botPlay(): void {
    this.kick(this.botShot ?? choose(this.s, this.s.turn, this.ctx.difficulty, this.ctx.rng))
    this.botShot = null
  }

  private kick(shot: Swing): void {
    const side = this.s.turn
    const spot = spotOf(this.s, side)
    fire(this.s, shot)
    this.s.kickAt = this.time
    for (const sw of this.swipes) sw.cancel()
    const { fx, audio } = this.ctx
    // The boot meets the ball as hard as the swipe: a driven kick cracks, a floater thumps.
    const drive = Math.min(1, Math.max(0, ((shot.loft ?? 1) - LOFT_HIGH) / (LOFT_LOW - LOFT_HIGH)))
    const k = shot.power
    audio.play('slap', 0.7 + 0.3 * drive + 0.1 * k)
    audio.play('whoosh', 0.75 + k * 0.35 + drive * 0.2)
    audio.buzz(Math.round(8 + 14 * k + 8 * drive))
    fx.ring(spot.x, spot.y, C.white, 60 + 50 * k + 30 * drive)
    fx.puff(spot.x, spot.y, 'rgba(255,255,255,0.8)', Math.round(5 + 8 * k))
    if (k * (0.6 + 0.4 * drive) > 0.8) fx.stop(2)
    fx.burst(spot.x, spot.y, C.grass, {
      count: Math.round(5 + 10 * k),
      speed: 220 + 200 * k,
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
      const k = Math.min(1, e.speed / 700)
      audio.play('bounce', 0.7 + 0.5 * k)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', Math.round(2 + 5 * k))
      if (k > 0.5) fx.shake(0.05 * k)
      return
    }
    this.s.outAt = this.time
    const goal = goalY(e.side)
    // Where the ball crosses the plane on screen (heights stand up away from the kicker).
    const sy = goal + forwardY(e.side) * e.z * 0.6
    // A long kick is a bigger moment than a chip from close in.
    const far = Math.min(1, spotOf(this.s, e.side).d / 1000)
    if (e.outcome === 'good') {
      audio.play('score', 1.1 - 0.15 * far)
      audio.play('coin', 1.2)
      audio.buzz(Math.round(20 + 25 * far))
      this.pulse[e.side].kick(10 + 6 * far)
      fx.burst(e.x, sy, C.yellow, {
        count: Math.round(24 + 20 * far),
        speed: 420 + 200 * far,
        size: 14,
        life: 0.9,
        gravity: 0,
        drag: 2.2,
        colors: [C.yellow, C.white, SIDE[e.side].light],
        kind: 'square',
      })
      fx.ring(e.x, sy, SIDE[e.side].light, 260)
      fx.ring(GOAL_X, goal + forwardY(e.side) * BAR * 0.6, C.yellow, 200)
      fx.flash(SIDE[e.side].light, 0.18 + 0.15 * far)
      fx.shake(0.25 + 0.25 * far)
      fx.stop(4 + Math.round(4 * far))
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

  render(g: Draw, frac: number): void {
    const s = this.s
    for (const p of this.pulse) p.update(1 / 60)
    let aim: Parameters<typeof render>[2]['aim'] = null
    if (s.phase === 'aim' && !this.over) {
      const side = s.turn
      if (s.aiming) {
        aim = { power: s.aiming.power, preview: previewOf(s, side, s.aiming) }
      } else if (this.isBot(side) && this.botShot) {
        // Swing the line toward the planned kick while thinking.
        const k = Math.min(1, this.thinking / 0.5)
        const planned = { ...this.botShot, power: this.botShot.power * k }
        aim = { power: planned.power, preview: previewOf(s, side, planned) }
      }
    }
    // The ball drawn between steps.
    const p = this.prev
    const k = s.kick
    const view =
      k && p
        ? {
            ...s,
            kick: {
              ...k,
              x: lerp(p.x, k.x, frac),
              y: lerp(p.y, k.y, frac),
              z: lerp(p.z, k.z, frac),
            },
          }
        : s
    render(
      g,
      view,
      {
        aim,
        // Each human gets the hint before their own first kick, not only whoever kicks first.
        hint: s.phase === 'aim' && !this.isBot(s.turn) && s.kicks[s.turn] === 0 && !s.aiming,
      },
      this.time,
    )
    for (const side of [0, 1] as Side[]) {
      // Online, each phone shows only its own player's swipe.
      if (g.viewer === null || side === g.viewer) this.swipes[side].render(g)
    }
    hud(g, s, [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)])
    this.drawTurns(g, undefined, s.phase === 'aim')
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new GolfFootball()
