import { other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
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
import { renderYazy, ROLL, SHEET, TRAY } from './render.ts'
import { CATS, emptySheet, full, MAX_ROLLS, score, type Sheet, total } from './rules.ts'

export interface State extends DiceState {
  turn: Side
  sheets: [Sheet, Sheet]
  /** Last row scored, for the pop animation. */
  last: { side: Side; cat: number; at: number } | null
}

class Yazy extends TurnGame<State> {
  private wasRolling = false

  protected setup(): State {
    return {
      ...newDice(5),
      turn: this.ctx.rng.chance(0.5) ? 0 : 1,
      sheets: [emptySheet(), emptySheet()],
      last: null,
    }
  }

  protected override busy(): boolean {
    const r = rolling(this.s, this.time)
    if (this.wasRolling && !r) this.ctx.audio.play('place', 0.9)
    this.wasRolling = r
    return r
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const s = this.s
    const side = s.turn
    if (buttonHit(ROLL, side, tap.x, tap.y)) {
      if (s.rolls < MAX_ROLLS) this.roll()
      else this.ctx.audio.play('error')
      return
    }
    const die = dieAt(TRAY, tap.x, tap.y)
    if (die >= 0) {
      if (s.rolls === 0) this.roll()
      else if (s.rolls < MAX_ROLLS) this.toggle(die)
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
    const a = decide(s.dice, s.held, s.rolls, s.sheets[s.turn], this.ctx.difficulty, this.ctx.rng)
    if (a.kind === 'roll') this.roll()
    else if (a.kind === 'hold') {
      s.held = a.held
      this.ctx.audio.play('pop', 1.1)
    } else this.score(a.cat)
  }

  /** Bots hurry up a little between steps of the same turn. */
  protected override botDelay(): number {
    return this.s.rolls === 0 ? super.botDelay() : 0.45 + this.ctx.rng.range(0, 0.3)
  }

  private roll(): void {
    const s = this.s
    rollDice(s, this.ctx.rng, this.time)
    this.ctx.audio.play('roll')
    this.ctx.fx.shake(0.1)
    for (const [i, slot] of TRAY.slots.entries()) {
      if (!s.held[i]) this.ctx.fx.puff(slot.x, slot.y + 60, 'rgba(255,255,255,0.35)', 3)
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
      fx.float(`+${pts}`, p.x, p.y, C.yellow, 60, side)
      fx.burst(p.x, p.y, SIDE[side].main, { count: 12, speed: 380, size: 12 })
      this.ctx.audio.play(pts >= 40 ? 'coin' : 'score')
    } else {
      fx.float('0', p.x, p.y, C.white, 52, side)
      this.ctx.audio.play('thud')
    }
    if (CATS[cat]?.id === 'yazy' && pts > 0) {
      fx.flash(C.yellow, 0.35)
      fx.confetti(side)
      fx.shake(0.4)
    }
    if (full(s.sheets[0]) && full(s.sheets[1])) {
      const a = total(s.sheets[0])
      const b = total(s.sheets[1])
      this.finish(a === b ? 'draw' : a > b ? 0 : 1, { score: [a, b], delay: 1.6 })
      return
    }
    resetTurn(s)
    s.turn = other(side)
  }

  render(g: Draw): void {
    tableBackdrop(g)
    renderYazy(g, this.s, this.time, this.over, (side) => this.isBot(side))
    this.drawTurns(g)
  }
}

export default () => new Yazy()
