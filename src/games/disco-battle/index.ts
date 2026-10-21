import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { DanceBot } from './bot.ts'
import { LANE_COL, renderDisco } from './render.ts'
import {
  BEAT,
  DURATION,
  expire,
  laneAt,
  LANE_X,
  PAD_Y,
  press,
  winnerOf,
  worldNew,
  type State as Rules,
} from './rules.ts'

/** Seconds the music plays: the players pick it on the ready screen. */
export const match: MatchSpec = { unit: 'seconds', default: DURATION, min: 20, max: 120, step: 10 }

export interface State extends Rules {
  /** Game time the music stopped (-1 while dancing). */
  endAt: number
}

class DiscoBattle extends BaseGame<State> {
  private bots: [DanceBot | null, DanceBot | null] = [null, null]
  /** Last beat ticked (sound only). */
  private beatNo = -1

  /** Seconds the music plays. */
  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new DanceBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [DanceBot | null, DanceBot | null]
    return { ...worldNew(ctx.rng, this.total), endAt: -1 }
  }

  protected step(_dt: number): void {
    const s = this.s
    const { ctx } = this
    const now = this.time
    const beat = Math.floor(now / BEAT + 1e-6)
    if (beat !== this.beatNo) {
      this.beatNo = beat
      if (beat % 4 === 0) ctx.audio.play('click', 1.15)
      else ctx.audio.play('tick', 1)
    }
    for (const side of [0, 1] as Side[]) {
      const d = s.p[side]
      const before = d.combo
      const missed = expire(d, now)
      if (missed) this.missFx(side, before)
      const bot = this.bots[side]
      if (bot) {
        for (const lane of bot.step(now, d)) this.hitLane(side, lane)
        continue
      }
      for (const p of ctx.input.player(side).downs) {
        tapRipple(ctx, side, p.x, p.y)
        const lane = laneAt(side, p.x, p.y)
        if (lane !== null) this.hitLane(side, lane)
      }
    }
    if (now >= this.total) this.end()
  }

  /** The music stops: the winner gets the spotlight, then the result screen. */
  private end(): void {
    const s = this.s
    const { fx, audio } = this.ctx
    s.endAt = this.time
    const w = winnerOf(s)
    fx.flash(C.white, 0.35)
    fx.shake(0.35)
    fx.stop(8)
    audio.play('buzz', 0.8)
    if (w !== 'draw') {
      const p = frame(w, 500, 1640)
      fx.ring(p.x, p.y, SIDE[w].light, 300)
      fx.burst(p.x, p.y, C.yellow, {
        count: 30,
        speed: 760,
        size: 12,
        kind: 'spark',
        colors: [C.yellow, C.white, SIDE[w].light],
      })
    }
    fx.confetti(w === 'draw' ? undefined : w)
    this.finish(w, { score: [s.p[0].score, s.p[1].score], delay: 2.4 })
  }

  /** A press in `lane` on a side's pads (the bots call this too). */
  private hitLane(side: Side, lane: number): void {
    const { fx, audio } = this.ctx
    const d = this.s.p[side]
    const j = press(d, lane, this.time)
    if (!j) {
      // A tap with nothing to hit: a soft thud so it does not feel dead.
      const pad = frame(side, LANE_X[lane] as number, PAD_Y)
      fx.puff(pad.x, pad.y, alpha(C.white, 0.25), 3)
      audio.play('tap', 0.8)
      return
    }
    const pad = frame(side, LANE_X[lane] as number, PAD_Y)
    const col = LANE_COL[lane] as string
    if (j === 'perfect') {
      fx.burst(pad.x, pad.y, col, {
        count: 18,
        speed: 480,
        size: 10,
        kind: 'spark',
        colors: [col, C.white, C.yellow],
      })
      fx.ring(pad.x, pad.y, C.yellow, 160)
      audio.play('score', 1 + Math.min(d.combo, 30) * 0.012)
    } else {
      fx.burst(pad.x, pad.y, col, { count: 10, speed: 300, size: 8, kind: 'spark' })
      fx.ring(pad.x, pad.y, col, 120)
      audio.play('pop', 1 + lane * 0.05)
    }
    if (d.combo > 0 && d.combo % 10 === 0 && d.combo <= 30) {
      const mult = 1 + Math.min(3, Math.floor(d.combo / 10))
      const mid = frame(side, 500, PAD_Y - 290)
      fx.float(`x${mult}!`, mid.x, mid.y, C.yellow, 96, side)
      fx.flash(SIDE[side].light, 0.18)
      fx.shake(0.2)
      fx.stop(3)
      audio.play('powerup', 1 + mult * 0.08)
    }
  }

  /** Arrows went by unhit: a low buzz and a shake of the pads. */
  private missFx(side: Side, combo: number): void {
    const { fx, audio } = this.ctx
    const at = frame(side, 500, PAD_Y)
    fx.puff(at.x, at.y, alpha(C.white, 0.3), 4)
    // Losing a big combo hurts more.
    if (combo >= 10) {
      fx.shake(0.18)
      fx.float('Combo lost', at.x, frame(side, 500, PAD_Y - 290).y, C.redLight, 52, side)
    }
    audio.play('error', 0.9)
  }

  render(g: Draw): void {
    renderDisco(g, this.s, this.time, {
      names: this.ctx.names,
      endAt: this.s.endAt,
      winner: this.s.endAt >= 0 ? winnerOf(this.s) : null,
      bots: this.ctx.bots,
      total: this.total,
    })
  }
}

export default () => new DiscoBattle()
