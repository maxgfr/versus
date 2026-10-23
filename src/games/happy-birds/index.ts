import { type GameContext, other, type MatchSpec, type Side } from '../../core/game.ts'
import { clamp, lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { hash01, mirrorFx, RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { shouldFlap } from './bot.ts'
import { drawLane, type Trail } from './render.ts'
import {
  BIRD_R,
  BIRD_X,
  type Bird,
  FLAP,
  GROUND,
  MAX_FALL,
  newBird,
  pipe,
  PIPE_W,
  ROUND_CAP,
  speedAt,
  stepBird,
  TARGET,
  tempoOf,
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
  /** Game time each bird last cleared a pipe, for the counter pop. */
  passAt: [number, number]
  /** Scroll-speed multiplier set by the computer's level (1 without a bot), fixed at setup. */
  tempo: number
}

const WAIT = 1.1
const END = 1.9
/** A pipe cleared with less room than this (units) is a close shave. */
const CLOSE = 18
/** Every this many pipes in a row, a shout. */
const STREAK = 5

/** Round wins needed to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

/** Cosmetic per-lane memory: never in the state, rebuilt on restore. */
interface Look {
  /** Bird height and scroll at the previous step, for interpolation. */
  py: number
  pd: number
  /** Tightest room left between the bird and the pipe it is threading (host only). */
  room: number
  trail: Trail
  /** Squash & stretch of the body. */
  squash: Spring
}

function newLook(): Look {
  return {
    py: 0,
    pd: 0,
    room: Infinity,
    trail: { y: new Float32Array(10), d: new Float32Array(10), n: 0, head: 0 },
    squash: new Spring(1, 420, 13),
  }
}

class HappyBirds extends RunnerGame<State> {
  private looks: [Look, Look] = [newLook(), newLook()]
  /** Whether `py` / `pd` hold the previous step (false on the guest and right after a reset). */
  private stepped = false
  private alpha = 1

  private get target(): number {
    return this.ctx.target || match.default
  }

  override init(ctx: GameContext): void {
    super.init(ctx)
    // Effects land where each lane is drawn, also when a half is shown turned (online).
    mirrorFx(ctx, this.frames)
  }

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
      passAt: [-10, -10],
      tempo: tempoOf(this.ctx.difficulty, this.ctx.bots),
    }
  }

  private courseFor(round: number): number {
    return Math.floor(hash01(this.ctx.seed, round, 11) * 2 ** 31)
  }

  protected override step(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const b = this.s.birds[side]
      const l = this.looks[side]
      l.py = b.y
      l.pd = b.dist
    }
    this.stepped = true
    super.step(dt)
  }

  protected override stepWorld(dt: number): boolean {
    const s = this.s
    const since = this.time - s.phaseAt
    if (s.phase === 'wait') {
      for (const b of s.birds) b.y = 380 + Math.sin(this.time * 5) * 14
      if (since >= WAIT) {
        s.phase = 'fly'
        s.phaseAt = this.time
        for (const b of s.birds) {
          b.vy = -500
          b.flapAt = this.time
        }
        this.ctx.audio.play('whoosh', 1.2)
        for (const l of this.looks) l.squash.kick(4)
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
    const was = b.y
    b.vy = Math.min(1600, b.vy + 2500 * dt)
    b.y = Math.min(GROUND - 30, b.y + b.vy * dt)
    // The body bounces once when it hits the dirt.
    if (was < GROUND - 30 && b.y >= GROUND - 30) {
      const side = this.s.birds[0] === b ? 0 : 1
      const at = toWorld(this.frames[side], BIRD_X, GROUND - 4)
      this.ctx.fx.puff(at.x, at.y, alpha('#e8c48f', 0.85), 9)
      this.ctx.audio.play('thud', 0.8)
      this.looks[side].squash.kick(-6)
    }
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
    const l = this.looks[side]
    if (
      this.isBot(side) &&
      shouldFlap(s.course, b, this.time, this.ctx.difficulty, side * 0x9e3779b1, s.flyT, s.tempo)
    )
      this.botTap(side)
    const flapNow = this.taps(side) > 0
    const vy0 = b.vy
    const speed = speedAt(s.flyT, s.tempo)
    const r = stepBird(s.course, b, dt, speed, flapNow, this.time)
    if (flapNow) {
      // Effort: a flap that turns a hard dive around is a big one.
      const k = clamp((vy0 + FLAP * 0.3) / (MAX_FALL + FLAP * 0.3), 0, 1)
      this.ctx.audio.play('swish', 1.45 - k * 0.45 + Math.random() * 0.1)
      l.squash.kick(3 + k * 5)
      const tail = toWorld(this.frames[side], BIRD_X - 34, b.y + 26)
      this.ctx.fx.puff(tail.x, tail.y, alpha(C.white, 0.45 + k * 0.3), Math.round(2 + k * 5))
      if (k > 0.7) this.ctx.audio.buzz(8)
    }
    this.measureRoom(s.course, b, l)
    if (r === 'pipe') this.cleared(side, b, l)
    else if (r === 'crash') this.crash(side, b, vy0, speed)
  }

  /** Tightest room between the bird and the walls of the pipe it is inside. */
  private measureRoom(course: number, b: Bird, l: Look): void {
    const p = pipe(course, b.pipes)
    const bx = b.dist + BIRD_X
    if (bx + BIRD_R < p.x || bx - BIRD_R > p.x + PIPE_W) return
    const room = Math.min(b.y - (p.gapY - p.gapH / 2), p.gapY + p.gapH / 2 - b.y) - BIRD_R
    l.room = Math.min(l.room, room)
  }

  private cleared(side: Side, b: Bird, l: Look): void {
    const fx = this.ctx.fx
    const close = l.room < CLOSE
    l.room = Infinity
    this.s.passAt[side] = this.time
    const streak = b.pipes % STREAK === 0
    this.ctx.audio.play('coin', 1 + Math.min(0.5, b.pipes * 0.02))
    const at = toWorld(this.frames[side], BIRD_X, b.y)
    fx.sparks(at.x, at.y, C.yellow, close ? 16 : 8)
    // Kept below the lane's counter pill, which sits along the top of the lane.
    const up = toWorld(this.frames[side], BIRD_X + 70, Math.max(230, b.y - 100))
    if (close) {
      this.ctx.audio.play('zap', 1.5)
      this.ctx.audio.buzz(12)
      fx.ring(at.x, at.y, C.white, 120)
      fx.float('Close!', up.x, up.y, C.white, 56, side)
    } else fx.float('+1', up.x, up.y, C.yellow, 52, side)
    if (streak) {
      this.ctx.audio.play('powerup', 1 + Math.min(0.4, b.pipes * 0.01))
      fx.ring(at.x, at.y, C.yellow, 200)
      const shout = toWorld(this.frames[side], BIRD_X + 300, Math.max(260, b.y - 40))
      fx.float(`${b.pipes}!`, shout.x, shout.y, C.yellow, 72, side)
    }
  }

  /** A crash hurts as much as the bird was flying: a dive into the ground is the worst. */
  private crash(side: Side, b: Bird, vy0: number, speed: number): void {
    const fx = this.ctx.fx
    const k = clamp(Math.hypot(speed, Math.max(0, vy0)) / 1500, 0.3, 1)
    b.alive = false
    b.deadAt = this.time
    b.vy = -420
    this.looks[side].squash.kick(-5 - k * 6)
    const at = toWorld(this.frames[side], BIRD_X, b.y)
    this.ctx.audio.play('hit', 1.15 - k * 0.3)
    this.ctx.audio.play('thud')
    this.ctx.audio.buzz(Math.round(25 + k * 30))
    fx.burst(at.x, at.y, SIDE[side].main, {
      count: Math.round(10 + k * 14),
      speed: 380 + k * 260,
      size: 14,
    })
    fx.burst(at.x, at.y, C.white, {
      count: Math.round(3 + k * 4),
      kind: 'emoji',
      glyph: '🪶',
      size: 44,
      speed: 300,
      gravity: 300,
      life: 1.1,
    })
    fx.ring(at.x, at.y, SIDE[side].light, 120 + k * 80)
    fx.shake(0.25 + k * 0.3)
    fx.stop(Math.round(3 + k * 3))
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
      // The round's winner gets a burst of light where it flies.
      const at = toWorld(this.frames[w], BIRD_X, s.birds[w].y)
      this.ctx.fx.ring(at.x, at.y, C.yellow, 180)
      this.ctx.fx.sparks(at.x, at.y, C.yellow, 14)
      this.looks[w].squash.kick(6)
      if (s.wins[w] >= this.target) {
        this.ctx.fx.confetti(w)
        this.ctx.fx.flash(SIDE[w].light, 0.3)
        this.finish(w, { score: s.wins, delay: END + 0.4 })
      } else this.ctx.audio.play('score')
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
    s.passAt = [-10, -10]
    for (const l of this.looks) {
      l.trail.n = 0
      l.room = Infinity
    }
    this.ctx.audio.play('count')
  }

  /** While the ending plays, the winner hovers and the loser tumbles down. */
  protected override afterEnd(dt: number): void {
    for (const b of this.s.birds) this.drop(b, dt)
  }

  override render(g: Draw, alpha = 1): void {
    // Hit-stop freezes the world: no blending between two steps that are not moving.
    this.alpha = this.stepped && this.ctx.fx.hitstop === 0 ? alpha : 1
    super.render(g)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.stepped = false
    for (const l of this.looks) l.trail.n = 0
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const b = s.birds[side]
    const l = this.looks[side]
    // Blend toward the latest step, unless the bird just jumped (a new round).
    const fresh = Math.abs(b.dist - l.pd) > 200 || Math.abs(b.y - l.py) > 200
    const a = fresh ? 1 : this.alpha
    const y = lerp(l.py, b.y, a)
    const dist = lerp(l.pd, b.dist, a)
    l.squash.update(1 / 60)
    // Rendered once per lane per frame: the trail samples here.
    const t = l.trail
    if (s.phase === 'fly' && b.alive) {
      t.y[t.head] = y
      t.d[t.head] = dist
      t.head = (t.head + 1) % t.y.length
      t.n = Math.min(t.y.length, t.n + 1)
    } else if (t.n > 0) t.n--
    drawLane(g, side, view, {
      bird: b,
      y,
      dist,
      squash: l.squash.value,
      trail: t,
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
      target: this.target,
      passAt: s.passAt[side],
      speed: speedAt(s.flyT, s.tempo),
    })
  }
}

export default () => new HappyBirds()
