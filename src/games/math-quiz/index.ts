import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { bigScore, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { frame } from '../../core/frame.ts'
import { MID, W } from '../../core/stage.ts'
import {
  drawBackdrop,
  drawOptions,
  drawSum,
  GRID_MID_Y,
  optionAt,
  optionCentre,
  racePips,
} from './render.ts'
import { planBot } from './bot.ts'
import { champion, dealSum, due, effort, nextSum, press, TARGET, type QuizState } from './rules.ts'

/** Seconds between the winning answer and the result screen. */
const END_DELAY = 2.3

/** Match length: first to N points. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 3, max: 21 }

export interface State extends QuizState {
  /** Game time the computer taps next (-1 none), and which button it hits. */
  botAt: [number, number]
  botIdx: [number, number]
  /** Last button each side tapped: when, which, and whether it was right. */
  pressAt: [number, number]
  pressIdx: [number, number]
  pressOk: [boolean, boolean]
  /** Game time the match was decided (-1 while it runs). */
  endAt: number
}

class MathQuizGame extends BaseGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const s = dealSum(this.ctx.rng, this.ctx.difficulty, 0, 0)
    const state: State = {
      ...s,
      botAt: [-1, -1],
      botIdx: [0, 0],
      pressAt: [-10, -10],
      pressIdx: [-1, -1],
      pressOk: [false, false],
      endAt: -1,
    }
    this.s = state
    this.planBots()
    return state
  }

  /** 0..1 how close the leader is to winning: later sums get bigger. */
  private heat(): number {
    const lead = Math.max(this.s.score[0], this.s.score[1])
    return Math.min(1, Math.max(0, lead / Math.max(1, this.target - 1)))
  }

  /** Each computer side times its answer to this sum. */
  private planBots(): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      if (!this.isBot(side)) {
        s.botAt[side] = -1
        continue
      }
      const p = planBot(this.ctx.difficulty, this.ctx.rng, s.choices[side], s.q.answer, effort(s.q))
      s.botAt[side] = this.time + p.delay
      s.botIdx[side] = p.idx
    }
  }

  protected step(_dt: number): void {
    const s = this.s
    if (due(s, this.time)) {
      nextSum(s, this.ctx.rng, this.ctx.difficulty, this.time, this.heat())
      s.pressIdx = [-1, -1]
      s.pressOk = [false, false]
      this.planBots()
      this.ctx.audio.play('pop', 1 + this.ctx.rng.range(-0.05, 0.05))
      this.ctx.audio.play('whoosh', 1.3)
    }
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        if (s.botAt[side] >= 0 && this.time >= s.botAt[side]) {
          s.botAt[side] = -1
          this.answer(side, s.botIdx[side])
        }
        continue
      }
      for (const p of this.ctx.input.player(side).downs) {
        const i = optionAt(side, p.x, p.y)
        if (i >= 0) this.answer(side, i)
      }
    }
  }

  private answer(side: Side, idx: number): void {
    const s = this.s
    const out = press(s, side, idx, this.time)
    if (out === 'ignored') return
    s.pressAt[side] = this.time
    s.pressIdx[side] = idx
    s.pressOk[side] = out === 'right'
    const b = optionCentre(side, idx)
    const fx = this.ctx.fx
    const audio = this.ctx.audio
    if (out === 'right') {
      fx.burst(b.x, b.y, SIDE[side].light, {
        count: 28,
        speed: 620,
        size: 13,
        colors: [SIDE[side].light, SIDE[side].main, C.yellow, C.white],
      })
      fx.sparks(b.x, b.y, C.yellow, 14)
      fx.ring(b.x, b.y, C.yellow, 190)
      fx.float('+1', b.x, b.y + (side === 0 ? -40 : 40), C.yellow, 110, side)
      // The answer lands on the scoreboard.
      const slot =
        this.ctx.mode === '2p' ? frame(side, W / 2 + 200, MID + 110) : { x: W / 2 + 200, y: MID }
      fx.burst(slot.x, slot.y, SIDE[side].main, { count: 14, speed: 380, size: 10, gravity: 0 })
      fx.shake(0.18)
      fx.stop(3)
      audio.play('coin', 1 + Math.max(0, s.score[side]) * 0.03)
      audio.play('score')
      if (champion(s, this.target) === side) {
        s.endAt = this.time
        fx.flash(SIDE[side].light, 0.35)
        fx.shake(0.5)
        fx.stop(8)
        fx.ring(W / 2, MID, SIDE[side].main, 600)
        fx.confetti(side)
        this.finish(side, { score: [s.score[0], s.score[1]], delay: END_DELAY })
      }
      return
    }
    fx.burst(b.x, b.y, C.ink4, { count: 14, speed: 340, size: 10, gravity: 700, kind: 'square' })
    fx.float('-1', b.x, b.y + (side === 0 ? -40 : 40), C.redLight, 110, side)
    fx.shake(0.28)
    fx.stop(2)
    audio.play('buzz')
    if (s.done) {
      // Both out: nobody scores, the next sum is coming.
      for (const k of [0, 1] as Side[]) {
        const c = frame(k, 500, GRID_MID_Y)
        fx.float('No point', c.x, c.y, C.white, 64, k)
      }
      audio.play('thud')
    }
  }

  render(g: Draw): void {
    const s = this.s
    drawBackdrop(g)
    drawSum(g, s, this.time, this.ctx.names)
    // Online, each phone draws only its own player's answer buttons.
    for (const side of [0, 1] as Side[])
      if (g.viewer === null || g.viewer === side) drawOptions(g, s, side, this.time)
    for (const side of [0, 1] as Side[]) {
      const bot = this.isBot(side)
      const ended = s.endAt >= 0
      const label = ended
        ? undefined
        : s.locked[side] && !s.done
          ? 'Locked out'
          : !s.done && bot
            ? 'Thinking…'
            : undefined
      const active = s.done && s.winner === side && (ended || this.time - s.doneAt < 1.2)
      namePill(g, side, this.ctx.names[side], label ? { active, text: label } : { active })
      bigScore(g, side, s.score[side], { x: side === 0 ? 130 : 870 })
      const at = s.done && s.winner === side ? s.doneAt : -10
      racePips(g, side, Math.max(0, s.score[side]), this.target, this.time, at)
    }
  }
}

export default () => new MathQuizGame()
