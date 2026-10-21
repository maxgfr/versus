import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { prog } from '../../core/fx/ease.ts'
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
import type { Pos } from './bot.ts'
import { moveTime, renderCheckers, trayY, type Route } from './render.ts'
import {
  apply,
  type Cell,
  colOf,
  HOP,
  hops,
  idx,
  legalMoves,
  type Move,
  outcome,
  owner,
  rowOf,
  start,
} from './rules.ts'

export interface State {
  turn: Side
  board: Cell[]
  /** Moves made so far. */
  ply: number
  /** The selected piece's square, or null. */
  sel: number | null
  /** Squares already tapped on the way of a multi-jump, after `sel`. */
  via: number[]
  /** The last move, for the hops, the jumped pieces' flight and the trail. */
  last: { path: number[]; captured: number[]; taken: Cell[]; piece: Cell; crowned: boolean } | null
  /** Game time the last move started, or -10. */
  movedAt: number
  /** Game time the game was decided, or -1. */
  endedAt: number
  /** Who won once decided, for the celebration. */
  winner: Side | 'draw' | null
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

/** Seconds from the last landing to the next round, once a round is decided and the match goes on. */
const ROUND_TIME = 3.2

// Kept off the pause button's column at the left edge.
const GEO = geom(8, 8, 760, 760, MID)

/**
 * A banner both players can read, laid over each player's captures tray so the
 * final position stays in view (one copy per half in local 2P, else red's).
 */
function shout(g: Draw, text: string, size: number, a: number): void {
  const gap = trayY(GEO, 0) - MID
  if (g.flipTop) banner(g, undefined, text, MID, { size, alpha: a, gap })
  else banner(g, 0, text, MID + gap, { size, alpha: a })
}
const centre = (sq: number) => cellCenter(GEO, colOf(sq), rowOf(sq))

const COMBO = ['', '', 'Double jump!', 'Triple jump!', 'Quadruple!', 'Unstoppable!']

class Checkers extends TurnGame<State> {
  private queue: { at: number; run: () => void }[] = []
  private routeMemo: { key: string; routes: Route[] } | null = null
  private forcedMemo: { ply: number; squares: number[] } | null = null

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return {
      turn: 0,
      board: start(),
      ply: 0,
      sel: null,
      via: [],
      last: null,
      movedAt: -10,
      endedAt: -1,
      winner: null,
      endText: '',
      wins: [0, 0],
      starter: 0,
      roundText: '',
      resetAt: -1,
    }
  }

  /** Blocks taps and the computer while the last move plays out, and between rounds. */
  protected override busy(): boolean {
    return this.s.resetAt >= 0 || this.time < this.s.movedAt + moveTime(this.s.last)
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
    s.board = start()
    s.ply = 0
    s.sel = null
    s.via = []
    s.last = null
    s.movedAt = -10
    s.endedAt = -1
    s.winner = null
    s.endText = ''
    s.roundText = ''
    s.resetAt = -1
    this.routeMemo = null
    this.forcedMemo = null
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
    if (!hit || (hit.r + hit.c) % 2 === 0) {
      // Off the board or on a light square: let go of the piece.
      if (this.s.sel !== null) this.ctx.audio.play('click', 0.8)
      this.deselect()
      return
    }
    this.tapSquare(idx(hit.r, hit.c))
  }

  /**
   * Two taps per move: the piece, then where it goes. A multi-jump can be
   * played landing by landing, or straight to its last landing when that
   * names a single route.
   */
  private tapSquare(sq: number): void {
    const s = this.s
    const moves = legalMoves(s.board, s.turn)
    if (s.sel !== null) {
      const prefix = [s.sel, ...s.via]
      const onRoute = moves.filter((m) => startsWith(m.path, [...prefix, sq]))
      if (onRoute.length) {
        const done = onRoute.find((m) => m.path.length === prefix.length + 1)
        if (done) this.play(done)
        else {
          s.via = [...s.via, sq]
          this.ctx.audio.play('tap', 1.2 + s.via.length * 0.1)
        }
        return
      }
      const ending = moves.filter(
        (m) => startsWith(m.path, prefix) && m.path[m.path.length - 1] === sq,
      )
      if (ending.length === 1 && ending[0]) {
        this.play(ending[0])
        return
      }
      if (sq === s.sel && s.via.length === 0) {
        this.deselect()
        this.ctx.audio.play('click', 0.8)
        return
      }
    }
    if (owner(s.board[sq] ?? 0) === s.turn) {
      if (moves.some((m) => m.path[0] === sq)) {
        s.sel = sq
        s.via = []
        this.ctx.audio.play('tap', 1.1)
      } else {
        // This piece cannot move (or another one must jump): the glowing ones are the choice.
        this.deselect()
        this.ctx.audio.play('error')
        if (moves.some((m) => m.captured.length)) this.ctx.fx.shake(0.06)
      }
      return
    }
    if (s.sel !== null) {
      this.deselect()
      this.ctx.audio.play('click', 0.8)
    }
  }

  private deselect(): void {
    this.s.sel = null
    this.s.via = []
  }

  /** The rest of every legal route from the selected piece and the landings tapped so far. */
  private routes(): Route[] {
    const s = this.s
    if (s.sel === null) return []
    const key = `${s.ply}|${s.sel}|${s.via.join(',')}`
    if (this.routeMemo?.key !== key) {
      const prefix = [s.sel, ...s.via]
      const routes: Route[] = []
      for (const m of legalMoves(s.board, s.turn)) {
        if (!startsWith(m.path, prefix) || m.path.length <= prefix.length) continue
        const jumps = hops(m)
          .slice(prefix.length - 1)
          .flat()
        routes.push({ path: m.path.slice(prefix.length), jumps })
      }
      this.routeMemo = { key, routes }
    }
    return this.routeMemo.routes
  }

  /** Pieces that must jump this turn (they glow). */
  private forced(): number[] {
    const s = this.s
    if (this.forcedMemo?.ply !== s.ply) {
      const out = new Set<number>()
      for (const m of legalMoves(s.board, s.turn)) if (m.captured.length) out.add(m.path[0] ?? 0)
      this.forcedMemo = { ply: s.ply, squares: [...out] }
    }
    return this.forcedMemo.squares
  }

  private play(m: Move): void {
    const s = this.s
    const side = s.turn
    const res = apply(s.board, m)
    const end = m.path[m.path.length - 1] ?? 0
    s.last = {
      path: m.path,
      captured: m.captured,
      taken: m.captured.map((c) => s.board[c] ?? 0),
      piece: s.board[m.path[0] ?? 0] ?? 0,
      crowned: res.crowned,
    }
    s.board = res.board
    s.ply++
    s.turn = other(side)
    s.sel = null
    s.via = []
    s.movedAt = this.time
    const fx = this.ctx.fx
    const audio = this.ctx.audio
    const pitch = side === 0 ? 1 : 1.1
    const jumps = m.captured.length

    audio.play(jumps ? 'whoosh' : 'slide', pitch)
    hops(m).forEach((jumped, i) => {
      const landing = m.path[i + 1] ?? end
      this.later((i + 1) * HOP, () => {
        const p = centre(landing)
        if (jumped.length) {
          for (const sq of jumped) {
            const q = centre(sq)
            fx.burst(q.x, q.y, SIDE[other(side)].main, {
              count: 22,
              speed: 520,
              size: 13,
              life: 0.55,
            })
            fx.burst(q.x, q.y, C.yellow, {
              count: 8,
              speed: 400,
              size: 8,
              life: 0.4,
              kind: 'spark',
            })
            fx.ring(q.x, q.y, SIDE[side].light, 110)
          }
          // Each jump in a chain hits a little harder and higher.
          audio.play('hit', 1 + i * 0.14)
          fx.shake(0.18 + i * 0.08)
          fx.stop(2 + i)
          if (i >= 1) {
            const text = COMBO[Math.min(COMBO.length - 1, i + 1)] ?? ''
            fx.float(text, p.x, p.y + (side === 0 ? -100 : 100), C.yellow, 54, side)
          }
        } else {
          audio.play('place', pitch)
        }
        fx.ring(p.x, p.y, 'rgba(255,255,255,0.45)', 70)
      })
    })
    if (res.crowned) {
      this.later((m.path.length - 1) * HOP + 0.1, () => {
        const p = centre(end)
        audio.play('powerup')
        fx.sparks(p.x, p.y, C.yellow, 24)
        fx.ring(p.x, p.y, SIDE[side].light, 150)
        fx.float('King!', p.x, p.y + (side === 0 ? -110 : 110), C.white, 62, side)
      })
    }

    const v = outcome(res.board, s.turn, s.ply)
    if (!v) return
    s.endedAt = this.time
    s.winner = v.winner
    s.endText =
      v.note === 'No pieces left'
        ? 'Wiped out!'
        : v.note === 'No move left'
          ? 'Blocked in!'
          : v.winner === 'draw'
            ? 'Level at the limit'
            : 'Move limit'
    const arrive = moveTime(s.last)
    const win = v.winner
    // A single game ends the match as it always did, draws included.
    if (win === 'draw' && this.target <= 1) {
      this.finish('draw', { note: v.note, delay: arrive + 2 })
      return
    }
    if (win !== 'draw') {
      s.wins[win]++
      this.later(arrive + 0.1, () => {
        audio.play('score')
        fx.flash(SIDE[win].main, 0.3)
        fx.shake(0.35)
        fx.confetti(win)
      })
    }
    // Draws never count: the round is simply played again.
    if (win === 'draw' || s.wins[win] < this.target) {
      s.roundText = win === 'draw' ? 'Draw round' : `${this.ctx.names[win]} takes the round`
      s.resetAt = this.time + arrive + ROUND_TIME
      return
    }
    const score: [number, number] | undefined = this.target > 1 ? [s.wins[0], s.wins[1]] : undefined
    this.finish(win, { note: v.note, score, delay: arrive + 2.6 })
  }

  protected botPlay(): Promise<void> {
    const s = this.s
    const ply = s.ply
    const seed = this.ctx.rng.int(1, 2 ** 31 - 2)
    const pos: Pos = { board: s.board, turn: s.turn, ply: s.ply }
    return think<Move>('checkers', pos, this.ctx.difficulty, seed).then((m) => {
      if (this.over || this.s.ply !== ply) return
      const legal = legalMoves(this.s.board, this.s.turn)
      const pick = legal.find((x) => samePath(x, m)) ?? legal[0]
      if (pick) this.play(pick)
    })
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    renderCheckers(g, s, GEO, this.time, this.routes(), this.forced(), this.over)
    const live = s.endedAt < 0
    let label: [string | undefined, string | undefined] | undefined
    // Tell the player to move why only some pieces answer: a jump is compulsory.
    if (live && !this.isBot(s.turn) && this.forced().length) {
      label = s.turn === 0 ? ['You must jump!', undefined] : [undefined, 'You must jump!']
    }
    this.drawTurns(g, label, live)
    if (this.target > 1) {
      pips(g, 0, s.wins[0], this.target)
      pips(g, 1, s.wins[1], this.target)
    }
    if (!live) {
      const since = this.time - s.endedAt
      const arrive = moveTime(s.last)
      // A round that decides nothing yet: the ending, then who took the round.
      if (s.roundText && since >= arrive + 1.2) {
        const a = prog(since, arrive + 1.2, arrive + 1.5)
        if (a > 0) shout(g, s.roundText, 58, a)
      } else if (s.endText) {
        const a = prog(since, arrive + 0.2, arrive + 0.5)
        if (a > 0) shout(g, s.endText, 64, a)
      }
    }
  }
}

function startsWith(path: readonly number[], prefix: readonly number[]): boolean {
  return prefix.length <= path.length && prefix.every((sq, i) => path[i] === sq)
}

function samePath(a: Move, b: Move | undefined): boolean {
  return !!b && a.path.length === b.path.length && a.path.every((sq, i) => sq === b.path[i])
}

export default () => new Checkers()
