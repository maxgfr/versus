import { fingerTarget, type Disc } from '../../engines/puck/index.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { type BotMemory, decide, newMemory, TUNING } from './bot.ts'
import { render, type Look } from './render.ts'
import {
  type Ball,
  type Event,
  HUMAN_SPEED,
  landingOf,
  MAX_TOUCH,
  newWorld,
  step,
  tempoOf,
  winner,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** Set once the match is decided: the winner and when (this.time). */
  end: { side: Side; at: number } | null
}

/** Points to win, chosen by the players before the match. */
export const match: MatchSpec = { unit: 'points', default: 7, min: 3, max: 21 }

const SAND = 'rgba(241,211,148,0.85)'

class BeachBall extends BaseGame<State> {
  private mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): previous positions, squash and "wow" timers, spin.
  private prev: { ball: Ball; blobs: Disc[] } | null = null
  private squash: Spring[] = []
  private bumpAt: number[] = []
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private spin = 0
  /** Ball squash (1 = round), kicked by bumps and landings. */
  private ballSquash = new Spring(1, 300, 11)
  private trail: { x: number; y: number; z: number }[] = []
  /** The net sags and springs back when the ball hits it. */
  private net = new Spring(0, 160, 6)

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const server: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    const tempo = tempoOf(this.ctx.difficulty, this.ctx.bots)
    const w = newWorld(this.ctx.teams, server, this.ctx.rng, tempo)
    this.squash = w.blobs.map(() => new Spring(1, 360, 12))
    this.bumpAt = w.blobs.map(() => -10)
    return { w, end: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, blobs: w.blobs.map((b) => ({ ...b })) }
    const botTargets: ({ x: number; y: number } | null)[][] = [[], []]
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        botTargets[side] = decide(w, side, this.ctx.difficulty, this.ctx.rng, this.mem[side], dt)
      }
    }
    const targets = w.blobs.map((b, i) => {
      if (this.isBot(b.side)) return botTargets[b.side]?.[i] ?? null
      return fingerTarget(this.ctx.input.player(b.side), b.lane)
    })
    const speeds = w.blobs.map((b) =>
      this.isBot(b.side) ? TUNING[this.ctx.difficulty].speed : HUMAN_SPEED,
    )
    for (const e of step(w, dt, targets, speeds, this.ctx.rng)) this.juice(e)
    const won = winner(w, this.target)
    if (won !== null && !this.over) {
      this.s.end = { side: won, at: this.time }
      this.ctx.fx.confetti(won)
      this.finish(won, { score: [w.score[0], w.score[1]], delay: 2.4 })
    }
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    if (e.kind === 'bump') {
      // Intensity: the pace it leaves at, and how hard the blob charged (a spike).
      const p = e.power
      const k = Math.min(1, e.speed / 1400)
      audio.play(p > 0.5 ? 'slap' : 'boing', 0.85 + k * 0.3 + Math.min(0.3, e.count * 0.1))
      fx.puff(e.x, e.y, SAND, 5 + Math.round(p * 6))
      fx.ring(e.x, e.y, p > 0.6 ? C.yellow : SIDE[e.side].light, 110 + p * 90)
      fx.burst(e.x, e.y, p > 0.5 ? C.yellow : C.white, {
        count: Math.round(7 + p * 14),
        speed: 520 + p * 600,
        size: 6,
        life: 0.3,
        gravity: 0,
        spread: Math.PI * (2 - p),
        dir: e.side === 0 ? -Math.PI / 2 : Math.PI / 2,
        kind: 'spark',
      })
      if (p > 0.35) fx.shake(0.08 + p * 0.22)
      if (p > 0.6) {
        fx.stop(2 + Math.round(p * 3))
        fx.float('SPIKE!', e.x, e.y + (e.side === 0 ? -150 : 150), C.yellow, 56, e.side)
      }
      if (p > 0.3) audio.buzz(Math.round(8 + p * 20))
      this.ballSquash.kick(-5 - p * 7)
      this.trail.length = 0
      if (e.count === MAX_TOUCH) audio.play('tick', 1.4)
      let best = -1
      let bd = Infinity
      w.blobs.forEach((b, i) => {
        if (b.side !== e.side) return
        const d = Math.hypot(b.x - e.x, b.y - e.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      if (best >= 0) {
        this.squash[best]?.kick(-4 - e.power * 4)
        this.bumpAt[best] = this.time
      }
    } else if (e.kind === 'wall') {
      audio.play('bounce', 0.85 + Math.min(0.4, e.speed / 2000))
      this.ballSquash.kick(-3)
    } else if (e.kind === 'net') {
      audio.play('slap', 1.2)
      audio.play('thud', 1.4)
      fx.puff(e.x, MID, SAND, 14)
      fx.shake(0.18)
      this.net.kick(30)
    } else if (e.kind === 'land') {
      // A ball slammed into the sand hits harder than one that floats down.
      const k = Math.min(1, e.speed / 1600)
      audio.play('thud', 0.7 + k * 0.3)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.7)', 8 + Math.round(k * 10))
      fx.burst(e.x, e.y, SAND, {
        count: Math.round(10 + k * 16),
        speed: 380 + k * 500,
        size: 9,
        life: 0.6,
        gravity: 900,
        drag: 1.4,
        colors: [SAND, C.sand, '#ffffff'],
      })
      fx.ring(e.x, e.y, 'rgba(255,255,255,0.7)', 90 + k * 80)
      fx.shake(0.18 + k * 0.2)
      this.ballSquash.kick(-6 - k * 6)
    } else if (e.kind === 'point') {
      const col = SIDE[e.side]
      audio.play('score')
      audio.buzz(25)
      fx.flash(col.main, 0.2)
      fx.stop(4)
      fx.burst(w.ball.x, w.ball.y, col.main, {
        count: 22,
        speed: 420,
        size: 12,
        life: 0.8,
        gravity: 500,
        drag: 1.6,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      this.pulse[e.side].kick(14)
    } else if (e.kind === 'serve') {
      audio.play('pop', 1.1)
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    for (const s of this.squash) s.update(1 / 60)
    for (const p of this.pulse) p.update(1 / 60)
    this.ballSquash.update(1 / 60)
    this.net.update(1 / 60)
    // On-screen pace: the ball's clock runs at the match tempo.
    const sp = Math.hypot(w.ball.vx, w.ball.vy) * w.tempo
    if (w.phase === 'rally') this.spin += (sp / 60 / 90) * (w.ball.vx >= 0 ? 1 : -1)
    const ip = (a: Disc, b: Disc | undefined): Disc =>
      b ? { ...a, x: lerp(b.x, a.x, alpha), y: lerp(b.y, a.y, alpha) } : a
    const bp = prev?.ball
    const ball: Ball = bp
      ? {
          ...w.ball,
          x: lerp(bp.x, w.ball.x, alpha),
          y: lerp(bp.y, w.ball.y, alpha),
          z: lerp(bp.z, w.ball.z, alpha),
        }
      : w.ball
    // A trail only behind a ball flying fast (a spike).
    if (w.phase === 'rally' && sp > 900) this.trail.push({ x: ball.x, y: ball.y, z: ball.z })
    else this.trail.shift()
    // A faster match drags a longer trail.
    while (this.trail.length > (w.tempo > 1 ? 9 : 6)) this.trail.shift()
    const look: Look = {
      w,
      ball,
      trail: this.trail,
      ballSquash: this.ballSquash.value,
      net: this.net.value,
      landing: w.phase === 'rally' ? landingOf(w.ball) : null,
      teams: this.ctx.teams,
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      end: this.s.end ? { side: this.s.end.side, t: this.time - this.s.end.at } : null,
      blobs: w.blobs.map((b, i) => ip(b, prev?.blobs[i])),
      blobSides: w.blobs.map((b) => b.side),
      squash: this.squash.map((s) => s.value),
      wow: this.bumpAt.map((t) => Math.max(0, 1 - (this.time - t) / 0.3)),
      spin: this.spin,
      names: this.ctx.names,
      target: this.target,
      score: [w.score[0], w.score[1]],
      status: [this.status(0), this.status(1)],
      active: [this.mine(0), this.mine(1)],
    }
    render(g, look)
  }

  /** Is the ball coming down on `side`'s sand? Then that side has to play it. */
  private mine(side: Side): boolean {
    const w = this.s.w
    if (w.phase !== 'rally') return false
    const land = landingOf(w.ball)
    return land !== null && (side === 0 ? land.y > MID : land.y < MID)
  }

  /** Text under a name pill: the touches left for the side that has the ball. */
  private status(side: Side): string | undefined {
    const w = this.s.w
    if (w.phase !== 'rally') return undefined
    if (w.last === side) {
      const left = MAX_TOUCH - w.count
      return left > 0 ? `${left} touch${left === 1 ? '' : 'es'} left` : 'Over the net!'
    }
    return this.mine(side) && !this.isBot(side) ? 'Your ball!' : undefined
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    if (this.squash.length !== this.s.w.blobs.length) {
      this.squash = this.s.w.blobs.map(() => new Spring(1, 360, 12))
      this.bumpAt = this.s.w.blobs.map(() => -10)
    }
  }
}

export default () => new BeachBall()
