import { type GameContext, type MatchSpec, other, type Side } from '../../core/game.ts'
import { clamp, lerp } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { mirrorFx, RunnerGame, toWorld } from '../../engines/runner/index.ts'
import { newPlan, type Plan, shouldFlip } from './bot.ts'
import { drawLane, type LaneView } from './render.ts'
import {
  judge,
  newRunner,
  RUN_R,
  RUN_X,
  type Runner,
  type RunEvent,
  speedAt,
  spikeHit,
  stepRunner,
  TARGET,
  fallDead,
} from './rules.ts'

export interface State {
  runners: [Runner, Runner]
  wins: [number, number]
  round: number
  /** The corridor of this round: both lanes run the same course. */
  seed: number
  phase: 'wait' | 'fly' | 'end'
  phaseAt: number
  /** Seconds of flight this round: drives the speed. */
  flyT: number
  roundWinner: Side | 'draw' | null
}

const WAIT = 1.1
const END = 1.9
/** The match's last moment lingers a little longer before the result screen. */
const FINAL = 2.4

/** A match is first to N round wins. */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class GravityRun extends RunnerGame<State> {
  /** The computer's plans (host only, never in the state). */
  private plans: [Plan, Plan] = [newPlan(), newPlan()]
  /** Cosmetic: each runner's height and distance at the previous step, for interpolation. */
  private prev: [{ y: number; d: number }, { y: number; d: number }] = [
    { y: 0, d: 0 },
    { y: 0, d: 0 },
  ]
  private stepped = false
  private alpha = 1

  override init(ctx: GameContext): void {
    super.init(ctx)
    // Effects land where each lane is drawn, also when a half is shown turned (online).
    mirrorFx(ctx, this.frames)
  }

  protected override step(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const r = this.s.runners[side]
      this.prev[side].y = r.y
      this.prev[side].d = r.dist
    }
    this.stepped = true
    super.step(dt)
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
  /** Round wins to take the match. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      runners: [newRunner(), newRunner()],
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
      // The loser keeps falling into the void while the winner stands still.
      for (const r of s.runners) if (!r.alive) fallDead(r, dt)
      if (since >= END) this.nextRound()
      return false
    }
    s.flyT += dt
    return true
  }

  protected stepRunner(side: Side, dt: number): void {
    const s = this.s
    const r = s.runners[side]
    const speed = speedAt(s.flyT)
    if (
      this.isBot(side) &&
      shouldFlip(s.seed, r, speed, this.ctx.difficulty, this.plans[side], side * 0x9e3779b1)
    )
      this.botTap(side)
    const flip = this.taps(side) > 0
    const vy = r.vy
    this.react(side, stepRunner(s.seed, r, dt, speed, flip, this.time), vy, speed)
    // Decide the round once both lanes have stepped (both may fall on the same step).
    if (side === 1) this.judgeRound()
  }

  private react(side: Side, events: RunEvent[], vy: number, speed: number): void {
    const r = this.s.runners[side]
    const f = this.frames[side]
    const at = toWorld(f, RUN_X, r.y)
    const fx = this.ctx.fx
    const col = SIDE[side]
    for (const e of events) {
      if (e === 'flip') {
        this.ctx.audio.play('flip', 1 + (r.mul - 0.8) * 0.4)
        // The push-off: a jet of sparks off the surface it leaves.
        const foot = toWorld(f, RUN_X, r.y - r.g * RUN_R)
        fx.sparks(foot.x, foot.y, col.light, 8)
        fx.puff(foot.x, foot.y, alpha(C.white, 0.5), 4)
      } else if (e === 'land') {
        // Slamming into the far surface: harder after a long fall.
        const k = clamp(Math.abs(vy) / 1700, 0, 1)
        this.ctx.audio.play('click', 0.6 + k * 0.3)
        this.ctx.audio.play('thud', 1.6 - k * 0.5)
        const foot = toWorld(f, RUN_X, r.y + r.g * RUN_R)
        fx.puff(foot.x, foot.y, alpha(col.light, 0.6), Math.round(3 + k * 5))
        fx.sparks(foot.x, foot.y, col.light, Math.round(3 + k * 8))
        if (k > 0.6) {
          fx.shake(0.06 + k * 0.1)
          this.ctx.audio.buzz(8)
        }
      } else if (e === 'pass') {
        // Every hazard ticks the counter; every tenth gets a shout.
        const big = r.seen % 10 === 0
        this.ctx.audio.play(big ? 'powerup' : 'tick', 1 + Math.min(0.6, r.seen * 0.012))
        fx.sparks(at.x, at.y, C.yellow, big ? 16 : 5)
        if (big) {
          const up = toWorld(f, RUN_X + 60, r.y - r.g * 130)
          fx.float(`${r.seen}!`, up.x, up.y, C.yellow, 64, side)
        }
      } else if (e === 'die') {
        const spiked = spikeHit(this.s.seed, r.dist + RUN_X, r.y)
        // Faster runs end harder.
        const k = clamp(Math.hypot(speed, vy) / 1400, 0.35, 1)
        this.ctx.audio.play(spiked ? 'hit' : 'whoosh', spiked ? 1.15 - k * 0.3 : 0.6)
        this.ctx.audio.play('thud')
        this.ctx.audio.buzz(Math.round(25 + k * 30))
        fx.burst(at.x, at.y, col.main, {
          count: Math.round(12 + k * 14),
          speed: 380 + k * 260,
          size: 14,
        })
        fx.burst(at.x, at.y, C.white, { count: 10, speed: 420, size: 8, kind: 'spark' })
        if (spiked) {
          fx.burst(at.x, at.y, C.white, {
            count: 4,
            kind: 'emoji',
            glyph: '💥',
            size: 50,
            speed: 220,
            gravity: 0,
            life: 0.5,
          })
        }
        fx.ring(at.x, at.y, col.light, 120 + k * 80)
        fx.shake(0.25 + k * 0.3)
        fx.stop(Math.round(3 + k * 4))
      }
    }
  }

  private judgeRound(): void {
    const s = this.s
    const w = judge(s.runners[0], s.runners[1], s.flyT)
    if (w === null) return
    s.phase = 'end'
    s.phaseAt = this.time
    s.roundWinner = w
    if (w === 'draw') {
      this.ctx.audio.play('draw')
      return
    }
    s.wins[w]++
    // The round's winner gets a burst of light where it stands.
    const at = toWorld(this.frames[w], RUN_X, s.runners[w].y)
    this.ctx.fx.ring(at.x, at.y, C.yellow, 200)
    this.ctx.fx.sparks(at.x, at.y, C.yellow, 16)
    if (s.wins[w] >= this.target) {
      this.ctx.fx.confetti(w)
      this.ctx.fx.flash(SIDE[w].light, 0.3)
      this.finish(w, { score: s.wins, delay: FINAL })
    } else this.ctx.audio.play('score')
  }

  /** While the ending plays, the loser keeps tumbling into the void. */
  protected override afterEnd(dt: number): void {
    for (const r of this.s.runners) if (!r.alive) fallDead(r, dt)
  }

  private nextRound(): void {
    const s = this.s
    if (this.over) return
    s.round++
    s.seed = this.courseSeed()
    s.runners = [newRunner(), newRunner()]
    this.plans = [newPlan(), newPlan()]
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
    const r = s.runners[side]
    const p = this.prev[side]
    // Blend toward the latest step, unless the runner just jumped back (a new round).
    const a = Math.abs(r.dist - p.d) > 200 ? 1 : this.alpha
    const o: LaneView = {
      runner: r,
      y: lerp(p.y, r.y, a),
      dist: lerp(p.d, r.dist, a),
      seed: s.seed,
      time: this.time,
      phase: s.phase,
      since: this.time - s.phaseAt,
      wins: s.wins[side],
      rivalWins: s.wins[other(side)],
      roundWinner: s.roundWinner,
      name: this.ctx.names[side],
      bot: this.isBot(side),
      matchOver: this.over,
      round: s.round,
      target: this.target,
    }
    drawLane(g, side, view, o)
  }
}

export default () => new GravityRun()
