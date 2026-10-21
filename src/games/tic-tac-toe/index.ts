import { other, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { cellAt, cellCenter, geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { renderBoard } from './render.ts'
import { type Cell, emptyBoard, outcome, place, TARGET } from './rules.ts'

export interface State {
  turn: Side
  cells: Cell[]
  /** Game time each cell was filled, for the draw-in animation. */
  placedAt: number[]
  wins: [number, number]
  starter: Side
  line: readonly number[] | null
  /** Game time the round ended, or -1 while playing. */
  endedAt: number
  roundText: string
}

const GEO = geom(3, 3, 780, 780, MID)

class TicTacToe extends TurnGame<State> {
  protected setup(): State {
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: starter,
      cells: emptyBoard(),
      placedAt: Array(9).fill(0),
      wins: [0, 0],
      starter,
      line: null,
      endedAt: -1,
      roundText: '',
    }
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.endedAt < 0) return false
    // Round over: show the line, then reset with the other player starting.
    if (this.time - s.endedAt > 1.6) {
      s.starter = other(s.starter)
      s.turn = s.starter
      s.cells = emptyBoard()
      s.line = null
      s.endedAt = -1
      s.roundText = ''
    }
    return true
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const hit = cellAt(GEO, tap.x, tap.y)
    if (!hit) return
    const i = hit.r * 3 + hit.c
    if (this.s.cells[i] !== null) {
      this.ctx.audio.play('error')
      return
    }
    this.play(i)
  }

  protected botPlay(): void {
    this.play(choose(this.s.cells, this.s.turn, this.ctx.difficulty, this.ctx.rng))
  }

  private play(i: number): void {
    const s = this.s
    const side = s.turn
    s.cells = place(s.cells, i, side)
    s.placedAt[i] = this.time
    const { x, y } = cellCenter(GEO, i % 3, Math.floor(i / 3))
    this.ctx.audio.play('place', side === 0 ? 1 : 1.12)
    this.ctx.fx.burst(x, y, SIDE[side].main, { count: 10, speed: 380, size: 12, life: 0.45 })
    this.ctx.fx.shake(0.12)
    const o = outcome(s.cells)
    if (!o) {
      s.turn = other(side)
      return
    }
    s.endedAt = this.time
    if (o.winner === 'draw') {
      s.roundText = 'Draw round'
      this.ctx.audio.play('draw')
      return
    }
    s.line = o.line
    s.wins[o.winner]++
    s.roundText = `${this.ctx.names[o.winner]} takes the round`
    this.ctx.audio.play('score')
    this.ctx.fx.flash(SIDE[o.winner].main, 0.25)
    if (s.wins[o.winner] >= TARGET) this.finish(o.winner, { score: s.wins, delay: 1.5 })
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    renderBoard(g, s, GEO, this.time)
    this.drawTurns(g, undefined, s.endedAt < 0)
    pips(g, 0, s.wins[0], TARGET, { inset: 170 })
    pips(g, 1, s.wins[1], TARGET, { inset: 170 })
    if (s.roundText && !this.over) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      banner(g, undefined, s.roundText, MID, { size: 58, alpha: a })
    }
  }
}

export default () => new TicTacToe()
