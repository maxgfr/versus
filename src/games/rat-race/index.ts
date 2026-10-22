import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
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
  TAU,
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
  /**
   * The result, fixed the moment the race is decided: the loser may still
   * coast over the line during the ending, which must not turn it into a draw.
   */
  won: Side | 'draw' | null
}

class RatRace extends BaseGame<State> {
  private bots: [RhythmBot | null, RhythmBot | null] = [null, null]
  /** Last beat number ticked (sound only). */
  private beatNo = -1
  /** Laps each rat had at the last step (for lap feedback). */
  private lapsSeen: [number, number] = [0, 0]
  /** When the "Perfect!" label last showed for each side (labels are throttled, bursts are not). */
  private lastLabel: [number, number] = [-9, -9]
  // Cosmetic only (not synced): interpolation and squash, driven from state changes.
  private prev: [number, number] = [0, 0]
  private squash: [Spring, Spring] = [new Spring(1, 420, 13), new Spring(1, 420, 13)]
  private made: [number, number] = [0, 0]

  /** Laps to the finish. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new RhythmBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [RhythmBot | null, RhythmBot | null]
    return { ...worldNew(), endAt: -1, won: null }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.prev = [s.rats[0].angle, s.rats[1].angle]
    const beat = Math.floor(this.time / BEAT + 1e-6)
    if (beat !== this.beatNo) {
      this.beatNo = beat
      ctx.audio.play('tick', beat % 4 === 0 ? 1.25 : 1)
    }
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      if (bot) {
        // Lead in laps' worth of angle, from this bot's point of view.
        const lead = s.rats[side].angle - s.rats[side === 0 ? 1 : 0].angle
        const final = s.rats[side].angle > (this.target - 1) * TAU
        const n = bot.step(this.time, lead, final)
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
    s.won = w
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
    audio.buzz(35)
    this.finish(w, {
      score: [laps(s.rats[0], this.target), laps(s.rats[1], this.target)],
      delay: 2.4,
    })
  }

  protected override afterEnd(dt: number): void {
    // The winner coasts on a victory lap; the loser runs out of puff.
    const s = this.s
    this.prev = [s.rats[0].angle, s.rats[1].angle]
    for (const side of [0, 1] as Side[]) {
      const r = s.rats[side]
      if (side !== s.won) r.speed *= Math.exp(-3 * dt)
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
      // Dead on the beat: a bigger, brighter, higher kick.
      const k = r.acc
      fx.burst(rat.x, rat.y, C.yellow, {
        count: 8 + Math.round(k * 12),
        speed: 300 + k * 220,
        size: 10,
        kind: 'spark',
      })
      fx.ring(rat.x, rat.y, C.yellow, 110 + k * 80)
      if (k > 0.75) fx.shake(0.06)
      if (this.time - this.lastLabel[side] > 1.8) {
        this.lastLabel[side] = this.time
        fx.float('Perfect!', rat.x, rat.y + (side === 0 ? -110 : 110), C.yellow, 52, side)
      }
      audio.play('powerup', 0.95 + k * 0.2)
      audio.buzz(6 + Math.round(k * 10))
    } else if (j === 'ok') {
      fx.puff(x, y, alpha(C.white, 0.55), 3)
      audio.play('tap', 0.9 + Math.min(0.4, r.speed * 0.15))
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
      audio.buzz(60)
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

  render(g: Draw, a: number): void {
    const s = this.s
    // Every counted tap (seen through the synced counter) squashes the rat, harder on the beat.
    for (const side of [0, 1] as Side[]) {
      const r = s.rats[side]
      if (r.made !== this.made[side]) {
        if (r.made > this.made[side]) this.squash[side].kick(-2.5 - r.acc * 4)
        this.made[side] = r.made
      }
      this.squash[side].update(1 / 60)
    }
    renderRace(g, s, this.time, {
      names: this.ctx.names,
      target: this.target,
      endAt: s.endAt,
      winner: s.won,
      bots: this.ctx.bots,
      angles: [lerp(this.prev[0], s.rats[0].angle, a), lerp(this.prev[1], s.rats[1].angle, a)],
      squash: [this.squash[0].value, this.squash[1].value],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = [this.s.rats[0].angle, this.s.rats[1].angle]
  }
}

export default () => new RatRace()
