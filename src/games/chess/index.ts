import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { prog } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import {
  cellAt,
  cellCenter,
  geom,
  tableBackdrop,
  think,
  TurnGame,
} from '../../engines/board/index.ts'
import { renderChess, SLIDE } from './render.ts'
import {
  boardOf,
  colorOf,
  coordsOf,
  findKing,
  legalMoves,
  play,
  type Pos,
  START_FEN,
  startFen,
  squareAt,
  type Status,
  type Step,
  targetsFrom,
  verdict,
} from './rules.ts'

export interface State {
  /** Side to move in the current round (red is White, side 0). Mirrors the FEN. */
  turn: Side
  fen: string
  /** Moves so far in this round, in SAN. */
  history: string[]
  lastMove: { from: string; to: string } | null
  status: Status
  /** The selected square, e.g. 'e2'. */
  sel: string | null
  /** Game time of the last move: drives the slide, the capture flight and the landing. */
  movedAt: number
  /** The piece the last move took (code like 'bp') and the square it stood on. */
  taken: { code: string; sq: string } | null
  /** Every piece taken so far, as codes like 'bn' (black knight). */
  lost: string[]
  /** Game time the game was decided, or -1. */
  endedAt: number
  /** How it ended, shown as a banner before the result screen. */
  endText: string
  /** Round wins, red first. */
  wins: [number, number]
  /** The side that opened the current round. Alternates every round. */
  starter: Side
  /** Between rounds: "Blue takes the round" or "Draw round", shown after the ending. */
  roundText: string
  /** Game time the next round starts, or -1. */
  resetAt: number
}

/**
 * How long a match lasts: first to N round wins (one game is one round). The
 * default is a single game, the classic match.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** Seconds from the last move to the next round, once a round is decided and the match goes on. */
const ROUND_TIME = SLIDE + 3.4

// Kept off the pause button's column at the left edge.
const GEO = geom(8, 8, 760, 760, MID)

const centre = (sq: string) => {
  const { c, r } = coordsOf(sq)
  return cellCenter(GEO, c, r)
}

class Chess extends TurnGame<State> {
  private targetMemo: { key: string; to: string[] } | null = null
  /** Effects timed to land with the moving piece (host side; the guest gets them as fx). */
  private queue: { at: number; run: () => void }[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      turn: 0,
      fen: START_FEN,
      history: [],
      lastMove: null,
      status: 'playing',
      sel: null,
      movedAt: -10,
      taken: null,
      lost: [],
      endedAt: -1,
      endText: '',
      wins: [0, 0],
      starter: 0,
      roundText: '',
      resetAt: -1,
    }
  }

  /** The current round as the rules see it. */
  private pos(): Pos {
    return { fen: this.s.fen, history: this.s.history, start: startFen(this.s.starter) }
  }

  /** Nothing is accepted while the last move slides across the board, or between rounds. */
  protected override busy(): boolean {
    return this.s.resetAt >= 0 || this.time - this.s.movedAt < SLIDE + 0.08
  }

  protected override animate(): void {
    this.flush()
    if (this.s.resetAt >= 0 && this.time >= this.s.resetAt) this.nextRound()
  }

  /** The next round: a fresh board, and the other side opens it. */
  private nextRound(): void {
    const s = this.s
    s.starter = other(s.starter)
    s.turn = s.starter
    s.fen = startFen(s.starter)
    s.history = []
    s.lastMove = null
    s.status = 'playing'
    s.sel = null
    s.taken = null
    s.lost = []
    s.endedAt = -1
    s.endText = ''
    s.roundText = ''
    s.resetAt = -1
    this.targetMemo = null
  }

  protected override afterEnd(): void {
    this.flush()
  }

  private flush(): void {
    while (this.queue.length && (this.queue[0]?.at ?? Infinity) <= this.time) {
      this.queue.shift()?.run()
    }
  }

  private later(delay: number, run: () => void): void {
    this.queue.push({ at: this.time + delay, run })
    this.queue.sort((a, b) => a.at - b.at)
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const hit = cellAt(GEO, tap.x, tap.y)
    if (!hit) {
      if (this.s.sel) this.ctx.audio.play('click', 0.8)
      this.s.sel = null
      return
    }
    this.tapSquare(squareAt(hit.c, hit.r))
  }

  private tapSquare(sq: string): void {
    const s = this.s
    if (s.sel && targetsFrom(s.fen, s.sel).some((m) => m.to === sq)) {
      this.play(s.sel, sq)
      return
    }
    if (sq === s.sel) {
      s.sel = null
      this.ctx.audio.play('click', 0.8)
      return
    }
    const { c, r } = coordsOf(sq)
    const piece = boardOf(s.fen)[r * 8 + c]
    if (piece && piece.color === colorOf(s.turn)) {
      if (targetsFrom(s.fen, sq).length > 0) {
        s.sel = sq
        this.ctx.audio.play('tap', 1.1)
      } else {
        // Pinned or boxed in: say so.
        s.sel = null
        this.ctx.audio.play('error')
      }
      return
    }
    if (s.sel) {
      s.sel = null
      this.ctx.audio.play('click', 0.8)
    } else if (piece) this.ctx.audio.play('error')
  }

  protected botPlay(): Promise<void> {
    const fen = this.s.fen
    const seed = this.ctx.rng.int(1, 2 ** 31 - 2)
    return think<Step | null>('chess', this.pos(), this.ctx.difficulty, seed).then((m) => {
      if (this.over || this.s.fen !== fen) return
      const step = m ?? legalMoves(fen)[0]
      if (step) this.play(step.from, step.to)
    })
  }

  private play(from: string, to: string): void {
    const s = this.s
    const side = s.turn
    const pl = play(this.pos(), from, to)
    const v = verdict(pl.pos)
    s.fen = pl.pos.fen
    s.history = pl.pos.history
    s.lastMove = { from, to }
    s.sel = null
    s.movedAt = this.time
    s.turn = other(side)
    s.status = v.status
    s.taken =
      pl.captured && pl.capturedAt
        ? { code: `${colorOf(other(side))}${pl.captured}`, sq: pl.capturedAt }
        : null
    if (s.taken) s.lost.push(s.taken.code)

    const fx = this.ctx.fx
    const audio = this.ctx.audio
    const pitch = side === 0 ? 1 : 1.12
    const dest = centre(to)
    audio.play('slide', pitch)
    const taken = s.taken
    const big = taken ? 'qr'.includes(taken.code[1] ?? '') : false
    // Everything below lands with the piece, at the end of its slide.
    this.later(SLIDE, () => {
      if (taken) {
        const at = centre(taken.sq)
        audio.play(big ? 'explode' : 'hit', pitch)
        audio.play('whoosh', 1.2)
        fx.burst(at.x, at.y, SIDE[other(side)].main, { count: 26, speed: 620, size: 14, life: 0.6 })
        fx.burst(at.x, at.y, C.yellow, { count: 12, speed: 460, size: 8, life: 0.4, kind: 'spark' })
        fx.ring(at.x, at.y, SIDE[side].light, 130)
        fx.shake(big ? 0.45 : 0.28)
        fx.stop(big ? 6 : 3)
      } else {
        audio.play('place', pitch)
        fx.ring(dest.x, dest.y, 'rgba(255,255,255,0.45)', 75)
      }
      if (pl.promoted) {
        audio.play('powerup')
        fx.sparks(dest.x, dest.y, C.yellow, 22)
        fx.ring(dest.x, dest.y, C.yellow, 140)
        fx.float('Queen!', dest.x, dest.y + (side === 0 ? -110 : 110), C.yellow, 60, side)
      }
      if (pl.check && v.status !== 'mate') {
        const king = findKing(s.fen, colorOf(other(side)))
        if (king) {
          const k = centre(king)
          fx.ring(k.x, k.y, C.red, 150)
        }
        audio.play('zap')
        fx.shake(0.15)
        floatFor(fx, other(side), 'Check!')
      }
    })

    if (v.winner === undefined) return
    s.endedAt = this.time
    s.endText = v.note ?? ''
    const win = v.winner
    // A single game ends the match as it always did, draws included.
    if (win === 'draw' && this.target <= 1) {
      this.finish('draw', { note: v.note, delay: SLIDE + 2.2 })
      return
    }
    if (v.status === 'mate') s.endText = 'Checkmate!'
    if (win !== 'draw') {
      s.wins[win]++
      // The king topples, then the winners celebrate.
      this.later(SLIDE + 0.45, () => {
        const king = findKing(s.fen, colorOf(other(win)))
        if (king) {
          const k = centre(king)
          fx.burst(k.x, k.y, SIDE[other(win)].main, { count: 30, speed: 500, size: 13, life: 0.7 })
          fx.ring(k.x, k.y, C.white, 200)
        }
        audio.play('thud')
        fx.shake(0.5)
        fx.stop(6)
        fx.flash(SIDE[win].main, 0.3)
      })
      this.later(SLIDE + 0.8, () => {
        audio.play('score')
        fx.confetti(win)
      })
    }
    // Draws never count: the round is simply played again.
    if (win === 'draw' || s.wins[win] < this.target) {
      s.roundText = win === 'draw' ? 'Draw round' : `${this.ctx.names[win]} takes the round`
      s.resetAt = this.time + ROUND_TIME
      return
    }
    const score: [number, number] | undefined = this.target > 1 ? [s.wins[0], s.wins[1]] : undefined
    this.finish(win, { note: v.note, score, delay: SLIDE + 2.8 })
  }

  private targets(): string[] {
    const s = this.s
    if (!s.sel) return []
    const key = `${s.fen}|${s.sel}`
    if (this.targetMemo?.key !== key) {
      this.targetMemo = { key, to: targetsFrom(s.fen, s.sel).map((m) => m.to) }
    }
    return this.targetMemo.to
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    renderChess(g, s, GEO, this.time, this.targets(), this.over)
    let label: [string | undefined, string | undefined] | undefined
    // In check, the pill says so: the player has to answer it.
    if (s.status === 'check' && s.endedAt < 0 && !this.isBot(s.turn)) {
      label = s.turn === 0 ? ['Check!', undefined] : [undefined, 'Check!']
    }
    this.drawTurns(g, label, s.endedAt < 0)
    if (this.target > 1) {
      pips(g, 0, s.wins[0], this.target)
      pips(g, 1, s.wins[1], this.target)
    }
    if (s.endedAt >= 0) {
      const t = this.time - s.endedAt
      // A round that decides nothing yet: the ending, then who took the round.
      if (s.roundText && t >= SLIDE + 1.9) {
        const a = prog(t, SLIDE + 1.9, SLIDE + 2.2)
        if (a > 0) banner(g, undefined, s.roundText, MID, { size: 58, alpha: a })
      } else if (s.endText) {
        const a = prog(t, SLIDE + 0.5, SLIDE + 0.8)
        if (a > 0) banner(g, undefined, s.endText, MID, { size: 64, alpha: a })
      }
    }
  }
}

export default () => new Chess()
