import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { RhythmBot } from './bot.ts'
import { renderRace } from './render.ts'
import {
  BEAT,
  LAPS,
  laps,
  loopAt,
  stepRat,
  tap,
  winnerOf,
  worldNew,
  type Judge,
  type State as Rules,
} from './rules.ts'

/** Laps to the finish: the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'points', default: LAPS, min: 1, max: 9 }

export interface State extends Rules {
  /** Game time someone crossed the line for good (-1 while racing). */
  endAt: number
}

class RatRace extends BaseGame<State> {
  private bots: [RhythmBot | null, RhythmBot | null] = [null, null]
  /** Last beat number ticked (sound only). */
  private beatNo = -1
  /** Laps each rat had at the last step (for lap feedback). */
  private lapsSeen: [number, number] = [0, 0]
  /** When the "Perfect!" label last showed for each side (labels are throttled, bursts are not). */
  private lastLabel: [number, number] = [-9, -9]

  /** Laps to the finish. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new RhythmBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [RhythmBot | null, RhythmBot | null]
    return { ...worldNew(), endAt: -1 }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    const beat = Math.floor(this.time / BEAT + 1e-6)
    if (beat !== this.beatNo) {
      this.beatNo = beat
      ctx.audio.play('tick', beat % 4 === 0 ? 1.25 : 1)
    }
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      if (bot) {
        const n = bot.step(this.time)
        for (let k = 0; k < n; k++) this.tapBy(side, null)
      } else {
        for (const p of ctx.input.player(side).downs) this.tapBy(side, { x: p.x, y: p.y })
      }
      const r = s.rats[side]
      stepRat(r, dt, this.time)
      if (r.speed > 1.4 && this.time % 0.14 < dt) {
        const at = loopAt(r.angle)
        const w = frame(side, at.x - at.dir * 50, at.y)
        ctx.fx.puff(w.x, w.y, alpha(C.white, 0.5), 3)
      }
      const l = laps(r, this.target)
      if (l !== this.lapsSeen[side]) {
        this.lapsSeen[side] = l
        this.lapFx(side, l)
      }
    }

    const w = winnerOf(s, this.target)
    if (w === null) return
    s.endAt = this.time
    const { fx, audio } = ctx
    if (w !== 'draw') {
      const at = loopAt(s.rats[w].angle)
      const p = frame(w, at.x, at.y)
      fx.burst(p.x, p.y, C.yellow, {
        count: 30,
        speed: 760,
        size: 12,
        kind: 'spark',
        colors: [C.yellow, C.white, SIDE[w].light],
      })
      fx.ring(p.x, p.y, SIDE[w].light, 320)
      fx.flash(SIDE[w].main, 0.25)
    }
    fx.confetti(w === 'draw' ? undefined : w)
    fx.shake(0.4)
    fx.stop(8)
    audio.play('whoosh', 0.8)
    this.finish(w, {
      score: [laps(s.rats[0], this.target), laps(s.rats[1], this.target)],
      delay: 2.4,
    })
  }

  protected override afterEnd(dt: number): void {
    // The winner coasts on a victory lap; the loser runs out of puff.
    const s = this.s
    const w = winnerOf(s, this.target)
    for (const side of [0, 1] as Side[]) {
      const r = s.rats[side]
      if (side !== w) r.speed *= Math.exp(-3 * dt)
      stepRat(r, dt, this.time)
    }
  }

  /** A tap on a side's rat (`p` is the press point, or null for a bot). */
  private tapBy(side: Side, p: { x: number; y: number } | null): void {
    const { fx, audio } = this.ctx
    if (p) tapRipple(this.ctx, side, p.x, p.y)
    const r = this.s.rats[side]
    const j: Judge = tap(r, this.time)
    if (j === 'down') return
    const at = loopAt(r.angle)
    const rat = frame(side, at.x, at.y)
    const x = p?.x ?? rat.x
    const y = p?.y ?? rat.y
    if (j === 'perfect') {
      fx.burst(rat.x, rat.y, C.yellow, { count: 14, speed: 380, size: 10, kind: 'spark' })
      fx.ring(rat.x, rat.y, C.yellow, 150)
      if (this.time - this.lastLabel[side] > 1.8) {
        this.lastLabel[side] = this.time
        fx.float('Perfect!', rat.x, rat.y + (side === 0 ? -110 : 110), C.yellow, 52, side)
      }
      audio.play('powerup', 1.05)
    } else if (j === 'ok') {
      fx.puff(x, y, alpha(C.white, 0.55), 3)
      audio.play('tap', 1 + (r.speed % 0.3))
    } else if (j === 'stumble') {
      fx.burst(rat.x, rat.y, SIDE[side].light, {
        count: 16,
        speed: 320,
        size: 10,
        kind: 'square',
        gravity: 800,
      })
      fx.float('Too fast!', rat.x, rat.y + (side === 0 ? -120 : 120), C.white, 60, side)
      fx.shake(0.3)
      fx.stop(3)
      audio.play('buzz')
    }
  }

  private lapFx(side: Side, lap: number): void {
    const { fx, audio } = this.ctx
    const line = frame(side, 500, 1530)
    fx.ring(line.x, line.y, SIDE[side].light, 220)
    // No floating label here: the drum in the infield already shows "Lap N/M" and
    // would sit under it.
    if (lap < this.target) {
      fx.burst(line.x, line.y, SIDE[side].light, {
        count: 16,
        speed: 520,
        size: 10,
        kind: 'square',
      })
      audio.play('score', 1 + lap * 0.1)
    }
    fx.shake(0.1)
  }

  render(g: Draw): void {
    renderRace(g, this.s, this.time, {
      names: this.ctx.names,
      target: this.target,
      endAt: this.s.endAt,
      winner: this.s.endAt >= 0 ? winnerOf(this.s, this.target) : null,
      bots: this.ctx.bots,
    })
  }
}

export default () => new RatRace()
