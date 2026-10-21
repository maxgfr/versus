import { other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { shouldJump } from './bot.ts'
import { drawLane, type LaneView } from './render.ts'
import {
  type ChickEvent,
  type Chicken,
  fallDead,
  GROUND,
  judge,
  newChicken,
  pitUnder,
  RUN_X,
  speedAt,
  stepChicken,
  TARGET,
} from './rules.ts'

export interface State {
  chickens: [Chicken, Chicken]
  wins: [number, number]
  round: number
  /** The course of this round: both lanes run the same obstacles and eggs. */
  seed: number
  phase: 'wait' | 'fly' | 'end'
  phaseAt: number
  /** Seconds of running this round: drives the speed. */
  flyT: number
  roundWinner: Side | 'draw' | null
}

const WAIT = 1.1
const END = 1.9
/** The match's last moment lingers a little longer before the result screen. */
const FINAL = 2.4

class ChickenJump extends RunnerGame<State> {
  protected setup(): State {
    return {
      chickens: [newChicken(), newChicken()],
      wins: [0, 0],
      round: 1,
      seed: this.courseSeed(),
      phase: 'wait',
      phaseAt: 0,
      flyT: 0,
      roundWinner: null,
    }
  }

  private courseSeed(): number {
    return this.ctx.rng.int(1, 0x7ffffff0)
  }

  protected override stepWorld(dt: number): boolean {
    const s = this.s
    const since = this.time - s.phaseAt
    if (s.phase === 'wait') {
      if (since >= WAIT) {
        s.phase = 'fly'
        s.phaseAt = this.time
        this.ctx.audio.play('whoosh', 1.2)
      }
      return false
    }
    if (s.phase === 'end') {
      for (const c of s.chickens) if (!c.alive) fallDead(s.seed, c, dt)
      if (since >= END) this.nextRound()
      return false
    }
    s.flyT += dt
    return true
  }

  protected stepRunner(side: Side, dt: number): void {
    const s = this.s
    const c = s.chickens[side]
    const speed = speedAt(s.flyT)
    if (this.isBot(side) && shouldJump(s.seed, c, speed, this.ctx.difficulty, side * 0x9e3779b1))
      this.botTap(side)
    const tap = this.taps(side) > 0
    const held = this.held(side) !== undefined
    this.react(side, stepChicken(s.seed, c, dt, speed, tap, held, this.time))
    // Decide the round once both lanes have stepped (both may crash on the same step).
    if (side === 1) this.judgeRound()
  }

  private react(side: Side, events: ChickEvent[]): void {
    const c = this.s.chickens[side]
    const f = this.frames[side]
    const feet = toWorld(f, RUN_X, GROUND - c.h)
    const body = toWorld(f, RUN_X, GROUND - c.h - 60)
    const fx = this.ctx.fx
    const col = SIDE[side]
    for (const e of events) {
      if (e === 'jump') {
        this.ctx.audio.play('boing', 1.05 + Math.random() * 0.1)
        fx.puff(feet.x, feet.y, alpha('#f4e3c9', 0.8), 6)
      } else if (e === 'land') {
        this.ctx.audio.play('thud', 1.4)
        fx.puff(feet.x, feet.y, alpha('#f4e3c9', 0.7), 5)
      } else if (e === 'egg') {
        c.scoreAt = this.time
        this.ctx.audio.play('coin', 1 + Math.min(0.5, c.eggs * 0.03))
        fx.sparks(body.x, body.y, C.yellow, 12)
        fx.ring(body.x, body.y, C.yellow, 90)
        const up = toWorld(f, RUN_X + 70, GROUND - c.h - 190)
        fx.float('+1', up.x, up.y, C.yellow, 56, side)
      } else if (e === 'die') {
        const pit = c.h <= 0 && pitUnder(this.s.seed, c.dist + RUN_X - 14, c.dist + RUN_X + 14)
        this.ctx.audio.play(pit ? 'whoosh' : 'slap', pit ? 0.55 : 1)
        this.ctx.audio.play('hit')
        this.ctx.audio.buzz(40)
        fx.burst(body.x, body.y, col.main, { count: 16, speed: 520, size: 13 })
        fx.burst(body.x, body.y, C.white, {
          count: 9,
          kind: 'emoji',
          glyph: '🪶',
          size: 46,
          speed: 360,
          gravity: 260,
          life: 1.3,
        })
        fx.ring(body.x, body.y, col.light, 170)
        fx.shake(0.5)
        fx.stop(6)
      }
    }
  }

  private judgeRound(): void {
    const s = this.s
    const w = judge(s.chickens[0], s.chickens[1], s.flyT)
    if (w === null) return
    s.phase = 'end'
    s.phaseAt = this.time
    s.roundWinner = w
    if (w === 'draw') {
      this.ctx.audio.play('draw')
      return
    }
    s.wins[w]++
    // The round's winner gets a burst of light where it runs.
    const c = s.chickens[w]
    const at = toWorld(this.frames[w], RUN_X, GROUND - c.h - 60)
    this.ctx.fx.ring(at.x, at.y, C.yellow, 200)
    this.ctx.fx.sparks(at.x, at.y, C.yellow, 16)
    if (s.wins[w] >= TARGET) {
      this.ctx.fx.confetti(w)
      this.ctx.fx.flash(SIDE[w].light, 0.3)
      this.finish(w, { score: s.wins, delay: FINAL })
    } else this.ctx.audio.play('score')
  }

  /** While the ending plays, the loser keeps tumbling. */
  protected override afterEnd(dt: number): void {
    const s = this.s
    for (const c of s.chickens) if (!c.alive) fallDead(s.seed, c, dt)
  }

  private nextRound(): void {
    const s = this.s
    if (this.over) return
    s.round++
    s.seed = this.courseSeed()
    s.chickens = [newChicken(), newChicken()]
    s.phase = 'wait'
    s.phaseAt = this.time
    s.flyT = 0
    s.roundWinner = null
    this.ctx.audio.play('count')
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const o: LaneView = {
      chicken: s.chickens[side],
      seed: s.seed,
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
    }
    drawLane(g, side, view, o)
  }
}

export default () => new ChickenJump()
