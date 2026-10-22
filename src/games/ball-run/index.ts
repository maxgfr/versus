import { type GameContext, type MatchSpec, other, type Side } from '../../core/game.ts'
import { clamp, lerp } from '../../core/fx/ease.ts'
import type { Ptr } from '../../core/input.ts'
import type { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { mirrorFx, RunnerGame, toLocal, toWorld } from '../../engines/runner/index.ts'
import { rowAt, wrap } from './rules.ts'
import { type Brain, drive, newBrain } from './bot.ts'
import { ballPos, drawLane } from './render.ts'
import { type Ball, metres, newBall, ROW, STEER, stepBall, TIME_CAP } from './rules.ts'

export interface State {
  balls: [Ball, Ball]
  /** Game time each ball dropped out, or -1. */
  outT: [number, number]
  phase: 'ready' | 'run'
  phaseAt: number
  /** The match result once decided, stamped so the ending animates on every screen. */
  winner: Side | 'draw' | null
  endAt: number
  endWhy: 'fall' | 'time' | null
}

/** A hole passed with less room than this (rad) is a close call. */
const CLOSE = 0.1

/** A beat after the shell's 3-2-1 to read the rule. */
const READY_T = 1.3
/** Every this many units of distance, a small reward chime. */
const MILESTONE = 5000
const END_T = 2
/** The pause button sits at the left edge near the midline: presses there are not steering. */
const inPauseZone = (p: Ptr): boolean => p.x < 120 && p.y > 700 && p.y < 1100

/** A timed match, decided by distance when the time is up: the players pick the length in seconds. */
export const match: MatchSpec = { unit: 'seconds', default: TIME_CAP, min: 15, max: 180, step: 15 }

class BallRun extends RunnerGame<State> {
  /** Match length in seconds. */
  private get limit(): number {
    return this.ctx.target || match.default
  }

  private brains: [Brain, Brain] = [newBrain(), newBrain()]
  private rng: Rng | null = null
  /** Sides whose ball dropped out during the current step. */
  private fell: Side[] = []
  /** Cosmetic: each ball's distance and angle at the previous step, for interpolation. */
  private prev: [{ d: number; phi: number }, { d: number; phi: number }] = [
    { d: 0, phi: 0 },
    { d: 0, phi: 0 },
  ]
  private stepped = false
  private alpha = 1

  override init(ctx: GameContext): void {
    super.init(ctx)
    // Effects land where each lane is drawn, also when a half is shown turned (online).
    mirrorFx(ctx, this.frames)
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

  protected setup(): State {
    return {
      balls: [newBall(), newBall()],
      outT: [-1, -1],
      phase: 'ready',
      phaseAt: 0,
      winner: null,
      endAt: -1,
      endWhy: null,
    }
  }

  private botRng(): Rng {
    this.rng ??= this.ctx.rng.fork()
    return this.rng
  }

  /** First finger on this side's half, outside the pause button. */
  private finger(side: Side): Ptr | undefined {
    for (const p of this.ctx.input.player(side).held.values()) if (!inPauseZone(p)) return p
    return undefined
  }

  protected override stepWorld(_dt: number): boolean {
    const s = this.s
    if (s.phase === 'ready') {
      if (this.time - s.phaseAt >= READY_T) {
        s.phase = 'run'
        s.phaseAt = this.time
        this.ctx.audio.play('whoosh', 1.2)
      }
      return false
    }
    return true
  }

  protected override step(dt: number): void {
    for (const side of [0, 1] as Side[]) {
      const b = this.s.balls[side]
      this.prev[side].d = b.dist
      this.prev[side].phi = b.phi
    }
    this.stepped = true
    super.step(dt)
    if (this.over) return
    const s = this.s
    if (this.fell.length > 0) {
      const out = this.fell
      this.fell = []
      // Last one rolling wins. If both drop on the same step, the one who rolled further wins.
      if (out.length === 2) this.decideByDistance('Both dropped out', 'fall')
      else {
        const winner = other(out[0] as Side)
        this.end(winner, 'fall')
        this.finish(winner, { note: 'Last one rolling', delay: END_T })
      }
      return
    }
    if (s.phase === 'run' && s.balls[0].age >= this.limit)
      this.decideByDistance('Time is up', 'time')
  }

  /** Stamp the ending and celebrate the winner. */
  private end(winner: Side | 'draw', why: 'fall' | 'time'): void {
    const s = this.s
    s.winner = winner
    s.endAt = this.time
    s.endWhy = why
    const fx = this.ctx.fx
    if (winner === 'draw') return
    fx.confetti(winner)
    const p = this.at(winner)
    fx.ring(p.x, p.y, C.yellow, 300)
    fx.burst(p.x, p.y, C.yellow, { count: 18, speed: 600, size: 10, kind: 'spark' })
  }

  /** While the result screen waits: the winner coasts on down the tunnel. */
  protected override afterEnd(dt: number): void {
    const s = this.s
    if (s.endWhy !== 'fall') return
    for (const b of s.balls) {
      if (b.out) continue
      b.v *= Math.exp(-2.5 * dt)
      b.dist += b.v * dt
      b.phi = wrap(b.phi + (b.phiT - b.phi) * Math.min(1, dt * 4))
      while (b.dist >= b.next * ROW) b.next++
    }
  }

  private scores(): [number, number] {
    return [metres(this.s.balls[0].dist), metres(this.s.balls[1].dist)]
  }

  private decideByDistance(note: string, why: 'fall' | 'time'): void {
    const [a, b] = this.s.balls
    const winner = a.dist === b.dist ? 'draw' : a.dist > b.dist ? 0 : 1
    if (why === 'time') {
      this.ctx.audio.play('buzz')
      this.ctx.fx.flash(C.white, 0.3)
    }
    this.end(winner, why)
    this.finish(winner, { score: this.scores(), note, delay: END_T })
  }

  protected stepRunner(side: Side, dt: number): void {
    const s = this.s
    if (s.phase !== 'run') return
    const b = s.balls[side]
    if (b.out) return
    if (this.isBot(side)) {
      b.phiT = drive(b, this.ctx.seed, this.ctx.difficulty, this.botRng(), this.brains[side])
    } else this.steer(side, b)
    const before = Math.floor(b.dist / MILESTONE)
    const ring = b.next
    const v = b.v
    const ev = stepBall(b, this.ctx.seed, dt)
    if (ev === 'fall') this.onFall(side, v)
    else {
      if (ev === 'bar') this.onBar(side, v)
      else if (Math.floor(b.dist / MILESTONE) > before) this.milestone(side, b)
      // Rings just passed: skimming the edge of a hole is a close call.
      for (let i = ring; i < b.next; i++) {
        for (const h of rowAt(this.ctx.seed, i).holes) {
          if (Math.abs(wrap(b.phi - h.c)) - h.w / 2 < CLOSE) {
            this.closeCall(side)
            break
          }
        }
      }
    }
  }

  private closeCall(side: Side): void {
    const p = this.local(side, 0, -170)
    this.ctx.audio.play('swish', 1.4)
    this.ctx.fx.sparks(p.x, p.y, C.yellow, 8)
    this.ctx.fx.float('Close!', p.x, p.y, C.yellow, 52, side)
  }

  /** World position of a point offset (lane-local) from the ball. */
  private local(side: Side, dx: number, dy: number): { x: number; y: number } {
    const b = ballPos()
    return toWorld(this.frames[side], b.x + dx, b.y + dy)
  }

  /** Drag the finger across the half: the ball turns with it, from where the finger went down. */
  private steer(side: Side, b: Ball): void {
    const p = this.finger(side)
    if (!p) {
      b.drag = false
      return
    }
    const frame = this.frames[side]
    const x = toLocal(frame, p.x, p.y).x
    if (!b.drag) {
      b.drag = true
      b.anchorX = toLocal(frame, p.x0, p.y0).x
      b.anchorPhi = b.phiT
    }
    b.phiT = b.anchorPhi + (x - b.anchorX) * STEER
  }

  /** World position of a side's ball (the camera keeps it on the floor, mid-lane). */
  private at(side: Side): { x: number; y: number } {
    const p = ballPos()
    return toWorld(this.frames[side], p.x, p.y)
  }

  /** Dropping out at speed is a bigger fall. */
  private onFall(side: Side, v: number): void {
    const fx = this.ctx.fx
    const k = clamp(v / 1050, 0.4, 1)
    const p = this.at(side)
    this.s.outT[side] = this.time
    this.fell.push(side)
    this.ctx.audio.play('slide', 1.05 - k * 0.3)
    this.ctx.audio.play('lose')
    fx.burst(p.x, p.y, SIDE[side].main, {
      count: Math.round(14 + k * 16),
      speed: 360 + k * 260,
      size: 14,
      gravity: 600,
    })
    fx.burst(p.x, p.y, C.yellow, { count: 10, speed: 360, size: 8, kind: 'spark' })
    fx.ring(p.x, p.y, SIDE[side].light, 180 + k * 100)
    fx.shake(0.3 + k * 0.3)
    fx.stop(Math.round(3 + k * 3))
    fx.flash(SIDE[side].main, 0.25)
    this.ctx.audio.buzz?.(Math.round(35 + k * 30))
  }

  /** A barrier hit hurts as much as the ball was rolling. */
  private onBar(side: Side, v: number): void {
    const fx = this.ctx.fx
    const k = clamp(v / 1050, 0.2, 1)
    this.s.balls[side].barAt = this.time
    const p = this.at(side)
    this.ctx.audio.play('wall', 1.2 - k * 0.4)
    this.ctx.audio.play('bounce', 0.9)
    fx.sparks(p.x, p.y, C.pink, Math.round(8 + k * 14))
    fx.puff(p.x, p.y, alpha(C.white, 0.6), Math.round(3 + k * 6))
    fx.shake(0.12 + k * 0.3)
    fx.stop(Math.round(1 + k * 4))
    this.ctx.audio.buzz?.(Math.round(12 + k * 25))
    const t = this.local(side, 0, -150)
    fx.float('Bonk!', t.x, t.y, C.pink, 56, side)
  }

  private milestone(side: Side, b: Ball): void {
    const p = this.at(side)
    const t = this.local(side, 0, -160)
    this.ctx.audio.play('coin', 1 + Math.min(0.4, b.dist / 200000))
    this.ctx.fx.float(`${metres(b.dist)} m`, t.x, t.y, SIDE[side].light, 56, side)
    this.ctx.fx.ring(p.x, p.y, SIDE[side].light, 140)
  }

  protected renderLane(
    g: Draw,
    side: Side,
    view: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const s = this.s
    const since = this.time - s.phaseAt
    const b = s.balls[side]
    const p = this.prev[side]
    const a = this.alpha
    drawLane(g, side, view, {
      ball: b,
      dist: lerp(p.d, b.dist, a),
      phi: wrap(p.phi + wrap(b.phi - p.phi) * a),
      seed: this.ctx.seed,
      time: this.time,
      phase: s.phase,
      since,
      readyLeft: READY_T - since,
      name: this.ctx.names[side],
      bot: this.isBot(side),
      outT: s.outT[side],
      left: Math.max(0, this.limit - s.balls[side].age),
      winner: s.winner,
      endAt: s.endAt,
      endWhy: s.endWhy,
      rivalDist: s.balls[other(side)].dist,
    })
  }
}

export default () => new BallRun()
