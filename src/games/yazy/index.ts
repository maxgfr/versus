import { other, type MatchSpec, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import {
  buttonHit,
  type DiceState,
  dieAt,
  frame,
  newDice,
  resetTurn,
  rollDice,
  rolling,
  sheetCellAt,
} from '../../engines/dice/index.ts'
import { decide } from './bot.ts'
import { botPow, Flick, TAP_POW, turnInputs } from './throw.ts'
import { renderYazy, ROLL, SHEET, TRAY } from './render.ts'
import {
  CATS,
  emptySheet,
  full,
  MAX_ROLLS,
  NCATS,
  score,
  type Sheet,
  total,
  turnsPlayed,
} from './rules.ts'

/** A match is a number of turns each; every turn scores one row of the sheet. */
export const match: MatchSpec = { unit: 'rounds', default: NCATS, min: 1, max: NCATS }

export interface State extends DiceState {
  turn: Side
  sheets: [Sheet, Sheet]
  /** Last row scored, for the pop animation. */
  last: { side: Side; cat: number; at: number } | null
  /** When and how the match ended, for the closing plaques. */
  end: { at: number; winner: Side | 'draw' } | null
  /** Energy of the last throw (0..1): how hard the dice fly and land. */
  pow: number
}

/** Inside the tray (with a margin): where a press starts a throw or a hold. */
const inTray = (x: number, y: number): boolean =>
  x > TRAY.x - 30 && x < TRAY.x + TRAY.w + 30 && y > TRAY.y - 40 && y < TRAY.y + TRAY.h + 40

class Yazy extends TurnGame<State> {
  private wasRolling = false
  // Cosmetic host state: one finger tracker per input that may throw.
  private flicks = [new Flick(), new Flick()]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      ...newDice(5),
      turn: this.ctx.rng.chance(0.5) ? 0 : 1,
      sheets: [emptySheet(), emptySheet()],
      last: null,
      end: null,
      pow: TAP_POW,
    }
  }

  protected override busy(): boolean {
    const r = rolling(this.s, this.time)
    if (this.wasRolling && !r) this.land()
    this.wasRolling = r
    return r
  }

  protected stepTurn(dt: number, tap: Ptr | undefined): void {
    const s = this.s
    const side = s.turn
    // The tray answers gestures: a flick throws (its speed is the throw's
    // energy), a tap holds a die (or throws gently before the first roll).
    const inputs = turnInputs(this.ctx.mode, this.ctx.input.players, side)
    for (let k = 0; k < inputs.length; k++) {
      const gst = this.flicks[k]?.update(inputs[k] as (typeof inputs)[number], dt, inTray)
      if (!gst) continue
      if (gst.kind === 'flick') {
        if (s.rolls < MAX_ROLLS) this.roll(gst.pow)
        else this.ctx.audio.play('error')
        return
      }
      const die = dieAt(TRAY, gst.x, gst.y)
      if (s.rolls === 0) this.roll(TAP_POW)
      else if (die >= 0 && s.rolls < MAX_ROLLS) this.toggle(die)
      return
    }
    if (!tap || inTray(tap.x, tap.y)) return
    if (buttonHit(ROLL, side, tap.x, tap.y)) {
      if (s.rolls < MAX_ROLLS) this.roll(TAP_POW + 0.15)
      else this.ctx.audio.play('error')
      return
    }
    const cat = sheetCellAt(SHEET, side, tap.x, tap.y)
    if (cat >= 0 && s.rolls > 0) {
      if (s.sheets[side][cat] === null) this.score(cat)
      else this.ctx.audio.play('error')
    }
  }

  protected botPlay(): void {
    const s = this.s
    const turns = this.target - turnsPlayed(s.sheets[s.turn])
    const a = decide(
      s.dice,
      s.held,
      s.rolls,
      s.sheets[s.turn],
      this.ctx.difficulty,
      this.ctx.rng,
      turns,
    )
    if (a.kind === 'roll') this.roll(botPow(this.time))
    else if (a.kind === 'hold') {
      s.held = a.held
      this.ctx.audio.play('pop', 1.1)
    } else this.score(a.cat)
  }

  /** Bots hurry up a little between steps of the same turn. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    const first = d === 'easy' ? 0.7 : d === 'normal' ? 0.55 : 0.45
    const r = this.ctx.rng.range(0, 0.25)
    return this.s.rolls === 0 ? first + r : 0.35 + r
  }

  /** Throw the loose dice with energy `pow` (0..1): the faces are a fair draw, the energy is the feel. */
  private roll(pow: number): void {
    const s = this.s
    s.pow = pow
    rollDice(s, this.ctx.rng, this.time)
    const { fx, audio } = this.ctx
    audio.play('roll', 0.85 + pow * 0.35)
    fx.shake(0.05 + pow * 0.16)
    audio.buzz(Math.round(6 + pow * 14))
    for (const [i, slot] of TRAY.slots.entries()) {
      if (!s.held[i])
        fx.puff(slot.x, slot.y + 60, 'rgba(255,255,255,0.35)', Math.round(2 + pow * 4))
    }
  }

  /** The dice come to rest: the harder the throw, the harder they land. */
  private land(): void {
    const s = this.s
    const { fx, audio } = this.ctx
    audio.play('place', 0.8 + s.pow * 0.25)
    fx.shake(0.04 + s.pow * 0.12)
    audio.buzz(Math.round(4 + s.pow * 10))
    for (const [i, slot] of TRAY.slots.entries()) {
      if (!s.held[i]) fx.puff(slot.x, slot.y + 55, 'rgba(255,255,255,0.3)', 2)
    }
    // Five alike on the felt: celebrate before it is even scored.
    if (s.dice.every((v) => v === s.dice[0])) {
      fx.ring(W / 2, TRAY.y + TRAY.h / 2, C.yellow, 420)
      fx.sparks(W / 2, TRAY.y + TRAY.h / 2, C.yellow, 24)
      audio.play('powerup')
    }
  }

  private toggle(i: number): void {
    const s = this.s
    s.held[i] = !s.held[i]
    this.ctx.audio.play(s.held[i] ? 'pop' : 'tap', s.held[i] ? 1.15 : 0.9)
  }

  private score(cat: number): void {
    const s = this.s
    const side = s.turn
    const pts = score(s.dice, cat)
    s.sheets[side][cat] = pts
    s.last = { side, cat, at: this.time }
    const c = cat % SHEET.cols
    const r = Math.floor(cat / SHEET.cols)
    const p = frame(side, SHEET.x + (c + 0.5) * SHEET.cellW, SHEET.y + (r + 0.5) * SHEET.cellH)
    const fx = this.ctx.fx
    if (pts > 0) {
      // A big row lands bigger: more sparks, a bigger float, a buzz.
      const k = Math.min(1, pts / 40)
      fx.float(`+${pts}`, p.x, p.y, C.yellow, 56 + k * 24, side)
      fx.burst(p.x, p.y, SIDE[side].main, {
        count: Math.round(10 + k * 16),
        speed: 340 + k * 300,
        size: 12,
        colors: [SIDE[side].main, SIDE[side].light, C.yellow],
      })
      if (k >= 0.6) fx.ring(p.x, p.y, C.yellow, 160)
      this.ctx.audio.buzz(Math.round(8 + k * 20))
      this.ctx.audio.play(pts >= 40 ? 'coin' : 'score', 0.9 + k * 0.25)
    } else {
      fx.float('0', p.x, p.y, C.white, 52, side)
      this.ctx.audio.play('thud')
    }
    if (CATS[cat]?.id === 'yazy' && pts > 0) {
      fx.flash(C.yellow, 0.35)
      fx.confetti(side)
      fx.shake(0.4)
      fx.stop(6)
    }
    if (full(s.sheets[0], this.target) && full(s.sheets[1], this.target)) {
      const a = total(s.sheets[0])
      const b = total(s.sheets[1])
      const winner = a === b ? 'draw' : a > b ? 0 : 1
      s.end = { at: this.time, winner }
      if (winner !== 'draw') {
        fx.confetti(winner)
        const w = frame(winner, W / 2, SHEET.y + SHEET.h / 2)
        fx.burst(w.x, w.y, C.yellow, { count: 30, speed: 700, size: 14, kind: 'square' })
      }
      fx.shake(0.3)
      this.finish(winner, { score: [a, b], delay: 2.4 })
      return
    }
    resetTurn(s)
    s.turn = other(side)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    for (const f of this.flicks) f.reset()
  }

  render(g: Draw): void {
    tableBackdrop(g)
    const rattle = Math.max(this.flicks[0]?.charge ?? 0, this.flicks[1]?.charge ?? 0)
    renderYazy(g, this.s, this.time, this.over, (side) => this.isBot(side), this.target, rattle)
    this.drawTurns(g)
  }
}

export default () => new Yazy()
