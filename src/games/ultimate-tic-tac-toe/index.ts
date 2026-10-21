import { floatFor } from '../../core/fx/fx.ts'
import type { Ptr } from '../../core/input.ts'
import { hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { Side } from '../../core/game.ts'
import { MID } from '../../core/stage.ts'
import { cellAt, geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { boardCentre, boardTally, cellCentre, notice, renderUltimate } from './render.ts'
import {
  type Cell,
  emptyPosition,
  isLegal,
  play,
  type Position,
  type Verdict,
  verdict,
} from './rules.ts'

export interface State {
  turn: Side
  /** 81 cells, `b * 9 + i`. */
  cells: Cell[]
  /** Owner of each small board. */
  won: Cell[]
  /** Small board the next move must go to, -1 for any open board. */
  active: number
  /** Game time each cell was filled, for the draw-in animation. */
  placedAt: number[]
  /** Game time each small board was won, -1 while it is not. */
  wonAt: number[]
  /** Last move played, -1 before the first. */
  last: number
  /** Big-board line that won the game, or null. */
  line: number[] | null
  /** Game time the game was decided, or -1 while playing. */
  endedAt: number
  /** What decided the game, shown before the result screen. */
  endText: string
}

/**
 * The whole big board: nine small boards, 9 × 9 cells, centred on the table and
 * clear of the pause button on the left edge.
 */
const GEO = geom(9, 9, 780, 780, MID)

class UltimateTicTacToe extends TurnGame<State> {
  protected setup(): State {
    const turn: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    const p = emptyPosition(turn)
    return {
      turn,
      cells: p.cells,
      won: p.won,
      active: p.active,
      placedAt: Array<number>(81).fill(0),
      wonAt: Array<number>(9).fill(-1),
      last: -1,
      line: null,
      endedAt: -1,
      endText: '',
    }
  }

  private pos(): Position {
    const s = this.s
    return { turn: s.turn, cells: s.cells, won: s.won, active: s.active }
  }

  protected override busy(): boolean {
    return this.s.endedAt >= 0
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const hit = cellAt(GEO, tap.x, tap.y)
    if (!hit) return
    const b = Math.floor(hit.r / 3) * 3 + Math.floor(hit.c / 3)
    const m = b * 9 + ((hit.r % 3) * 3 + (hit.c % 3))
    if (!isLegal(this.pos(), m)) {
      this.ctx.audio.play('error')
      if (this.s.active >= 0 && this.s.active !== b) {
        // Point at the board that has to be played.
        const k = boardCentre(GEO, this.s.active)
        this.ctx.fx.ring(k.x, k.y, C.yellow, 200)
      }
      return
    }
    this.play(m)
  }

  protected botPlay(): void {
    this.play(choose(this.pos(), this.ctx.difficulty, this.ctx.rng))
  }

  private play(m: number): void {
    const s = this.s
    const fx = this.ctx.fx
    const before = s.won
    const mover = s.turn
    const next = play(this.pos(), m)
    s.turn = next.turn
    s.cells = next.cells
    s.won = next.won
    s.active = next.active
    s.placedAt[m] = this.time
    s.last = m

    const at = cellCentre(GEO, Math.floor(m / 9), m % 9)
    this.ctx.audio.play('place', mover === 0 ? 1 : 1.12)
    fx.burst(at.x, at.y, SIDE[mover].main, { count: 10, speed: 340, size: 10, life: 0.4 })
    fx.shake(0.08)

    let boardWon = false
    for (let b = 0; b < 9; b++) {
      const w = next.won[b]
      if (w === null || w === undefined || before[b] !== null) continue
      boardWon = true
      s.wonAt[b] = this.time
      const k = boardCentre(GEO, b)
      fx.ring(k.x, k.y, SIDE[w].light, 240)
      fx.burst(k.x, k.y, SIDE[w].light, { count: 28, speed: 620, size: 13, life: 0.75 })
      fx.sparks(k.x, k.y, C.yellow, 14)
      fx.shake(0.22)
      fx.stop(4)
      this.ctx.audio.play('score', w === 0 ? 1 : 1.12)
      fx.float('Board!', k.x, k.y, SIDE[w].light, 64, w)
    }

    const v = verdict(next)
    if (v) {
      this.end(v)
      return
    }
    if (next.active === -1 && !boardWon) {
      // Sent to a closed board: the rival may play anywhere.
      floatFor(fx, next.turn, 'Free move!')
      this.ctx.audio.play('whoosh', 1.1)
    }
  }

  private end(v: Verdict): void {
    const s = this.s
    const fx = this.ctx.fx
    s.endedAt = this.time
    if (v.line) s.line = v.line
    const [a, b] = v.boards
    const note = v.line
      ? 'Three boards in a row'
      : v.winner === 'draw'
        ? `Boards level, ${a} each`
        : `Most boards, ${Math.max(a, b)} to ${Math.min(a, b)}`
    s.endText = v.line ? 'Three in a row!' : v.winner === 'draw' ? 'Boards level' : 'Most boards!'
    if (v.winner !== 'draw') {
      fx.flash(SIDE[v.winner].main, 0.35)
      fx.shake(0.4)
      fx.stop(8)
      for (const k of v.line ?? []) {
        const c = boardCentre(GEO, k)
        fx.burst(c.x, c.y, C.yellow, { count: 18, speed: 560, size: 12, life: 0.8 })
      }
    }
    this.finish(v.winner, { score: [a, b], note, delay: 2.2 })
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    renderUltimate(g, s, GEO, this.time, !this.over && s.endedAt < 0)
    this.drawTurns(g, undefined, s.endedAt < 0)
    for (const side of [0, 1] as Side[]) {
      let n = 0
      let last = -10
      s.won.forEach((w, b) => {
        if (w !== side) return
        n++
        last = Math.max(last, s.wonAt[b] ?? -10)
      })
      boardTally(g, side, n, side === 0 ? 120 : 880, hudY(g, side), this.time - last)
    }
    if (s.endText) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      notice(g, s.endText, a)
    }
  }
}

export default () => new UltimateTicTacToe()
