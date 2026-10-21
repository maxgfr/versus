import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import {
  roundEnd,
  roundsNew,
  roundsStep,
  signalStep,
  tapPoints,
  tapRipple,
  taps,
  type Rounds,
  type SignalState,
} from '../../engines/reflex/index.ts'
import { SashimiBot } from './bot.ts'
import { BELL, PIECE, TIP, renderSashimi } from './render.ts'
import { decoysFor, judgeTaps, roundSignal, TARGET } from './rules.ts'

/** Seconds between rounds. */
const PAUSE = 2
/** Seconds between the last round and the result screen. */
const END_DELAY = 2

export interface State {
  rounds: Rounds
  /** The bell: waits, then rings (phase 'live'). */
  sig: SignalState
  /** Decoy flash times, seconds since the wait began. */
  decoys: number[]
  /** Decoy flashes shown so far this round. */
  shown: number
  /** Game time the real bell rang (-1 until it does). */
  ringAt: number
  /** Winner of the round once decided, 'draw', or null while open. */
  took: Side | 'draw' | null
  /** Game time the round was decided (-1 while open). */
  endAt: number
  /** Who tapped before the bell (for the bonk). */
  early: [boolean, boolean]
  earlyAt: number
  /** The match winner once decided. */
  winner: Side | null
}

/** Match length: first to N round wins (best of 5 by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class LastSashimi extends BaseGame<State> {
  private bots: [SashimiBot | null, SashimiBot | null] = [null, null]

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new SashimiBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [SashimiBot | null, SashimiBot | null]
    const sig = roundSignal(ctx.rng)
    const decoys = decoysFor(ctx.rng, sig.at)
    for (const bot of this.bots) bot?.newRound(decoys)
    return {
      rounds: roundsNew(ctx.target || match.default),
      sig,
      decoys,
      shown: 0,
      ringAt: -1,
      took: null,
      endAt: -1,
      early: [false, false],
      earlyAt: -1,
      winner: null,
    }
  }

  /** A fresh round: a new bell, new decoys, and the bots plan again. */
  private startRound(): void {
    const s = this.s
    s.sig = roundSignal(this.ctx.rng)
    s.decoys = decoysFor(this.ctx.rng, s.sig.at)
    s.shown = 0
    s.ringAt = -1
    s.took = null
    s.endAt = -1
    s.early = [false, false]
    s.earlyAt = -1
    for (const bot of this.bots) bot?.newRound(s.decoys)
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, PAUSE)) this.startRound()
    if (s.rounds.phase !== 'play') return

    // Who tapped this step: humans from their half, bots from their plan.
    const tapped: [boolean, boolean] = [false, false]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      tapped[side] = bot ? bot.act(s.sig.phase, s.sig.t) : taps(ctx, side) > 0
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
    }
    const w = judgeTaps(s.sig.phase, tapped)
    if (w !== null) {
      this.decide(w, tapped)
      return
    }

    // Nobody has tapped: run the bell. Decoys flash on the way.
    if (signalStep(s.sig, dt)) {
      s.ringAt = this.time
      ctx.audio.play('coin', 1.25)
      ctx.audio.play('score', 1.3)
      ctx.audio.play('hit', 1.6)
      ctx.fx.flash('#ffe27a', 0.3)
      ctx.fx.shake(0.14)
      ctx.fx.ring(PIECE.x, PIECE.y, '#ffe27a', 300)
      ctx.fx.ring(BELL.x - 60, BELL.y, '#ffe27a', 200)
      ctx.fx.sparks(BELL.x - 60, BELL.y, '#ffe27a', 18)
    } else if (s.sig.phase === 'wait') {
      while (s.shown < s.decoys.length && s.sig.t >= (s.decoys[s.shown] ?? Infinity)) {
        s.shown++
        ctx.audio.play('pop', s.shown === 1 ? 0.8 : 1.15)
        ctx.audio.play('boing', 0.7)
        ctx.fx.ring(BELL.x - 60, BELL.y, '#9d6bff', 150)
      }
    }
  }

  /** The round is decided by a tap: before the bell (a false start) or after it. */
  private decide(w: Side | 'draw', tapped: [boolean, boolean]): void {
    const s = this.s
    const { ctx } = this
    const early = s.sig.phase === 'wait'
    if (early) {
      s.early = tapped
      s.earlyAt = this.time
      for (const side of [0, 1] as Side[]) {
        if (!tapped[side]) continue
        const p = frame(side, TIP.x, TIP.y)
        ctx.audio.play('error', side === 0 ? 1 : 1.1)
        ctx.fx.float('TOO SOON!', p.x, p.y + (side === 0 ? 250 : -250), '#ffffff', 60, side)
        ctx.fx.shake(0.25)
      }
    } else if (w !== 'draw') {
      const p = frame(w, PIECE.x, PIECE.y)
      const f = frame(w, TIP.x + 230, TIP.y + 120)
      const ms = Math.round((this.time - s.ringAt) * 1000)
      ctx.audio.play('chomp', w === 0 ? 1 : 1.08)
      ctx.audio.play('whoosh', 1.2)
      ctx.fx.float(`${ms} ms`, f.x, f.y, SIDE[w].light, 60, w)
      ctx.fx.sparks(p.x, p.y, '#fff3c4', 14)
      ctx.fx.burst(p.x, p.y, SIDE[w].main, {
        count: 24,
        speed: 620,
        size: 12,
        life: 0.7,
        gravity: 500,
      })
      ctx.fx.ring(p.x, p.y, '#fff3c4', 220)
      ctx.fx.shake(0.35)
      ctx.fx.stop(3)
    }
    s.took = w
    s.endAt = this.time
    if (w === 'draw') {
      ctx.audio.play('thud')
      roundEnd(s.rounds, 'draw', this.time, ctx.names)
      return
    }
    if (roundEnd(s.rounds, w, this.time, ctx.names)) {
      s.winner = w
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: END_DELAY })
      ctx.fx.confetti(w)
    }
  }

  render(g: Draw): void {
    renderSashimi(g, this.s, this.time, { names: this.ctx.names, over: this.over })
  }
}

export default () => new LastSashimi()
