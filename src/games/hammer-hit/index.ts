import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import {
  gaugeValue,
  roundEnd,
  roundsNew,
  roundsStep,
  tapPoints,
  tapRipple,
  taps,
  type Rounds,
} from '../../engines/reflex/index.ts'
import { HammerBot } from './bot.ts'
import { COL, GAUGE, PAD, STRONG, puckY, renderHammer } from './render.ts'
import {
  FLY,
  LEAD,
  ringsBell,
  roundSpeed,
  roundWinner,
  SETTLE,
  swingNew,
  swingStep,
  swingStopped,
  swingTap,
  swingTimeout,
  TARGET,
  type Swing,
} from './rules.ts'

/** Seconds between rounds (the banner shows meanwhile). */
const PAUSE = 2

export interface State {
  rounds: Rounds
  /** Game time the current round started. */
  roundAt: number
  swings: [Swing, Swing]
  /** Game time both pucks had landed (-1 until then). */
  settleAt: number
  /** The match winner once decided (drives the ending). */
  winner: Side | 'draw' | null
}

/** World position of a side's gauge, for effects. */
const gaugeWorld = (side: Side) => frame(side, GAUGE.x, GAUGE.y)
/** World position of a side's puck at height `h`. */
const puckWorld = (side: Side, h: number) => frame(side, COL.x, puckY(h))
/** World position of a side's bell. */
const bellWorld = (side: Side) => frame(side, COL.x, COL.bellY + 40)

/** Match length: first to N round wins (best of 5 by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class HammerHit extends BaseGame<State> {
  private bots: [HammerBot | null, HammerBot | null] = [null, null]

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new HammerBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [HammerBot | null, HammerBot | null]
    const speed = roundSpeed(1, ctx.rng)
    return {
      rounds: roundsNew(ctx.target || match.default),
      roundAt: 0,
      swings: [swingNew(speed), swingNew(speed)],
      settleAt: -1,
      winner: null,
    }
  }

  /** A fresh round: both gauges reset to the same speed, so the start is fair. */
  private startRound(): void {
    const s = this.s
    const speed = roundSpeed(s.rounds.round, this.ctx.rng)
    s.roundAt = this.time
    s.swings = [swingNew(speed), swingNew(speed)]
    s.settleAt = -1
    for (const bot of this.bots) bot?.newRound()
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, PAUSE)) this.startRound()
    if (s.rounds.phase !== 'play') return

    const rt = this.time - s.roundAt
    for (const side of [0, 1] as Side[]) {
      const sw = s.swings[side]
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
      swingStep(sw, dt, rt)
      if (!swingStopped(sw)) {
        const bot = this.bots[side]
        const pressed = bot
          ? rt >= LEAD && bot.wantsStop(gaugeValue(sw.gauge))
          : taps(ctx, side) > 0
        if (pressed && swingTap(sw, rt)) this.onStop(side)
        else if (swingTimeout(sw, rt)) this.onMiss(side)
      }
      if (swingStopped(sw) && !sw.landed && rt >= sw.stopT + FLY) {
        sw.landed = true
        this.onLand(side)
      }
    }

    if (s.settleAt < 0 && s.swings.every((sw) => swingStopped(sw))) s.settleAt = this.time
    if (s.settleAt < 0 || this.time - s.settleAt < SETTLE) return

    const [a, b] = s.swings.map((sw) => sw.height) as [number, number]
    const w = roundWinner(a, b)
    this.onScore(w)
    if (roundEnd(s.rounds, w, this.time, ctx.names)) {
      s.winner = w
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
      if (w !== 'draw') {
        const b = bellWorld(w)
        ctx.fx.confetti(w)
        ctx.fx.ring(b.x, b.y, SIDE[w].light, 420)
        ctx.fx.flash(SIDE[w].main, 0.3)
        ctx.fx.shake(0.4)
      }
    }
  }

  /** The gauge was stopped: the mallet slams the pad and the puck shoots up. */
  private onStop(side: Side): void {
    const { fx, audio } = this.ctx
    const h = this.s.swings[side].height
    const p = gaugeWorld(side)
    const pad = frame(side, PAD.x, PAD.y - 20)
    audio.play('click', side === 0 ? 0.95 : 1.05)
    audio.play('hit', 0.7 + h * 0.5)
    audio.play('shoot', 0.8 + h * 0.5)
    fx.ring(p.x, p.y, '#ffffff', 90)
    fx.puff(pad.x, pad.y, 'rgba(240,220,170,0.8)', 6 + Math.round(h * 6))
    fx.burst(pad.x, pad.y, '#ffe27a', {
      count: 6 + Math.round(h * 12),
      speed: 300 + h * 500,
      size: 8,
      life: 0.35,
      gravity: 900,
      spread: Math.PI,
      dir: side === 0 ? -Math.PI / 2 : Math.PI / 2,
      kind: 'spark',
    })
    fx.shake(0.08 + h * 0.18)
    fx.stop(2)
  }

  /** Too slow: a sad buzz and a flat puck. */
  private onMiss(side: Side): void {
    const { fx, audio } = this.ctx
    const p = frame(side, STRONG.x, STRONG.y - 130)
    audio.play('buzz')
    fx.float('Too slow', p.x, p.y, 'rgba(255,255,255,0.9)', 52, side)
  }

  /** The puck reached the top of its column. Ringing the bell gets the full treatment. */
  private onLand(side: Side): void {
    const { fx, audio } = this.ctx
    const h = this.s.swings[side].height
    const top = puckWorld(side, h)
    if (!ringsBell(h)) {
      audio.play('thud', 0.8 + h * 0.4)
      fx.burst(top.x, top.y, SIDE[side].light, {
        count: 8,
        speed: 260,
        size: 8,
        life: 0.35,
        gravity: 400,
      })
      const tag = frame(side, COL.x + 160, puckY(h) - 90)
      if (h < 0.5) fx.float(h < 0.05 ? 'Whiff' : 'Weak!', tag.x, tag.y, '#ffffff', 48, side)
      return
    }
    const b = bellWorld(side)
    audio.play('coin', 1.15)
    audio.play('hit', 1.2)
    fx.burst(b.x, b.y, '#ffe27a', { count: 26, speed: 640, size: 12, life: 0.7, gravity: 500 })
    fx.ring(b.x, b.y, '#ffe27a', 240)
    const d = frame(side, COL.x - 230, COL.bellY + 120)
    fx.float('DING!', d.x, d.y, '#ffe27a', 92, side)
    fx.shake(0.45)
    fx.flash('#ffe27a', 0.22)
    fx.stop(4)
  }

  /** The round is decided: a fanfare for the winner, a thud for a draw. */
  private onScore(w: Side | 'draw'): void {
    const { fx, audio } = this.ctx
    if (w === 'draw') {
      audio.play('draw')
      return
    }
    const h = this.s.swings[w].height
    const p = puckWorld(w, h)
    audio.play('score')
    fx.burst(p.x, p.y, SIDE[w].main, {
      count: 26,
      speed: 700,
      size: 12,
      life: 0.8,
      gravity: 300,
      colors: [SIDE[w].main, SIDE[w].light, '#ffffff', '#ffe27a'],
    })
    fx.ring(p.x, p.y, SIDE[w].light, 220)
  }

  render(g: Draw): void {
    renderHammer(g, this.s, this.time, {
      names: this.ctx.names,
      over: this.over,
      winner: this.s.winner,
      bots: this.ctx.bots,
    })
  }
}

export default () => new HammerHit()
