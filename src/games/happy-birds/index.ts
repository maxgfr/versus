import { other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { hash01, RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { shouldFlap } from './bot.ts'
import { drawLane } from './render.ts'
import {
  BIRD_X,
  type Bird,
  GROUND,
  newBird,
  ROUND_CAP,
  speedAt,
  stepBird,
  TARGET,
} from './rules.ts'

export interface State {
  birds: [Bird, Bird]
  wins: [number, number]
  round: number
  phase: 'wait' | 'fly' | 'end'
  phaseAt: number
  /** Seconds of flight this round: drives the speed. */
  flyT: number
  /** Each round gets a fresh course, the same for both lanes. */
  course: number
  roundWinner: Side | 'draw' | null
}

const WAIT = 1.1
const END = 1.9

class HappyBirds extends RunnerGame<State> {
  protected setup(): State {
    return {
      birds: [newBird(), newBird()],
      wins: [0, 0],
      round: 1,
      phase: 'wait',
      phaseAt: 0,
      flyT: 0,
      course: this.courseFor(1),
      roundWinner: null,
    }
  }

  private courseFor(round: number): number {
    return Math.floor(hash01(this.ctx.seed, round, 11) * 2 ** 31)
  }

  protected override stepWorld(dt: number): boolean {
    const s = this.s
    const since = this.time - s.phaseAt
    if (s.phase === 'wait') {
      for (const b of s.birds) b.y = 380 + Math.sin(this.time * 5) * 14
      if (since >= WAIT) {
        s.phase = 'fly'
        s.phaseAt = this.time
        for (const b of s.birds) b.vy = -500
      }
      return false
    }
    if (s.phase === 'end') {
      // The winner hovers; the loser lies on the ground.
      for (const b of s.birds) this.drop(b, dt)
      if (since >= END) this.nextRound()
      return false
    }
    s.flyT += dt
    return true
  }

  /** Dead birds tumble to the ground; living ones bob while the world is stopped. */
  private drop(b: Bird, dt: number): void {
    if (b.alive) {
      b.y += (380 + Math.sin(this.time * 5) * 14 - b.y) * Math.min(1, dt * 4)
      b.vy = 0
      return
    }
    b.vy = Math.min(1600, b.vy + 2500 * dt)
    b.y = Math.min(GROUND - 30, b.y + b.vy * dt)
  }

  protected stepRunner(side: Side, dt: number): void {
    const b = this.s.birds[side]
    if (!b.alive) {
      this.drop(b, dt)
    } else this.fly(side, b, dt)
    // Decide the round once both lanes have stepped (both may crash on the same step).
    if (side === 1) this.judge()
  }

  private fly(side: Side, b: Bird, dt: number): void {
    const s = this.s
    if (
      this.isBot(side) &&
      shouldFlap(s.course, b, this.time, this.ctx.difficulty, side * 0x9e3779b1)
    )
      this.botTap(side)
    const flapNow = this.taps(side) > 0
    if (flapNow) this.ctx.audio.play('swish', 1.3 + Math.random() * 0.2)
    const r = stepBird(s.course, b, dt, speedAt(s.flyT), flapNow, this.time)
    if (r === 'pipe') {
      this.ctx.audio.play('coin', 1 + Math.min(0.5, b.pipes * 0.02))
    } else if (r === 'crash') {
      b.alive = false
      b.deadAt = this.time
      b.vy = -420
      const at = toWorld(this.frames[side], BIRD_X, b.y)
      this.ctx.audio.play('hit')
      this.ctx.audio.play('thud')
      this.ctx.audio.buzz(40)
      this.ctx.fx.burst(at.x, at.y, SIDE[side].main, { count: 18, speed: 520, size: 14 })
      this.ctx.fx.burst(at.x, at.y, C.white, {
        count: 5,
        kind: 'emoji',
        glyph: '🪶',
        size: 44,
        speed: 300,
        gravity: 300,
        life: 1.1,
      })
      this.ctx.fx.shake(0.45)
      this.ctx.fx.stop(5)
    }
  }

  private judge(): void {
    const s = this.s
    const [r, b] = s.birds
    let w: Side | 'draw' | null = null
    if (!r.alive && !b.alive) w = 'draw'
    else if (!r.alive) w = 1
    else if (!b.alive) w = 0
    else if (s.flyT >= ROUND_CAP) w = 'draw'
    if (w === null) return
    s.phase = 'end'
    s.phaseAt = this.time
    s.roundWinner = w
    if (w !== 'draw') {
      s.wins[w]++
      this.ctx.audio.play('score')
      if (s.wins[w] >= TARGET) this.finish(w, { score: s.wins, delay: END })
    } else this.ctx.audio.play('draw')
  }

  private nextRound(): void {
    const s = this.s
    if (this.over) return
    s.round++
    s.course = this.courseFor(s.round)
    s.birds = [newBird(), newBird()]
    s.phase = 'wait'
    s.phaseAt = this.time
    s.flyT = 0
    s.roundWinner = null
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    drawLane(g, side, view, {
      bird: s.birds[side],
      course: s.course,
      time: this.time,
      phase: s.phase,
      since: this.time - s.phaseAt,
      wins: s.wins[side],
      rivalWins: s.wins[other(side)],
      round: s.round,
      roundWinner: s.roundWinner,
      name: this.ctx.names[side],
      bot: this.isBot(side),
      matchOver: this.over,
    })
  }
}

export default () => new HappyBirds()
