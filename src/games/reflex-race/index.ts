import { Button } from '../../core/controls.ts'
import { BaseGame, type Side } from '../../core/game.ts'
import { bigScore, namePill, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { frame } from '../../core/frame.ts'
import { planReaction } from './bot.ts'
import {
  drawButton,
  drawPictureCard,
  drawRule,
  drawTable,
  buttonCentre,
  cardCentre,
  BUTTON,
  HIT_RING,
} from './render.ts'
import { advance, champion, INTRO_TIME, newRace, tap, TARGET, type RaceState } from './rules.ts'

/** Seconds between the winning tap and the result screen. */
const END_DELAY = 2.3

export interface State extends RaceState {
  /** Game time the computer taps next (-1 none). */
  botAt: [number, number]
  /** Game time the match was decided (-1 while it runs). */
  endAt: number
}

class ReflexRaceGame extends BaseGame<State> {
  private buttons!: [Button, Button]
  /** Last countdown number announced (sound only, never read by the rules). */
  private counted = -1

  protected setup(): State {
    const s: State = { ...newRace(this.ctx.rng, 0), botAt: [-1, -1], endAt: -1 }
    this.s = s
    const red = frame(0, BUTTON.x, BUTTON.y)
    const blue = frame(1, BUTTON.x, BUTTON.y)
    this.buttons = [new Button(0, red.x, red.y, BUTTON.r), new Button(1, blue.x, blue.y, BUTTON.r)]
    return s
  }

  /** The computer plans its tap for the picture that just appeared (or cancels for a new round). */
  private planBots(): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const delay =
        this.isBot(side) && s.pic
          ? planReaction(this.ctx.difficulty, this.ctx.rng, s.picMatch)
          : null
      s.botAt[side] = delay === null ? -1 : s.picAt + delay
    }
  }

  protected step(_dt: number): void {
    const s = this.s
    const audio = this.ctx.audio
    const first = s.phase === 'intro'
    const ev = advance(s, this.ctx.rng, this.time)
    if (ev === 'flip') {
      if (first) audio.play('go')
      audio.play('flip', 1 + this.ctx.rng.range(-0.06, 0.06))
      this.planBots()
    } else if (ev === 'card-down') {
      audio.play('whoosh', 0.9)
      audio.play('flip', 0.8)
      this.planBots()
    }
    if (s.phase === 'intro') {
      const n = Math.ceil(INTRO_TIME - (this.time - s.phaseAt))
      if (n !== this.counted && n > 0) {
        this.counted = n
        audio.play('count', n === 1 ? 1.2 : 1)
      }
    } else this.counted = -1
    for (const side of [0, 1] as Side[]) {
      const btn = this.buttons[side]
      if (this.isBot(side) && s.botAt[side] >= 0 && this.time >= s.botAt[side]) {
        s.botAt[side] = -1
        btn.press()
      }
      btn.update(this.ctx.input.player(side))
      if (btn.hit) this.tapBy(side)
    }
  }

  private tapBy(side: Side): void {
    const s = this.s
    const r = tap(s, side, this.time)
    if (r === 'ignored') return
    const fx = this.ctx.fx
    const audio = this.ctx.audio
    const b = buttonCentre(side)
    const card = cardCentre(side, this.ctx.mode === '2p')
    if (r === 'hit') {
      fx.burst(b.x, b.y, SIDE[side].light, {
        count: 30,
        speed: 640,
        size: 13,
        colors: [SIDE[side].light, SIDE[side].main, C.yellow, C.white],
      })
      fx.sparks(b.x, b.y, C.yellow, 16)
      fx.ring(b.x, b.y, C.yellow, HIT_RING)
      fx.ring(card.x, card.y, SIDE[side].main, 260)
      fx.burst(card.x, card.y, C.yellow, { count: 16, speed: 520, size: 9, kind: 'spark' })
      fx.float('+1', card.x, card.y, SIDE[side].light, 130, side)
      fx.shake(0.24)
      fx.stop(4)
      fx.flash(SIDE[side].light, 0.22)
      audio.play('score')
      audio.play('coin', 1 + Math.max(0, s.score[side]) * 0.05)
      if (champion(s) === side) {
        s.endAt = this.time
        fx.confetti(side)
        fx.flash(SIDE[side].light, 0.4)
        fx.shake(0.5)
        fx.stop(8)
        this.finish(side, { score: [s.score[0], s.score[1]], delay: END_DELAY })
      }
      return
    }
    fx.burst(b.x, b.y, C.ink4, { count: 14, speed: 340, size: 10, gravity: 700, kind: 'square' })
    fx.float('-1', b.x, b.y + (side === 0 ? -40 : 40), C.redLight, 110, side)
    fx.float(
      r === 'early' ? 'Too soon!' : 'Not it!',
      b.x,
      b.y + (side === 0 ? 70 : -70),
      C.white,
      50,
      side,
    )
    fx.shake(0.3)
    fx.stop(2)
    audio.play('buzz')
  }

  render(g: Draw): void {
    const s = this.s
    drawTable(g)
    for (const side of [0, 1] as Side[]) {
      drawRule(g, side, s, this.time)
      drawButton(g, s, side, this.time)
    }
    drawPictureCard(g, s, this.time, this.ctx.names)
    for (const side of [0, 1] as Side[]) {
      const frozen = s.frozen[side] >= 0 && this.time < s.frozen[side]
      const active = s.phase === 'point' && s.winner === side
      namePill(g, side, this.ctx.names[side], frozen ? { active, text: 'Wait…' } : { active })
      pips(g, side, Math.max(0, s.score[side]), TARGET, { x: side === 0 ? 810 : 190 })
      bigScore(g, side, s.score[side], { x: side === 0 ? 130 : 870 })
    }
  }
}

export default () => new ReflexRaceGame()
