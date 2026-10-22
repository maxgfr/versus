import { floatFor } from '../../core/fx/fx.ts'
import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { hudY, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { cellAt, geom, tableBackdrop, think, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { boardCentre, boardTally, cellCentre, notice, renderUltimate } from './render.ts'
import {
  type Cell,
  emptyPosition,
  isLegal,
  legalMoves,
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
  /** Big-board line that won the round, or null. */
  line: number[] | null
  /** Game time the round was decided, or -1 while playing. */
  endedAt: number
  /** What decided the round, shown before the next one or the result screen. */
  endText: string
  /** Rounds won so far by each side. */
  wins: [number, number]
  /** Who opened the current round. The other player opens the next one. */
  starter: Side
  /** Rounds started, counting the current one. */
  round: number
  /** Game time the current round began. */
  roundAt: number
}

/** Seconds a finished round stays on the board before the next one is set out. */
const ROUND_PAUSE = 2.4

/**
 * One round is one big board. The match is first to `target` round wins; the
 * default of one round is a single game, exactly as before.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/**
 * The whole big board: nine small boards, 9 × 9 cells, centred on the table and
 * clear of the pause button on the left edge.
 */
const GEO = geom(9, 9, 780, 780, MID)

class UltimateTicTacToe extends TurnGame<State> {
  /** Round wins that decide the match, as chosen on the ready screen. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    const p = emptyPosition(starter)
    return {
      turn: starter,
      cells: p.cells,
      won: p.won,
      active: p.active,
      placedAt: Array<number>(81).fill(0),
      wonAt: Array<number>(9).fill(-1),
      last: -1,
      line: null,
      endedAt: -1,
      endText: '',
      wins: [0, 0],
      starter,
      round: 1,
      roundAt: 0,
    }
  }

  private pos(): Position {
    const s = this.s
    return { turn: s.turn, cells: s.cells, won: s.won, active: s.active }
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.endedAt < 0) return false
    if (this.over) return true
    // Round over: show how it ended, then set out a fresh board for the other player to open.
    if (this.time - s.endedAt > ROUND_PAUSE) this.nextRound()
    return true
  }

  private nextRound(): void {
    const s = this.s
    const p = emptyPosition(other(s.starter))
    s.starter = p.turn
    s.turn = p.turn
    s.cells = p.cells
    s.won = p.won
    s.active = p.active
    s.placedAt = Array<number>(81).fill(0)
    s.wonAt = Array<number>(9).fill(-1)
    s.last = -1
    s.line = null
    s.endedAt = -1
    s.endText = ''
    s.round++
    s.roundAt = this.time
    this.ctx.audio.play('go')
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

  /** Quick answers on easy and normal; hard thinks off the main thread. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.55 : d === 'normal' ? 0.45 : 0.2) + this.ctx.rng.range(0, 0.25)
  }

  protected botPlay(): void | Promise<void> {
    if (this.ctx.difficulty !== 'hard') {
      this.play(choose(this.pos(), this.ctx.difficulty, this.ctx.rng))
      return
    }
    const seed = this.ctx.rng.int(0, 2 ** 30)
    const turn = this.s.turn
    const round = this.s.round
    return think<number | null>('ultimate-tic-tac-toe', this.pos(), 'hard', seed).then((m) => {
      const s = this.s
      // The world may have moved on while the worker thought (restore, round over).
      if (this.over || s.endedAt >= 0 || s.turn !== turn || s.round !== round) return
      const p = this.pos()
      this.play(m !== null && isLegal(p, m) ? m : (legalMoves(p)[0] as number))
    })
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
    // The fuller the small board, the higher and harder the mark lands.
    const b0 = Math.floor(m / 9)
    let filled = 0
    for (let i = 0; i < 9; i++) if (next.cells[b0 * 9 + i] !== null) filled++
    const k = filled / 9
    this.ctx.audio.play('place', (mover === 0 ? 0.95 : 1.07) + k * 0.3)
    fx.burst(at.x, at.y, SIDE[mover].main, {
      count: Math.round(6 + k * 8),
      speed: 280 + k * 200,
      size: 10,
      life: 0.4,
      colors: [SIDE[mover].main, SIDE[mover].light],
    })
    fx.shake(0.05 + k * 0.08)
    this.ctx.audio.buzz(6)

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
      this.ctx.audio.buzz(18)
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
      s.wins[v.winner]++
      fx.flash(SIDE[v.winner].main, 0.35)
      fx.shake(0.4)
      fx.stop(8)
      this.ctx.audio.buzz(40)
      const col = SIDE[v.winner]
      for (const k of v.line ?? []) {
        const c = boardCentre(GEO, k)
        fx.burst(c.x, c.y, col.main, {
          count: 22,
          speed: 680,
          size: 14,
          life: 0.9,
          colors: [col.main, col.light, C.yellow, C.white],
          kind: 'square',
        })
        fx.ring(c.x, c.y, C.yellow, 260)
      }
      if (s.wins[v.winner] >= this.target) fx.confetti(v.winner)
    } else {
      this.ctx.audio.play('draw')
      fx.shake(0.15)
    }
    if (v.winner === 'draw' || s.wins[v.winner] < this.target) {
      // Not the match yet: the round is shown, then the next board is set out. Draws score nothing.
      if (v.winner !== 'draw') s.endText = `${this.ctx.names[v.winner]} takes the round`
      return
    }
    // A single round keeps the board count on the result screen; a match shows its round wins.
    const score: [number, number] = this.target > 1 ? s.wins : [a, b]
    this.finish(v.winner, { score, note, delay: 2.2 })
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
      // Round wins sit in the same corner as the side's board count (a single round shows none).
      if (this.target > 1) {
        pips(g, side, s.wins[side], this.target, { x: side === 0 ? 120 : 880, inset: 170 })
      }
    }
    if (s.endText) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      notice(g, s.endText, a)
    }
    const since = this.time - s.roundAt
    if (s.round > 1 && since < 1.3 && s.endedAt < 0) {
      const a = Math.min(1, since * 6, (1.3 - since) * 4)
      notice(g, `Round ${s.round} · ${this.ctx.names[s.starter]} starts`, a)
    }
  }
}

export default () => new UltimateTicTacToe()
