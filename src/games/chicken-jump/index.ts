import { type GameContext, type MatchSpec, other, type Side } from '../../core/game.ts'
import { clamp, lerp } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { mirrorFx, RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { decide, newPlan, type Plan } from './bot.ts'
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

/** First to N round wins: the players pick N before the match. */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 5 }

class ChickenJump extends RunnerGame<State> {
  /** The computer's plans (host only, never in the state). */
  private plans: [Plan, Plan] = [newPlan(), newPlan()]
  /** Cosmetic: each chicken's height and distance at the previous step, for interpolation. */
  private prev: [{ h: number; d: number }, { h: number; d: number }] = [
    { h: 0, d: 0 },
    { h: 0, d: 0 },
  ]
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

  protected override step(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const c = this.s.chickens[side]
      this.prev[side].h = c.h
      this.prev[side].d = c.dist
    }
    this.stepped = true
    super.step(dt)
  }

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
    let held = this.held(side) !== undefined
    if (this.isBot(side)) {
      const salt = side * 0x9e3779b1
      const i = decide(s.seed, c, speed, this.ctx.difficulty, this.time, this.plans[side], salt)
      if (i.tap) this.botTap(side)
      held = i.hold
    }
    const tap = this.taps(side) > 0
    const vh = c.vh
    this.react(side, stepChicken(s.seed, c, dt, speed, tap, held, this.time), vh, speed)
    // Decide the round once both lanes have stepped (both may crash on the same step).
    if (side === 1) this.judgeRound()
  }

  private react(side: Side, events: ChickEvent[], vh: number, speed: number): void {
    const c = this.s.chickens[side]
    const f = this.frames[side]
    const feet = toWorld(f, RUN_X, GROUND - c.h)
    const body = toWorld(f, RUN_X, GROUND - c.h - 60)
    const fx = this.ctx.fx
    const col = SIDE[side]
    for (const e of events) {
      if (e === 'jump') {
        // A held press is a big jump: a deeper boing and more dust.
        const big = c.hold > 0
        this.ctx.audio.play('boing', (big ? 0.9 : 1.1) + Math.random() * 0.08)
        fx.puff(feet.x, feet.y, alpha('#f4e3c9', 0.8), big ? 9 : 5)
        if (big) this.ctx.audio.buzz(8)
      } else if (e === 'land') {
        // The harder the landing, the bigger the thump.
        const k = clamp(-vh / 1400, 0, 1)
        this.ctx.audio.play('thud', 1.6 - k * 0.6)
        fx.puff(feet.x, feet.y, alpha('#f4e3c9', 0.7), Math.round(3 + k * 7))
        if (k > 0.75) {
          fx.shake(0.08 + (k - 0.75) * 0.5)
          this.ctx.audio.buzz(10)
        }
      } else if (e === 'egg') {
        c.scoreAt = this.time
        this.ctx.audio.play('coin', 1 + Math.min(0.5, c.eggs * 0.03))
        fx.sparks(body.x, body.y, C.yellow, 12)
        fx.ring(body.x, body.y, C.yellow, 90)
        const up = toWorld(f, RUN_X + 70, GROUND - c.h - 190)
        fx.float('+1', up.x, up.y, C.yellow, 56, side)
      } else if (e === 'die') {
        const pit = c.h <= 0 && pitUnder(this.s.seed, c.dist + RUN_X - 14, c.dist + RUN_X + 14)
        // Running into a fence at full tilt hurts more than at the start of the round.
        const k = pit ? 0.6 : clamp(Math.hypot(speed, vh) / 900, 0.4, 1)
        this.ctx.audio.play(pit ? 'whoosh' : 'slap', pit ? 0.55 : 1.15 - k * 0.3)
        this.ctx.audio.play('hit', 1.1 - k * 0.25)
        this.ctx.audio.buzz(Math.round(25 + k * 30))
        fx.burst(body.x, body.y, col.main, {
          count: Math.round(10 + k * 10),
          speed: 380 + k * 240,
          size: 13,
        })
        fx.burst(body.x, body.y, C.white, {
          count: Math.round(5 + k * 6),
          kind: 'emoji',
          glyph: '🪶',
          size: 46,
          speed: 360,
          gravity: 260,
          life: 1.3,
        })
        fx.ring(body.x, body.y, col.light, 120 + k * 80)
        fx.shake(0.25 + k * 0.3)
        fx.stop(Math.round(3 + k * 4))
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
    if (s.wins[w] >= this.target) {
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
    this.plans = [newPlan(), newPlan()]
    s.phase = 'wait'
    s.phaseAt = this.time
    s.flyT = 0
    s.roundWinner = null
    this.ctx.audio.play('count')
  }

  override render(g: Draw, alpha = 1): void {
    // Hit-stop freezes the world: no blending between two steps that are not moving.
    this.alpha = this.stepped && this.ctx.fx.hitstop === 0 ? alpha : 1
    super.render(g)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.stepped = false
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const c = s.chickens[side]
    const p = this.prev[side]
    // Blend toward the latest step, unless the chicken just jumped back (a new round).
    const a = Math.abs(c.dist - p.d) > 200 ? 1 : this.alpha
    const o: LaneView = {
      chicken: c,
      h: lerp(p.h, c.h, a),
      dist: lerp(p.d, c.dist, a),
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
      target: this.target,
    }
    drawLane(g, side, view, o)
  }
}

export default () => new ChickenJump()
