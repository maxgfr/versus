import { other, type MatchSpec, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
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
import { botPow, Flick, TAP_POW, turnInputs } from '../yazy/throw.ts'
import { decide } from './bot.ts'
import { CELL_ROW, cellCentre, cellOfRow, renderClassic, ROLL, SHEET, TRAY } from './render.ts'
import {
  emptySheet,
  full,
  isLegal,
  isYazy,
  jokerOn,
  legalRows,
  MAX_ROLLS,
  NROWS,
  ROWS,
  type Sheet,
  scoreRow,
  total,
  turnsPlayed,
  UPPER_BONUS,
  UPPER_TARGET,
  upperSum,
  YAZY_BONUS,
  YAZY_ROW,
} from './rules.ts'

/** A match is a number of turns each; every turn scores one row of the sheet. */
export const match: MatchSpec = { unit: 'rounds', default: NROWS, min: 1, max: NROWS }

export interface State extends DiceState {
  turn: Side
  sheets: [Sheet, Sheet]
  /** Last row scored, for the pop animation; `gain` is what it added to the total. */
  last: { side: Side; row: number; at: number; gain: number } | null
  /** When a side's upper section first reached the bonus. */
  upperAt: { side: Side; at: number } | null
  /** The game is decided: drives the final ribbon over both sheets. */
  end: { at: number; winner: Side | 'draw' } | null
  /** Energy of the last throw (0..1): how hard the dice fly and land. */
  pow: number
}

/** Inside the tray (with a margin): where a press starts a throw or a hold. */
const inTray = (x: number, y: number): boolean =>
  x > TRAY.x - 30 && x < TRAY.x + TRAY.w + 30 && y > TRAY.y - 40 && y < TRAY.y + TRAY.h + 40

class YazyClassic extends TurnGame<State> {
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
      upperAt: null,
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

  /** The dice settle: a thud, dust, and a celebration for five alike. */
  private land(): void {
    const s = this.s
    const fx = this.ctx.fx
    // The harder the throw, the harder the dice land.
    this.ctx.audio.play('place', 0.8 + s.pow * 0.25)
    fx.shake(0.04 + s.pow * 0.12)
    this.ctx.audio.buzz(Math.round(4 + s.pow * 10))
    for (const [i, slot] of TRAY.slots.entries()) {
      if (!s.held[i]) fx.puff(slot.x, slot.y + 55, 'rgba(255,255,255,0.3)', 2)
    }
    if (!isYazy(s.dice)) return
    this.ctx.audio.buzz(40)
    const bonus = jokerOn(s.dice, s.sheets[s.turn])
    fx.flash(C.yellow, 0.3)
    fx.shake(0.35)
    fx.stop(4)
    fx.ring(W / 2, MID, C.yellow, 420)
    for (const slot of TRAY.slots) fx.sparks(slot.x, slot.y, C.yellow, 10)
    this.ctx.audio.play('powerup', bonus ? 1.25 : 1.1)
    if (bonus) {
      // A second Yazy: the +100 is coming, upright for the player rolling.
      const p = frame(s.turn, W / 2, TRAY.y + TRAY.h + 70)
      fx.float(`Bonus +${YAZY_BONUS}`, p.x, p.y, C.yellow, 60, s.turn)
    }
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
    const cell = sheetCellAt(SHEET, side, tap.x, tap.y)
    if (cell < 0 || s.rolls === 0) return
    const row = CELL_ROW[cell] ?? -1
    const sheet = s.sheets[side]
    if (row >= 0 && isLegal(s.dice, sheet, row)) {
      this.score(row)
      return
    }
    // Filled, the upper bonus line, or a joker that must go upstairs first.
    this.ctx.audio.play('error')
    if (row >= 0 && sheet.rows[row] === null && legalRows(s.dice, sheet).length === 1) {
      const face = ROWS[legalRows(s.dice, sheet)[0] ?? 0]?.label ?? ''
      this.ctx.fx.float(`Joker: ${face}`, tap.x, tap.y, C.yellow, 44, side)
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
    } else this.score(a.row)
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

  private toggle(i: number): void {
    const s = this.s
    s.held[i] = !s.held[i]
    this.ctx.audio.play(s.held[i] ? 'pop' : 'tap', s.held[i] ? 1.15 : 0.9)
  }

  private score(row: number): void {
    const s = this.s
    const side = s.turn
    const sheet = s.sheets[side]
    const before = total(sheet)
    const upperWas = upperSum(sheet) >= UPPER_TARGET
    const { points, bonus } = scoreRow(sheet, s.dice, row)
    s.last = { side, row, at: this.time, gain: total(sheet) - before }
    const p = frame(side, cellCentre(cellOfRow(row)).x, cellCentre(cellOfRow(row)).y)
    const fx = this.ctx.fx
    if (points > 0) {
      const big = points >= 30
      fx.float(`+${points}`, p.x, p.y, C.yellow, big ? 72 : 60, side)
      fx.burst(p.x, p.y, SIDE[side].main, { count: big ? 20 : 12, speed: 420, size: 12 })
      fx.burst(p.x, p.y, C.yellow, { count: big ? 10 : 5, speed: 520, size: 8, kind: 'spark' })
      fx.ring(p.x, p.y, SIDE[side].light, big ? 200 : 140)
      if (big) {
        fx.shake(0.2)
        fx.stop(2)
      }
      this.ctx.audio.play(big ? 'coin' : 'score', 1 + Math.min(points, 50) / 200)
      this.ctx.audio.buzz(Math.round(8 + Math.min(points, 50) * 0.4))
    } else {
      fx.float('0', p.x, p.y, alpha(C.white, 0.8), 52, side)
      fx.puff(p.x, p.y, 'rgba(255,255,255,0.3)', 4)
      this.ctx.audio.play('thud')
    }
    if (bonus > 0) {
      const b = frame(side, cellCentre(cellOfRow(YAZY_ROW)).x, cellCentre(cellOfRow(YAZY_ROW)).y)
      fx.float(`+${YAZY_BONUS}`, b.x, b.y, C.yellow, 80, side)
      fx.flash(C.yellow, 0.35)
      fx.confetti(side)
      fx.shake(0.5)
      fx.stop(4)
      this.ctx.audio.play('powerup')
    }
    if (row === YAZY_ROW && points === 50) {
      fx.flash(C.yellow, 0.35)
      fx.confetti(side)
      fx.shake(0.45)
      fx.stop(4)
    }
    if (!upperWas && upperSum(sheet) >= UPPER_TARGET) {
      s.upperAt = { side, at: this.time }
      const u = frame(side, cellCentre(cellOfRow(-1)).x, cellCentre(cellOfRow(-1)).y)
      fx.float(`Bonus +${UPPER_BONUS}`, u.x, u.y - (side === 0 ? 40 : -40), C.yellow, 56, side)
      fx.ring(u.x, u.y, C.yellow, 200)
      fx.burst(u.x, u.y, C.yellow, { count: 22, speed: 480, size: 14 })
      this.ctx.audio.play('powerup', 1.3)
    }
    if (full(s.sheets[0], this.target) && full(s.sheets[1], this.target)) {
      const a = total(s.sheets[0])
      const b = total(s.sheets[1])
      const winner = a === b ? 'draw' : a > b ? 0 : 1
      s.end = { at: this.time, winner }
      if (winner !== 'draw') {
        fx.confetti(winner)
        const c = frame(winner, W / 2, SHEET.y + SHEET.h / 2)
        fx.burst(c.x, c.y, C.yellow, { count: 30, speed: 700, size: 14, kind: 'square' })
      }
      fx.shake(0.3)
      this.finish(winner, { score: [a, b], delay: 2.6 })
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
    renderClassic(g, this.s, this.time, this.over, (side) => this.isBot(side), this.target, rattle)
    this.drawTurns(g)
  }
}

export default () => new YazyClassic()
