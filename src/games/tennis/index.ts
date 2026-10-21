import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { type Disc, fingerTarget } from '../../engines/puck/index.ts'
import { type BotMemory, decide, newMemory, TUNING } from './bot.ts'
import { type Look, type Mark, render } from './render.ts'
import { type Ball, type Cmd, type Event, newWorld, step, type World } from './rules.ts'

interface State {
  w: World
  /** Recent ball marks on the court (newest last). */
  marks: Mark[]
  /** The last umpire call. */
  call: Look['call']
  /** Game time the match was decided, -1 while it is on. */
  endAt: number
  winner: Side | null
}

/** Points to win the match (first to N). */
export const match: MatchSpec = { unit: 'points', default: 7, min: 3, max: 21 }

/** A human's blob runs at roughly a jog. */
const HUMAN_SPEED = 1300

const DUST = { clay: 'rgba(232,160,112,0.8)', grass: 'rgba(200,240,190,0.7)' }

class Tennis extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): previous positions for interpolation, springs.
  private prev: { ball: Ball; blobs: [Disc, Disc] } | null = null
  private squash: [Spring, Spring] = [new Spring(1, 340, 12), new Spring(1, 340, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const first: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    const surface = this.ctx.rng.chance(0.5) ? 'clay' : 'grass'
    return { w: newWorld(first, surface), marks: [], call: null, endAt: -1, winner: null }
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
        // The blob runs to the finger, held inside its own half of the court.
        const p = this.ctx.input.player(side)
        cmd.target[side] = fingerTarget(p)
        cmd.serve[side] = p.downs.length > 0
      }
    }
    return cmd
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, blobs: [{ ...w.blobs[0] }, { ...w.blobs[1] }] }
    const events = step(w, dt, this.commands(dt))
    for (const e of events) this.juice(e)
  }

  protected override afterEnd(dt: number): void {
    // Blobs keep running under the fingers while the trophy shows; nobody serves.
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, blobs: [{ ...w.blobs[0] }, { ...w.blobs[1] }] }
    if (w.phase !== 'point') return
    const cmd = this.commands(dt)
    cmd.serve = [false, false]
    w.pause = Math.max(w.pause, 1)
    step(w, dt, cmd)
  }

  private mark(x: number, y: number, out: boolean): void {
    const marks = this.s.marks
    marks.push({ x, y, t: this.time, out })
    while (marks.length > 4) marks.shift()
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 1300)
      audio.play('thud', 0.9 + k * 0.4)
      audio.play('swish', 0.9 + k * 0.3)
      fx.sparks(e.x, e.y, k > 0.8 ? C.yellow : C.white, Math.round(5 + k * 8))
      fx.ring(e.x, e.y, SIDE[e.side].light, 70)
      if (k > 0.75) fx.shake(0.05 + k * 0.08)
      if (k > 0.9) fx.stop(2)
      this.squash[e.side].kick(-2.5 - k * 2)
      if (e.rally >= 6 && e.rally % 3 === 0)
        fx.float(
          `Rally ${e.rally}!`,
          W / 2,
          e.side === 0 ? MID + 330 : MID - 330,
          e.rally >= 9 ? C.yellow : C.white,
          46,
          e.side,
        )
    } else if (e.kind === 'bounce') {
      audio.play('bounce', 1.05)
      fx.puff(e.x, e.y, DUST[s.w.surface], 7)
      fx.ring(e.x, e.y, 'rgba(255,255,255,0.6)', 60)
      this.mark(e.x, e.y, false)
    } else if (e.kind === 'serve') {
      audio.play('whoosh')
      audio.play('thud', 1.2)
      fx.sparks(e.x, e.y, C.white, 6)
      this.squash[e.side].kick(-3)
    } else if (e.kind === 'point') {
      const { side } = e
      const col = SIDE[side]
      s.call = { reason: e.reason, side, x: e.x, y: e.y, t: this.time }
      if (e.reason === 'out' || e.reason === 'short' || e.reason === 'double')
        this.mark(e.x, e.y, true)
      audio.play(e.reason === 'net' ? 'boing' : 'buzz', 0.9)
      audio.play('score')
      audio.buzz(18)
      fx.flash(col.main, 0.18)
      fx.shake(0.22)
      fx.stop(4)
      fx.puff(e.x, e.y, DUST[s.w.surface], 10)
      fx.burst(W / 2, side === 0 ? MID + 260 : MID - 260, col.main, {
        count: 22,
        speed: 700,
        size: 13,
        life: 0.8,
        gravity: 0,
        drag: 2.2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      this.pulse[side].kick(14)
      const score: [number, number] = [s.w.score[0], s.w.score[1]]
      if (score[side] >= this.target) {
        s.endAt = this.time
        s.winner = side
        fx.confetti(side)
        fx.flash(col.main, 0.35)
        this.finish(side, { score, delay: 2 })
        return
      }
      floatFor(fx, side, '+1')
      if (score[side] === this.target - 1) {
        audio.play('powerup', 1.1)
        fx.float('Match point!', W / 2, side === 0 ? MID + 420 : MID - 420, C.yellow, 54, side)
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const w = s.w
    const prev = this.prev
    const ip = <T extends Disc | Ball>(a: T, b: T | undefined): T =>
      b ? { ...a, x: lerp(b.x, a.x, alpha), y: lerp(b.y, a.y, alpha) } : a
    const ball = ip(w.ball, prev?.ball)
    if (prev) ball.z = lerp(prev.ball.z, w.ball.z, alpha)
    const dt = 1 / 60
    for (const sp of this.squash) sp.update(dt)
    for (const p of this.pulse) p.update(dt)
    render(g, w, {
      ball,
      blobs: [ip(w.blobs[0], prev?.blobs[0]), ip(w.blobs[1], prev?.blobs[1])],
      squash: this.squash.map((sp) => sp.value),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      names: this.ctx.names,
      bots: this.ctx.bots,
      target: this.target,
      now: this.time,
      marks: s.marks,
      call: s.call,
      ended: s.endAt >= 0 ? this.time - s.endAt : -1,
      winner: s.winner,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new Tennis()
