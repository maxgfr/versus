import { type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { clock } from '../../core/hud.ts'
import { MID } from '../../core/stage.ts'
import { RunnerGame, toLocal, toWorld } from '../../engines/runner/index.ts'
import { steer } from './bot.ts'
import { drawLane, type LaneView } from './render.ts'
import {
  BASE_Y,
  type ClimbEvent,
  type Climber,
  fallDead,
  judge,
  metres,
  newClimber,
  ROUND_T,
  stepClimber,
} from './rules.ts'

export interface State {
  climbers: [Climber, Climber]
  /** The course: both halves climb the same platforms. */
  seed: number
  phase: 'wait' | 'fly' | 'end'
  phaseAt: number
  /** Seconds of climbing: the clock. */
  flyT: number
  winner: Side | 'draw' | null
  /** Why it ended: someone fell out, or the clock ran out. */
  cause: 'out' | 'time' | null
}

const WAIT = 1.1
/** Finger offset (lane units) from the half's middle that steers at full speed. */
const STEER_SPAN = 200
/** A shout every this many metres. */
const MILESTONE = 100
const FINAL = 2.4

/** A timed match: the players pick its length in seconds. */
export const match: MatchSpec = { unit: 'seconds', default: ROUND_T, min: 15, max: 180, step: 15 }

class FlappyJump extends RunnerGame<State> {
  private get limit(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      climbers: [newClimber(), newClimber()],
      seed: this.ctx.rng.int(1, 0x7ffffff0),
      phase: 'wait',
      phaseAt: 0,
      flyT: 0,
      winner: null,
      cause: null,
    }
  }

  protected override stepWorld(dt: number): boolean {
    const s = this.s
    if (s.phase === 'wait') {
      if (this.time - s.phaseAt >= WAIT) {
        s.phase = 'fly'
        s.phaseAt = this.time
        this.ctx.audio.play('whoosh', 1.2)
      }
      return false
    }
    // The last five seconds tick.
    const before = Math.ceil(this.limit - s.flyT)
    s.flyT += dt
    const after = Math.ceil(this.limit - s.flyT)
    if (after !== before && after <= 5 && after > 0) this.ctx.audio.play('tick', 1.4)
    return true
  }

  /** Hold left or right of your half to steer; the further from the middle, the faster. */
  private steerInput(side: Side): number {
    if (this.isBot(side))
      return steer(
        this.s.seed,
        this.s.climbers[side],
        this.time,
        this.ctx.difficulty,
        side * 0x9e3779b1,
      )
    const p = this.held(side)
    if (!p) return 0
    const x = toLocal(this.frames[side], p.x, p.y).x
    const d = (x - 500) / STEER_SPAN
    return Math.max(-1, Math.min(1, d))
  }

  protected stepRunner(side: Side, dt: number): void {
    const c = this.s.climbers[side]
    const mark = Math.floor(metres(c) / MILESTONE)
    this.react(side, stepClimber(this.s.seed, c, dt, this.time, this.steerInput(side)))
    if (c.alive && Math.floor(metres(c) / MILESTONE) > mark) this.milestone(side)
    // Decide once both halves have stepped.
    if (side === 1) this.judgeMatch()
  }

  protected override afterEnd(dt: number): void {
    for (const c of this.s.climbers) if (!c.alive) fallDead(c, dt)
  }

  private at(side: Side, dy = 0): { x: number; y: number } {
    const c = this.s.climbers[side]
    return toWorld(this.frames[side], c.x, BASE_Y - (c.h - c.cam) + dy)
  }

  private milestone(side: Side): void {
    const c = this.s.climbers[side]
    const f = this.frames[side]
    const y = BASE_Y - (c.h - c.cam) - 60
    const p = toWorld(f, c.x, y)
    // The shout sits beside the climber, on the roomier side, clear of the counter.
    const t = toWorld(f, c.x > 500 ? c.x - 230 : c.x + 230, y + 40)
    this.ctx.audio.play('powerup')
    this.ctx.fx.ring(p.x, p.y, C.yellow, 220)
    this.ctx.fx.sparks(p.x, p.y, C.yellow, 20)
    const m = Math.floor(metres(c) / MILESTONE) * MILESTONE
    this.ctx.fx.float(`${m} m!`, t.x, t.y, C.yellow, 64, side)
  }

  private react(side: Side, events: ClimbEvent[]): void {
    const c = this.s.climbers[side]
    const feet = this.at(side)
    const body = this.at(side, -60)
    const fx = this.ctx.fx
    const col = SIDE[side]
    for (const e of events) {
      if (e === 'bounce') {
        this.ctx.audio.play('boing', 0.9 + Math.min(0.5, c.h / 4000))
        fx.puff(feet.x, feet.y, alpha(C.white, 0.6), 5)
      } else if (e === 'crumble') {
        this.ctx.audio.play('slap', 0.8)
        fx.burst(feet.x, feet.y, C.wood, {
          count: 14,
          speed: 360,
          size: 11,
          gravity: 1200,
          kind: 'square',
        })
      } else if (e === 'best') {
        this.ctx.audio.play('pop', 1 + Math.min(0.6, c.best * 0.01))
        fx.sparks(feet.x, feet.y, col.light, 6)
      } else if (e === 'out') {
        this.ctx.audio.play('whoosh', 0.55)
        this.ctx.audio.play('thud')
        this.ctx.audio.buzz(40)
        fx.burst(body.x, body.y, col.main, { count: 22, speed: 560, size: 14 })
        fx.ring(body.x, body.y, col.light, 180)
        fx.shake(0.5)
        fx.stop(6)
      }
    }
  }

  private judgeMatch(): void {
    const s = this.s
    const w = judge(s.climbers[0], s.climbers[1], s.flyT, this.limit)
    if (w === null || this.over) return
    s.phase = 'end'
    s.phaseAt = this.time
    s.winner = w
    s.cause = s.climbers[0].alive && s.climbers[1].alive ? 'time' : 'out'
    const score: [number, number] = [metres(s.climbers[0]), metres(s.climbers[1])]
    if (w !== 'draw') {
      const c = s.climbers[w]
      const at = this.at(w, -60)
      this.ctx.fx.ring(at.x, at.y, C.yellow, 220)
      this.ctx.fx.sparks(at.x, at.y, C.yellow, 18)
      this.ctx.fx.confetti(w)
      this.ctx.fx.flash(SIDE[w].light, 0.3)
      if (c.alive && s.cause === 'time') this.ctx.audio.play('buzz')
    }
    this.finish(w, { score, delay: FINAL })
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const o: LaneView = {
      climber: s.climbers[side],
      rival: s.climbers[other(side)],
      seed: this.s.seed,
      time: this.time,
      phase: s.phase,
      since: this.time - s.phaseAt,
      name: this.ctx.names[side],
      bot: this.isBot(side),
      winner: s.winner,
      cause: s.cause,
      hudTop: this.ctx.mode === '1p' && side === 1,
    }
    drawLane(g, side, view, o)
  }

  protected override renderOver(g: Draw): void {
    const s = this.s
    if (s.phase !== 'fly') return
    clock(g, this.limit - s.flyT, MID, this.limit - s.flyT <= 10)
  }
}

export default () => new FlappyJump()
