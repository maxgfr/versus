import { Joystick } from '../../core/controls.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { type Rounds, roundEnd, roundsNew, roundsStep } from '../../engines/reflex/index.ts'
import { W, type Stage } from '../../core/stage.ts'
import { DungBot } from './bot.ts'
import { type StickLook, renderDung } from './render.ts'
import {
  type Ev,
  flattens,
  newWorld,
  ROUND_T,
  roundWinner,
  stepWorld,
  type World,
  type Drive,
} from './rules.ts'

export interface State {
  w: World
  rounds: Rounds
  /** Stick looks, so the online guest can draw them. */
  sticks: StickLook[]
}

/** Rounds to win (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Pause between rounds, seconds. */
const BETWEEN = 2.2

/**
 * A stick under each player's thumb, in their strip outside the dish, laid out
 * as red sees it and mirrored for blue (same as the arena's sticks).
 */
function stickFor(stage: Stage, side: Side): Joystick {
  const left = stage.view.x
  const home = side === 0 ? { x: 250, y: 1585 } : { x: W - 250, y: 215 }
  const z = { x: left, y: 1510, w: 650 - left, h: 420 }
  const zone = side === 0 ? z : { x: W - (z.x + z.w), y: 1800 - (z.y + z.h), w: z.w, h: z.h }
  return new Joystick(side, zone, 104, home.x, home.y)
}

function lookOf(j: Joystick): StickLook {
  return {
    side: j.side,
    bx: j.baseX,
    by: j.baseY,
    kx: j.knobX,
    ky: j.knobY,
    r: j.radius,
    on: j.active,
  }
}

class DungBattle extends BaseGame<State> {
  private sticks: Joystick[] = []
  private bots: (DungBot | null)[] = []
  private ev: Ev[] = []
  /** Which side could flatten the other last step (host only, for the "now you can" cue). */
  private threat: [boolean, boolean] = [false, false]
  private tick = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.sticks = [stickFor(ctx.stage, 0), stickFor(ctx.stage, 1)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new DungBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      w: newWorld(ctx.rng),
      rounds: roundsNew(this.target),
      sticks: this.sticks.map(lookOf),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, BETWEEN)) {
      s.w = newWorld(ctx.rng)
      this.threat = [false, false]
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    const drives: Drive[] = ([0, 1] as Side[]).map((side) => {
      const stick = this.sticks[side] as Joystick
      const bot = this.bots[side]
      if (bot) {
        const d = bot.decide(s.w, side, dt)
        stick.set(d.jx, d.jy)
        return d
      }
      stick.update(ctx.input.player(side))
      return { jx: stick.x, jy: stick.y }
    })
    s.sticks = this.sticks.map(lookOf)
    if (!playing) {
      // Between rounds the flattened beetle keeps animating; nothing moves.
      s.w.t += dt
      return
    }
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    this.cues()
    const w = roundWinner(s.w)
    if (w === null) return
    ctx.audio.play('score')
    if (s.w.flattened === null) this.timeUp(w)
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.6 })
    }
  }

  /** A ball that just got big enough to flatten the rival, and the last seconds ticking. */
  private cues(): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    const [A, B] = w.bugs
    const now: [boolean, boolean] = [flattens(A.ball.r, B.ball.r), flattens(B.ball.r, A.ball.r)]
    for (const side of [0, 1] as Side[]) {
      if (now[side] && !this.threat[side]) {
        const b = w.bugs[side].ball
        audio.play('powerup', 1.1)
        fx.ring(b.x, b.y, C.yellow, b.r + 90)
        fx.sparks(b.x, b.y, C.yellow, 10)
      }
    }
    this.threat = now
    const left = Math.ceil(ROUND_T - w.t)
    if (left <= 5 && left > 0 && left !== this.tick) audio.play('tick', 1.3)
    this.tick = left
  }

  /** Time is up: the bigger ball takes the round with a thump. */
  private timeUp(w: Side | 'draw'): void {
    const { fx, audio } = this.ctx
    audio.play('buzz', 0.8)
    if (w === 'draw') return
    const b = this.s.w.bugs[w].ball
    fx.ring(b.x, b.y, SIDE[w].light, b.r + 140)
    fx.burst(b.x, b.y, SIDE[w].light, {
      count: 18,
      speed: 420,
      size: 12,
      life: 0.6,
      gravity: 200,
      colors: [SIDE[w].main, SIDE[w].light, C.yellow],
    })
    fx.shake(0.3)
  }

  protected override afterEnd(dt: number): void {
    this.s.w.t += dt
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'eat':
        audio.play('chomp', 0.9 + e.n * 0.025)
        fx.ring(e.x, e.y, SIDE[e.side].light, 60)
        fx.burst(e.x, e.y, '#7a4a22', {
          count: 7,
          speed: 240,
          size: 9,
          life: 0.45,
          gravity: 420,
          colors: ['#7a4a22', '#5a3316', '#a06a36'],
        })
        break
      case 'bump':
        audio.play('bounce', 0.95 + rng.next() * 0.1)
        fx.puff(e.x, e.y, 'rgba(200,170,120,0.55)', 4)
        break
      case 'clash':
        audio.play('thud', 0.9 + Math.min(0.4, e.speed / 900))
        audio.buzz(18)
        fx.burst(e.x, e.y, '#8c5a2b', {
          count: 16,
          speed: 380,
          size: 13,
          life: 0.55,
          gravity: 600,
          colors: ['#8c5a2b', '#c98a4b', C.white],
        })
        fx.shake(0.22)
        break
      case 'wall':
        audio.play('wall', 1.15)
        fx.puff(e.x, e.y, 'rgba(210,180,130,0.5)', 3)
        break
      case 'flatten':
        audio.play('explode', 0.8)
        audio.play('thud', 0.6)
        audio.buzz(90)
        fx.burst(e.x, e.y, '#7a4a22', {
          count: 40,
          speed: 620,
          size: 16,
          life: 0.8,
          gravity: 500,
          colors: ['#7a4a22', '#5a3316', C.yellow, C.white],
        })
        fx.ring(e.x, e.y, C.yellow, 260)
        fx.ring(e.x, e.y, SIDE[e.side === 0 ? 1 : 0].light, 180)
        fx.puff(e.x, e.y, 'rgba(160,110,60,0.6)', 10)
        fx.flash(SIDE[e.side === 0 ? 1 : 0].light, 0.35)
        fx.shake(0.8)
        fx.stop(12)
        break
    }
  }

  render(g: Draw): void {
    renderDung(g, this.s, this.time, this.ctx.names, this.over)
  }
}

export default () => new DungBattle()
