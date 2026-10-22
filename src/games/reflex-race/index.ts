import { Button } from '../../core/controls.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { bigScore, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { frame } from '../../core/frame.ts'
import { planReaction } from './bot.ts'
import {
  drawButton,
  drawPictureCard,
  drawRule,
  drawTable,
  scoreMeter,
  buttonCentre,
  cardCentre,
  BUTTON,
  HIT_RING,
} from './render.ts'
import { Spring } from '../../core/fx/ease.ts'
import {
  advance,
  champion,
  INTRO_TIME,
  newRace,
  type Tap,
  tapAll,
  TARGET,
  type RaceState,
} from './rules.ts'

/** Seconds between the winning tap and the result screen. */
const END_DELAY = 2.3

/** Match length: first to N points, chosen before the game. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 3, max: 21 }

export interface State extends RaceState {
  /** Game time the computer taps next (-1 none). */
  botAt: [number, number]
  /** Game time the match was decided (-1 while it runs). */
  endAt: number
}

class ReflexRaceGame extends BaseGame<State> {
  private buttons!: [Button, Button]
  /** Points that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }
  /** Last countdown number announced (sound only, never read by the rules). */
  private counted = -1
  // Cosmetic only: score pulse per side.
  private pulse: [Spring, Spring] = [new Spring(0, 240, 11), new Spring(0, 240, 11)]

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
    // A match nobody caught before it flipped away: a little "too slow" for both.
    const lost = s.phase === 'play' && s.picMatch
    const ev = advance(s, this.ctx.rng, this.time, this.goal)
    if (ev === 'flip') {
      if (first) audio.play('go')
      if (lost && !first) {
        audio.play('swish', 0.7)
        for (const side of [0, 1] as Side[]) {
          const card = cardCentre(side, this.ctx.mode === '2p')
          this.ctx.fx.float(
            'Too slow!',
            card.x,
            card.y + (side === 0 ? -190 : 190),
            C.white,
            44,
            side,
          )
          if (this.ctx.mode !== '2p') break
        }
      }
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
    const pressed: Side[] = []
    for (const side of [0, 1] as Side[]) {
      const btn = this.buttons[side]
      if (this.isBot(side) && s.botAt[side] >= 0 && this.time >= s.botAt[side]) {
        s.botAt[side] = -1
        btn.press()
      }
      btn.update(this.ctx.input.player(side))
      if (btn.hit) pressed.push(side)
    }
    // Both on the same step: a coin flip decides who was first, not the colour.
    const react = s.picAt >= 0 ? this.time - s.picAt : 9
    for (const { side, r } of tapAll(s, pressed, this.time, this.ctx.rng))
      this.tapBy(side, r, react)
  }

  private tapBy(side: Side, r: Tap, react: number): void {
    const s = this.s
    if (r === 'ignored') return
    const fx = this.ctx.fx
    const audio = this.ctx.audio
    const b = buttonCentre(side)
    const card = cardCentre(side, this.ctx.mode === '2p')
    if (r === 'hit') {
      // k: how quick the reaction was (1 = lightning, 0 = at the last moment).
      const k = Math.max(0, Math.min(1, 1 - (react - 0.25) / (s.picFor - 0.25)))
      fx.burst(b.x, b.y, SIDE[side].light, {
        count: Math.round(20 + k * 24),
        speed: 480 + k * 360,
        size: 13,
        colors: [SIDE[side].light, SIDE[side].main, C.yellow, C.white],
      })
      fx.sparks(b.x, b.y, C.yellow, Math.round(10 + k * 14))
      fx.ring(b.x, b.y, C.yellow, HIT_RING * (0.8 + k * 0.5))
      fx.ring(card.x, card.y, SIDE[side].main, 260)
      fx.burst(card.x, card.y, C.yellow, { count: 16, speed: 520, size: 9, kind: 'spark' })
      fx.float('+1', card.x, card.y, SIDE[side].light, 130, side)
      // The reaction time, under the button: the quicker, the louder the praise.
      const label = react < 0.32 ? `Lightning! ${react.toFixed(2)} s` : `${react.toFixed(2)} s`
      fx.float(label, b.x, b.y + (side === 0 ? -200 : 200), k > 0.7 ? C.yellow : C.white, 48, side)
      fx.shake(0.16 + k * 0.2)
      fx.stop(Math.round(2 + k * 4))
      fx.flash(SIDE[side].light, 0.15 + k * 0.12)
      audio.play('score', 0.95 + k * 0.2)
      audio.play('coin', 1 + Math.max(0, s.score[side]) * 0.05)
      audio.buzz(Math.round(15 + k * 25))
      this.pulse[side].kick(16)
      if (champion(s, this.goal) === side) {
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
    audio.buzz(40)
    this.pulse[side].kick(-10)
  }

  render(g: Draw): void {
    const s = this.s
    for (const p of this.pulse) p.update(1 / 60)
    drawTable(g)
    for (const side of [0, 1] as Side[]) {
      drawRule(g, side, s, this.time)
      // Online, each phone shows only its own player's button.
      if (g.viewer === null || g.viewer === side) drawButton(g, s, side, this.time)
    }
    drawPictureCard(g, s, this.time, this.ctx.names)
    for (const side of [0, 1] as Side[]) {
      const frozen = s.frozen[side] >= 0 && this.time < s.frozen[side]
      const active = s.phase === 'point' && s.winner === side
      namePill(g, side, this.ctx.names[side], frozen ? { active, text: 'Wait…' } : { active })
      scoreMeter(g, side, Math.max(0, s.score[side]), this.goal, side === 0 ? 810 : 190)
      const pk = this.pulse[side].value / 16
      bigScore(g, side, s.score[side], { x: side === 0 ? 130 : 870, size: 76 * (1 + 0.3 * pk) })
    }
  }
}

export default () => new ReflexRaceGame()
