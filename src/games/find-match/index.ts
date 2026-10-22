import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { bigScore, namePill } from '../../core/hud.ts'
import { toLocal } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { findDelay, SLIP } from './bot.ts'
import {
  drawCentre,
  drawOwn,
  drawTable,
  drawWinner,
  FLY_TIME,
  ownCentre,
  racePips,
  symbolWorld,
  OWN_Y,
} from './render.ts'
import {
  CARD_R,
  champion,
  FREEZE,
  heat,
  newFind,
  symbolAt,
  tap,
  target,
  TARGET,
  type FindState,
  type Layout,
} from './rules.ts'

/** Seconds between the winning tap and the result screen. */
const END_DELAY = 2.4

/** Match length: first to N points, chosen before the game. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 3, max: 21 }

export interface State extends FindState {
  /** Game time the computer taps next (-1 none). */
  botAt: [number, number]
  /** The centre card a scored card is flying onto (drawn under it until it lands). */
  prev: Layout | null
  /** Game time the match was decided (-1 while it runs). */
  endAt: number
}

class FindMatchGame extends BaseGame<State> {
  /** The flight whose landing has been celebrated (sound and dust only). */
  private landed = -1
  /** Points that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const s: State = { ...newFind(this.ctx.rng, 0), botAt: [-1, -1], prev: null, endAt: -1 }
    this.s = s
    this.planBots()
    return s
  }

  /** The shared card changed, so both computer players start looking again. */
  private planBots(): void {
    for (const side of [0, 1] as Side[]) {
      this.s.botAt[side] = this.isBot(side)
        ? this.time + findDelay(this.ctx.difficulty, this.ctx.rng, heat(this.s, this.goal))
        : -1
    }
  }

  protected step(_dt: number): void {
    const s = this.s
    this.land()
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        if (s.botAt[side] >= 0 && this.time >= s.botAt[side]) {
          s.botAt[side] = -1
          const want = target(s, side)
          // Now and then a look-alike catches its eye first: it is frozen like anyone.
          const wrongs = s.own[side].items.filter((it) => it.s !== want)
          if (wrongs.length > 0 && this.ctx.rng.chance(SLIP[this.ctx.difficulty])) {
            this.attempt(side, this.ctx.rng.pick(wrongs).s)
            // After the freeze it looks again (more quickly: it has half seen it).
            s.botAt[side] =
              this.time +
              FREEZE +
              findDelay(this.ctx.difficulty, this.ctx.rng, heat(s, this.goal)) * 0.5
          } else this.attempt(side, want)
        }
        continue
      }
      for (const p of this.ctx.input.player(side).downs) {
        const l = toLocal(side, p.x, p.y)
        const sym = symbolAt(s.own[side], l.x - 500, l.y - OWN_Y)
        if (sym >= 0) this.attempt(side, sym)
      }
    }
  }

  protected override afterEnd(_dt: number): void {
    this.land()
  }

  /** The flying card touches down on the pile. */
  private land(): void {
    const s = this.s
    if (s.flySide === null || s.flyAt === this.landed || this.time - s.flyAt < FLY_TIME) return
    this.landed = s.flyAt
    const fx = this.ctx.fx
    // A ring of dust kicked out from under the card's edge.
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2
      fx.burst(
        W / 2 + Math.cos(ang) * CARD_R,
        MID + Math.sin(ang) * CARD_R,
        'rgba(255,240,220,0.45)',
        {
          count: 3,
          speed: 260,
          size: 12,
          life: 0.4,
          gravity: 0,
          drag: 5,
          spread: 0.7,
          dir: ang,
        },
      )
    }
    fx.ring(W / 2, MID, C.yellow, 300)
    fx.shake(0.12)
    this.ctx.audio.play('place')
  }

  /** A side taps symbol `sym` on its card: a point (the card flies to the middle) or a freeze. */
  private attempt(side: Side, sym: number): void {
    const s = this.s
    const fx = this.ctx.fx
    const audio = this.ctx.audio
    const item = s.own[side].items.find((it) => it.s === sym)
    const at = item ? symbolWorld(side, item.x, item.y) : ownCentre(side)
    const before = s.centre
    const result = tap(s, side, sym, this.time, this.ctx.rng, this.goal)
    if (result === 'ignored') return
    if (result === 'miss') {
      fx.burst(at.x, at.y, C.ink4, {
        count: 12,
        speed: 320,
        size: 10,
        gravity: 700,
        kind: 'square',
      })
      fx.float('Nope!', at.x, at.y + (side === 0 ? -90 : 90), C.redLight, 60, side)
      fx.shake(0.22)
      fx.stop(2)
      audio.play('buzz')
      return
    }
    s.prev = before
    fx.burst(at.x, at.y, SIDE[side].light, {
      count: 26,
      speed: 600,
      size: 12,
      colors: [SIDE[side].light, SIDE[side].main, C.yellow, C.white],
    })
    fx.sparks(at.x, at.y, C.yellow, 14)
    fx.ring(at.x, at.y, C.yellow, 150)
    const c = ownCentre(side)
    fx.float('+1', c.x, c.y + (side === 0 ? -150 : 150), C.yellow, 110, side)
    fx.shake(0.2)
    fx.stop(3)
    fx.flash(SIDE[side].light, 0.18)
    audio.play('score')
    audio.play('whoosh', 1.2)
    this.planBots()
    if (champion(s, this.goal) === side) {
      s.endAt = this.time
      fx.confetti(side)
      fx.flash(SIDE[side].light, 0.4)
      fx.shake(0.5)
      fx.stop(8)
      this.finish(side, { score: [s.score[0], s.score[1]], delay: END_DELAY })
    }
  }

  render(g: Draw): void {
    const s = this.s
    drawTable(g)
    drawCentre(g, s, this.time)
    for (const side of [0, 1] as Side[]) {
      drawOwn(g, s, side, this.time)
      const frozen = s.frozen[side] >= 0 && this.time < s.frozen[side]
      const active = s.flySide === side && (s.endAt >= 0 || this.time - s.flyAt < 1)
      namePill(g, side, this.ctx.names[side], frozen ? { active, text: 'Frozen…' } : { active })
      bigScore(g, side, s.score[side], { x: side === 0 ? 130 : 870 })
      const at = s.flySide === side ? s.flyAt : -10
      racePips(g, side, s.score[side], this.goal, this.time, at)
    }
    drawWinner(g, s, this.time, this.ctx.names)
  }
}

export default () => new FindMatchGame()
