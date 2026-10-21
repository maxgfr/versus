import { BaseGame, other, type MatchSpec, type Side } from '../../core/game.ts'
import { SIDE } from '../../core/render/palette.ts'
import type { Draw } from '../../core/render/draw.ts'
import { frame } from '../../core/frame.ts'
import { W } from '../../core/stage.ts'
import {
  roundEnd,
  roundsNew,
  roundsStep,
  tapPoints,
  tapRipple,
  taps,
  type Rounds,
} from '../../engines/reflex/index.ts'
import { PotatoBot } from './bot.ts'
import { renderPotato } from './render.ts'
import {
  boomDelay,
  canThrow,
  heatOf,
  loserAt,
  potatoNew,
  LIMIT_R,
  potatoStep,
  throwPotato,
  TARGET,
  type Potato,
} from './rules.ts'

/** Seconds between rounds. */
const PAUSE = 2
/** Seconds between the last round and the result screen. */
const END_DELAY = 2

export interface State {
  rounds: Rounds
  pot: Potato
  /** Game time the hidden timer blows the potato. */
  boomAt: number
  /** Game time it blew, -1 until it does. */
  boomed: number
  /** Who serves this round (the loser of the last one). */
  server: Side
  /** Game time of the last throw, -1 for none. */
  throwAt: number
  /** Who threw it last. */
  thrower: Side
  /** Game time the potato last landed at a catch point. */
  landAt: number
  /** The match winner once decided. */
  winner: Side | null
}

/** Match length: first to N round wins (best of 5 by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class HotPotato extends BaseGame<State> {
  private bots: [PotatoBot | null, PotatoBot | null] = [null, null]

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new PotatoBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [PotatoBot | null, PotatoBot | null]
    const server: Side = ctx.rng.chance(0.5) ? 1 : 0
    return {
      rounds: roundsNew(ctx.target || match.default),
      pot: potatoNew(server, 0),
      boomAt: boomDelay(ctx.rng),
      boomed: -1,
      server,
      throwAt: -1,
      thrower: server,
      landAt: -10,
      winner: null,
    }
  }

  /** A fresh round: the server holds the potato at their catch point, on the hidden timer. */
  private startRound(): void {
    const s = this.s
    s.pot = potatoNew(s.server, this.time)
    s.boomAt = this.time + boomDelay(this.ctx.rng)
    s.boomed = -1
    s.throwAt = -1
    s.landAt = this.time
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, PAUSE)) this.startRound()
    if (s.rounds.phase !== 'play') return

    if (this.time >= s.boomAt) {
      this.explode()
      return
    }

    // Throws: a holder who is past the catch delay sends it back.
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      const want = bot
        ? bot.drive(this.time, s.pot.holder, s.pot.enteredAt, side)
        : taps(ctx, side) > 0
      for (const p of tapPoints(ctx, side)) tapRipple(ctx, side, p.x, p.y)
      if (want && canThrow(s.pot, side, this.time)) {
        this.throwBy(side)
        break
      }
    }

    const before = s.pot.holder
    const flying = !s.pot.held
    potatoStep(s.pot, dt, this.time)
    if (flying && s.pot.held) {
      // Caught: a soft thump into the mitt.
      s.landAt = this.time
      const heat = heatOf(s.pot.throws)
      ctx.audio.play('thud', 1 + heat * 0.4)
      ctx.fx.puff(W / 2, s.pot.y, 'rgba(255,220,180,0.5)', 4)
      if (heat > 0.5) ctx.audio.play('zap', 0.7 + heat * 0.5)
    }
    if (s.pot.holder !== before) {
      // Crossing the midline: a soft tick and a puff of steam.
      ctx.audio.play('tick', 0.8)
      ctx.fx.puff(W / 2, s.pot.y, 'rgba(255,220,180,0.5)', 3)
    }
  }

  /** The holder sends the potato back toward the other half. */
  private throwBy(side: Side): void {
    const s = this.s
    const { fx, audio } = this.ctx
    throwPotato(s.pot, side)
    s.throwAt = this.time
    s.thrower = side
    const heat = heatOf(s.pot.throws)
    audio.play('boing', 0.85 + heat * 0.7)
    audio.play('whoosh', 0.9 + heat * 0.4)
    fx.shake(0.05 + heat * 0.12)
    const ember = heat > 0.35 ? 10 : 5
    fx.burst(W / 2, s.pot.y, SIDE[side].light, {
      count: ember + Math.round(heat * 8),
      speed: 300 + heat * 260,
      size: 8 + heat * 8,
      life: 0.45,
      gravity: 200,
      colors: ['#ffcd3c', '#ff8b3d', '#ff4b5c'],
    })
  }

  /** The hidden timer goes off: whoever holds it loses the round. */
  private explode(): void {
    const s = this.s
    const { fx, audio } = this.ctx
    const loser = loserAt(s.pot)
    const winner = other(loser)
    s.boomed = this.time
    audio.play('explode')
    fx.burst(W / 2, s.pot.y, '#ffb13b', {
      count: 40,
      speed: 760,
      size: 16,
      life: 0.9,
      gravity: 300,
    })
    fx.burst(W / 2, s.pot.y, '#3a2a20', {
      count: 18,
      speed: 380,
      size: 26,
      life: 0.9,
      gravity: -40,
      drag: 2,
    })
    fx.ring(W / 2, s.pot.y, '#ffcd3c', 280)
    fx.flash('#ffb13b', 0.45)
    fx.shake(0.8)
    fx.stop(6)
    // The loser serves the next potato.
    s.server = loser
    const f = frame(loser, W / 2 + 260, LIMIT_R - 160)
    fx.float('BOOM!', f.x, f.y, '#ffcd3c', 110, loser)
    fx.burst(W / 2, s.pot.y, '#000000', {
      count: 8,
      speed: 600,
      size: 40,
      life: 0.9,
      gravity: 700,
      kind: 'emoji',
      glyph: '🥔',
    })
    if (roundEnd(s.rounds, winner, this.time, this.ctx.names)) {
      s.winner = winner
      this.finish(winner, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: END_DELAY })
      fx.confetti(winner)
    }
  }

  render(g: Draw): void {
    renderPotato(g, this.s, this.time, {
      names: this.ctx.names,
      over: this.over,
      bots: this.ctx.bots,
    })
  }
}

export default () => new HotPotato()
