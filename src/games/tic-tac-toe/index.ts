import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { cellAt, cellCenter, geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { CLEAR_AT, renderBoard } from './render.ts'
import { type Cell, emptyBoard, moves, outcome, place, TARGET, threats } from './rules.ts'

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
  /** Last refused tap (a taken cell) and when, so the mark can shake "no". */
  bad: number
  badAt: number
}

const GEO = geom(3, 3, 780, 780, MID)
/** Round banners sit this far from the midline: between the board and each player's pips. */
const BANNER_GAP = 560

export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class TicTacToe extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: starter,
      cells: emptyBoard(),
      placedAt: Array(9).fill(-10),
      wins: [0, 0],
      starter,
      line: null,
      endedAt: -1,
      roundText: '',
      bad: -1,
      badAt: -10,
    }
  }

  /** A nine-cell board needs no long think: answer briskly so rounds keep their rhythm. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.55 : d === 'normal' ? 0.45 : 0.35) + this.ctx.rng.range(0, 0.25)
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.endedAt < 0) return false
    // Round over: show the line, sweep the board, then the other player starts.
    if (this.time - s.endedAt > CLEAR_AT) {
      s.starter = other(s.starter)
      s.turn = s.starter
      s.cells = emptyBoard()
      s.line = null
      s.endedAt = -1
      s.roundText = ''
      this.ctx.audio.play('whoosh', 1.2)
    }
    return true
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const hit = cellAt(GEO, tap.x, tap.y)
    if (!hit) return
    const i = hit.r * 3 + hit.c
    if (this.s.cells[i] !== null) {
      this.s.bad = i
      this.s.badAt = this.time
      this.ctx.audio.play('error')
      this.ctx.audio.buzz(6)
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
    this.juicePlace(i, side)
    const o = outcome(s.cells)
    if (!o) {
      s.turn = other(side)
      return
    }
    s.endedAt = this.time
    if (o.winner === 'draw') {
      s.roundText = 'Draw round'
      this.juiceDraw()
      return
    }
    s.line = o.line
    s.wins[o.winner]++
    s.roundText = `${this.ctx.names[o.winner]} takes the round`
    const won = s.wins[o.winner] >= this.target
    this.juiceWin(o.winner, o.line, won)
    if (won) this.finish(o.winner, { score: s.wins, delay: 1.7 })
  }

  /** A mark lands: the fuller the board (and the bigger the threat), the harder it lands. */
  private juicePlace(i: number, side: Side): void {
    const { fx, audio } = this.ctx
    const { x, y } = cellCenter(GEO, i % 3, Math.floor(i / 3))
    const filled = 9 - moves(this.s.cells).length
    const threat = threats(this.s.cells, side) > 0
    const k = Math.min(1, filled / 9 + (threat ? 0.35 : 0))
    const col = SIDE[side]
    audio.play('place', (side === 0 ? 0.95 : 1.07) + k * 0.25)
    if (threat) audio.play('tick', 1.3)
    fx.burst(x, y, col.main, {
      count: Math.round(8 + k * 10),
      speed: 320 + k * 260,
      size: 12,
      life: 0.45,
      colors: [col.main, col.light],
    })
    fx.ring(x, y, col.light, GEO.cell * (0.5 + k * 0.2))
    fx.shake(0.08 + k * 0.1)
    audio.buzz(threat ? 14 : 8)
  }

  private juiceWin(side: Side, line: readonly number[], won: boolean): void {
    const { fx, audio } = this.ctx
    const col = SIDE[side]
    audio.play('score')
    audio.buzz(won ? 40 : 25)
    fx.flash(col.main, won ? 0.35 : 0.25)
    fx.shake(won ? 0.55 : 0.35)
    fx.stop(won ? 7 : 4)
    for (const c of line) {
      const { x, y } = cellCenter(GEO, c % 3, Math.floor(c / 3))
      fx.burst(x, y, col.main, {
        count: 14,
        speed: 620,
        size: 14,
        life: 0.8,
        gravity: 500,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(x, y, C.yellow, GEO.cell * 0.75)
    }
    floatFor(fx, side, won ? 'WINNER!' : '+1')
    if (won) fx.confetti(side)
  }

  private juiceDraw(): void {
    const { fx, audio } = this.ctx
    audio.play('draw')
    fx.shake(0.15)
    for (let i = 0; i < 9; i++) {
      const { x, y } = cellCenter(GEO, i % 3, Math.floor(i / 3))
      fx.puff(x, y, 'rgba(255,255,255,0.35)', 4)
    }
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    const live = s.endedAt < 0 && !this.over
    // Online, the glow is a prompt for the player to move: only their own phone shows it.
    const mine = g.viewer === null || g.viewer === s.turn
    const hint = live && mine && !this.isBot(s.turn) ? s.turn : null
    renderBoard(g, s, GEO, this.time, hint)
    this.drawTurns(g, undefined, s.endedAt < 0)
    pips(g, 0, s.wins[0], this.target, { inset: 170 })
    pips(g, 1, s.wins[1], this.target, { inset: 170 })
    if (s.roundText && !this.over) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      // Clear of the board, so the winning line stays in view: one copy per half in local 2P.
      const o = { size: 58, alpha: a }
      if (g.flipTop) banner(g, undefined, s.roundText, MID, { ...o, gap: BANNER_GAP })
      else banner(g, 0, s.roundText, MID + BANNER_GAP, o)
    }
  }
}

export default () => new TicTacToe()
