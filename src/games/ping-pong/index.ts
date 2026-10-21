import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type Disc, fingerTarget } from '../../engines/puck/index.ts'
import { type BotMemory, decide, newMemory, TUNING } from './bot.ts'
import { render } from './render.ts'
import { type Cmd, type Event, heightOf, newWorld, step, type World, winner } from './rules.ts'

interface State {
  w: World
  /** Game time of each bat's last stroke (flash on the rubber). */
  hitAt: [number, number]
  /** Game time the ball was served (fade-in ring). */
  servedAt: number
  /** Game time of the last point (the ball dropping off the end). */
  pointAt: number
  /** Game time the match was decided, -1 while it is on. */
  endAt: number
  winner: Side | null
}

/** Points to win: first to N with a two-point lead, capped at N + 4. */
export const match: MatchSpec = { unit: 'points', default: 7, min: 3, max: 21 }

/** Humans move their bat as fast as their finger; the table is the limit. */
const HUMAN_SPEED = 5200

class PingPong extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): previous positions for interpolation, trail, springs.
  private prev: { ball: Disc; bats: [Disc, Disc]; z: number } | null = null
  private trail: { x: number; y: number; z: number }[] = []
  private squash: [Spring, Spring] = [new Spring(1, 380, 12), new Spring(1, 380, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const first: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      w: newWorld(first),
      hitAt: [-10, -10],
      servedAt: -10,
      pointAt: -10,
      endAt: -1,
      winner: null,
    }
  }

  private commands(dt: number): Cmd {
    const w = this.s.w
    const cmd: Cmd = {
      target: [null, null],
      speed: [HUMAN_SPEED, HUMAN_SPEED],
      serve: [false, false],
    }
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        const d = decide(
          w,
          side,
          this.ctx.difficulty,
          this.ctx.rng,
          this.mem[side] as BotMemory,
          dt,
        )
        cmd.target[side] = d.target
        cmd.serve[side] = d.serve
        cmd.speed[side] = TUNING[this.ctx.difficulty].speed
      } else {
        // The bat follows the finger; the bat's own band keeps it on its edge.
        const p = this.ctx.input.player(side)
        cmd.target[side] = fingerTarget(p)
        cmd.serve[side] = p.downs.length > 0
      }
    }
    return cmd
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = {
      ball: { ...w.ball },
      bats: [{ ...w.bats[0] }, { ...w.bats[1] }],
      z: heightOf(w),
    }
    const events = step(w, dt, this.commands(dt), this.ctx.rng)
    for (const e of events) this.juice(e)
  }

  protected override afterEnd(dt: number): void {
    // Bats keep following the fingers while the trophy shows; nobody serves.
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, bats: [{ ...w.bats[0] }, { ...w.bats[1] }], z: 0 }
    if (w.phase !== 'point') return
    const cmd = this.commands(dt)
    cmd.serve = [false, false]
    w.pause = Math.max(w.pause, 1)
    step(w, dt, cmd, this.ctx.rng)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    if (e.kind === 'hit') {
      const k = Math.min(1, (e.speed - 900) / 1200)
      audio.play('hit', 0.9 + k * 0.5)
      fx.sparks(e.x, e.y, k > 0.6 ? C.yellow : C.white, Math.round(6 + k * 10))
      fx.burst(e.x, e.y, SIDE[e.side].light, {
        count: 6,
        speed: 380,
        size: 9,
        life: 0.35,
        gravity: 0,
        spread: Math.PI,
        dir: e.side === 0 ? -Math.PI / 2 : Math.PI / 2,
      })
      if (k > 0.45) fx.shake(0.06 + k * 0.14)
      if (k > 0.8) fx.stop(2)
      this.squash[e.side].kick(-2.5 - k * 3)
      s.hitAt[e.side] = this.time
      this.trail = []
      // Long rallies are called out every five strokes, where the ball was struck.
      if (e.rally >= 5 && e.rally % 5 === 0) {
        audio.play('coin', 1 + Math.min(0.5, e.rally / 40))
        fx.float(
          `Rally ${e.rally}!`,
          W / 2,
          e.side === 0 ? MID + 420 : MID - 420,
          e.rally >= 10 ? C.yellow : C.white,
          44 + Math.min(16, e.rally),
          e.side,
        )
      }
    } else if (e.kind === 'bounce') {
      audio.play('tick', 1.35)
      fx.ring(e.x, e.y, 'rgba(255,255,255,0.55)', 46)
    } else if (e.kind === 'wall') {
      audio.play('wall', 0.9 + Math.min(0.5, e.speed / 2500))
      if (e.speed > 900) fx.sparks(e.x, e.y, C.white, 4)
    } else if (e.kind === 'serve') {
      s.servedAt = this.time
      audio.play('pop')
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.5)', 5)
    } else if (e.kind === 'point') {
      const { side } = e
      const col = SIDE[side]
      s.pointAt = this.time
      audio.play('score')
      audio.buzz(20)
      fx.flash(col.main, 0.22)
      fx.shake(0.3)
      fx.stop(4)
      fx.burst(e.x, e.y, col.main, {
        count: 30,
        speed: 900,
        size: 14,
        life: 0.9,
        gravity: 0,
        drag: 2,
        spread: Math.PI,
        dir: e.y > MID ? -Math.PI / 2 : Math.PI / 2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(e.x, e.y, col.light, 260)
      this.pulse[side].kick(14)
      const score: [number, number] = [s.w.score[0], s.w.score[1]]
      const won = winner(score, this.target)
      if (won === null) floatFor(fx, side, e.rally >= 10 ? 'What a rally!' : '+1')
      if (won !== null) {
        s.endAt = this.time
        s.winner = won
        fx.confetti(won)
        fx.flash(SIDE[won].main, 0.35)
        this.finish(won, { score, delay: 2 })
        return
      }
      // A match point (or saving one) is called on the half of whoever holds it.
      for (const p of [0, 1] as Side[]) {
        if (score[p] + 1 >= this.target && score[p] > score[other(p)]) {
          audio.play('powerup', 1.1)
          fx.float('Match point!', W / 2, p === 0 ? MID + 400 : MID - 400, C.yellow, 54, p)
        }
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const w = s.w
    const prev = this.prev
    const ip = (a: Disc, b: Disc | undefined): Disc =>
      b ? { ...a, x: lerp(b.x, a.x, alpha), y: lerp(b.y, a.y, alpha) } : a
    const ball = ip(w.ball, prev?.ball)
    const z = prev ? lerp(prev.z, heightOf(w), alpha) : heightOf(w)
    // Trail: only while the ball is really moving.
    if (Math.hypot(w.ball.vx, w.ball.vy) > 900 && w.phase === 'play')
      this.trail.push({ x: ball.x, y: ball.y, z })
    else this.trail.shift()
    while (this.trail.length > 7) this.trail.shift()
    const dt = 1 / 60
    for (const sp of this.squash) sp.update(dt)
    for (const p of this.pulse) p.update(dt)
    render(g, w, {
      ball,
      z,
      bats: [ip(w.bats[0], prev?.bats[0]), ip(w.bats[1], prev?.bats[1])],
      trail: this.trail,
      squash: this.squash.map((sp) => sp.value),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      serve: Math.min(1, (this.time - s.servedAt) / 0.35),
      since: [this.time - s.hitAt[0], this.time - s.hitAt[1]],
      fell: w.phase === 'point' ? this.time - s.pointAt : -1,
      names: this.ctx.names,
      bots: this.ctx.bots,
      target: this.target,
      ended: s.endAt >= 0 ? this.time - s.endAt : -1,
      winner: s.winner,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new PingPong()
