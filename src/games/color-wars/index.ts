import { type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import { hudY, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { cellAt, cellCenter, geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { cellCount, FLIGHT, hint, notice, renderBoard } from './render.ts'
import {
  apply,
  burst,
  BURST,
  CELLS,
  cellsOf,
  emptyPosition,
  legalCells,
  type Position,
  SIZE,
  unstable,
  winner,
} from './rules.ts'

export interface State {
  turn: Side
  owner: (Side | null)[]
  dots: number[]
  moved: [boolean, boolean]
  /** Cells that burst on the next wave. Empty when the board is stable. */
  pending: number[]
  /** Game time of the next wave. */
  waveAt: number
  /** Waves so far in the current chain, for the pitch of each burst. */
  chain: number
  /** Moves made so far, for the stalemate guard. */
  turns: number
  /** Game time each cell last changed, for the pop. */
  stampAt: number[]
  /** Game time each cell was converted, and its colour before (-1 empty), for the flip. */
  flipAt: number[]
  flipFrom: number[]
  /** The last wave: cells that burst, their side, and when (dots fly to the neighbours). */
  burstCells: number[]
  burstSides: number[]
  burstAt: number
  /** Game time the round was decided, -1 while playing. */
  endedAt: number
  winner: Side | 'draw' | null
  /** Rounds won so far by each side. */
  wins: [number, number]
  /** Who opened the current round. The other player opens the next one. */
  starter: Side
  /** Rounds started, counting the current one. */
  round: number
  /** Game time the current round began. */
  roundAt: number
}

const GEO = geom(SIZE, SIZE, 780, 780, MID)
/** Seconds between waves of a chain reaction. */
const WAVE = 0.15
/** Seconds between a move and the first wave it causes. */
const FIRST = 0.22
/** Guard against endless stalemates: past this many moves the cells decide. */
const TURN_CAP = 300
/** Seconds a decided round stays on the board before the next one is set out. */
const ROUND_PAUSE = 2.6

/**
 * One round is one board. The match is first to `target` round wins; the
 * default of one round is a single game, exactly as before.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

const centre = (i: number) => cellCenter(GEO, i % SIZE, Math.floor(i / SIZE))

class ColorWars extends TurnGame<State> {
  /** Round wins that decide the match, as chosen on the ready screen. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: starter,
      owner: Array<Side | null>(CELLS).fill(null),
      dots: Array<number>(CELLS).fill(0),
      moved: [false, false],
      pending: [],
      waveAt: 0,
      chain: 0,
      turns: 0,
      stampAt: Array<number>(CELLS).fill(-10),
      flipAt: Array<number>(CELLS).fill(-10),
      flipFrom: Array<number>(CELLS).fill(-1),
      burstCells: [],
      burstSides: [],
      burstAt: -10,
      endedAt: -1,
      winner: null,
      wins: [0, 0],
      starter,
      round: 1,
      roundAt: 0,
    }
  }

  private pos(): Position {
    const s = this.s
    return { turn: s.turn, owner: s.owner, dots: s.dots, moved: s.moved }
  }

  private store(p: Position): void {
    const s = this.s
    s.turn = p.turn
    s.owner = p.owner
    s.dots = p.dots
    s.moved = p.moved
  }

  /** A chain reaction plays out one wave at a time before anyone may tap. */
  protected override step(dt: number): void {
    if (this.s.endedAt >= 0) {
      if (!this.over && this.time - this.s.endedAt >= ROUND_PAUSE) this.nextRound()
      return
    }
    if (this.s.pending.length > 0) {
      if (this.time >= this.s.waveAt) this.wave()
      return
    }
    super.step(dt)
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const hit = cellAt(GEO, tap.x, tap.y)
    if (!hit) return
    const cell = hit.r * SIZE + hit.c
    if (!legalCells(this.pos()).includes(cell)) {
      this.ctx.audio.play('error')
      return
    }
    this.play(cell)
  }

  protected botPlay(): void {
    this.play(choose(this.pos(), this.s.turn, this.ctx.difficulty, this.ctx.rng))
  }

  private play(cell: number): void {
    const s = this.s
    const fx = this.ctx.fx
    const side = s.turn
    const first = !s.moved[side]
    this.store(apply(this.pos(), cell))
    s.chain = 0
    s.turns++
    s.stampAt[cell] = this.time
    if (first) {
      s.flipAt[cell] = this.time
      s.flipFrom[cell] = -1
    }
    const c = centre(cell)
    this.ctx.audio.play(first ? 'place' : 'click', side === 0 ? 1 : 1.12)
    fx.burst(c.x, c.y, SIDE[side].light, {
      count: first ? 16 : 8,
      speed: 320,
      size: 11,
      life: 0.4,
    })
    fx.shake(first ? 0.12 : 0.06)
    s.pending = unstable(this.pos())
    s.waveAt = this.time + FIRST
    if (s.pending.length === 0 && s.turns >= TURN_CAP) this.end(this.byCells())
  }

  /** One wave: every cell at four dots bursts together, then the next wave is queued. */
  private wave(): void {
    const s = this.s
    const fx = this.ctx.fx
    const before = this.pos()
    const next = burst(before, s.pending)
    const land = this.time + FLIGHT * 0.7

    s.burstCells = []
    s.burstSides = []
    s.burstAt = this.time
    let mover: Side = 0
    for (const c of s.pending) {
      const side = before.owner[c] ?? null
      if (side === null || (before.dots[c] ?? 0) < BURST) continue
      mover = side
      s.burstCells.push(c)
      s.burstSides.push(side)
      const at = centre(c)
      fx.burst(at.x, at.y, SIDE[side].light, { count: 18, speed: 520, size: 12, life: 0.55 })
      fx.burst(at.x, at.y, C.white, { count: 6, speed: 300, size: 8, life: 0.35 })
      fx.ring(at.x, at.y, SIDE[side].light, 150)
    }
    for (let i = 0; i < CELLS; i++) {
      const was = before.owner[i] ?? null
      const now = next.owner[i] ?? null
      if (now !== null && was !== now) {
        s.flipAt[i] = land
        s.flipFrom[i] = was === null ? -1 : was
      }
      if (next.dots[i] !== before.dots[i] || now !== was) {
        s.stampAt[i] = now === null ? this.time : land
      }
    }
    this.ctx.audio.play('pop', 0.85 + Math.min(s.chain, 12) * 0.07)
    if (s.chain >= 2) this.ctx.audio.play('zap', 0.8 + Math.min(s.chain, 10) * 0.05)
    fx.shake(Math.min(0.35, 0.1 + s.chain * 0.03))
    if (s.burstCells.length > 1 || s.chain > 0) fx.stop(2)
    this.store(next)

    const w = winner(next)
    if (w !== null) {
      this.end(w)
      return
    }
    s.pending = unstable(next)
    if (s.pending.length > 0) {
      s.chain++
      if (s.chain === 3 || s.chain === 6 || s.chain === 10) {
        fx.float(
          `Chain ×${s.chain}!`,
          W / 2,
          mover === 0 ? MID + 520 : MID - 520,
          SIDE[mover].light,
          64,
          mover,
        )
      }
      s.waveAt = this.time + WAVE
      return
    }
    if (s.turns >= TURN_CAP) this.end(this.byCells())
  }

  /** A clean board for the next round; the player who did not open the last one starts. */
  private nextRound(): void {
    const s = this.s
    const starter = other(s.starter)
    const p = emptyPosition(starter)
    s.starter = starter
    s.turn = starter
    s.owner = p.owner
    s.dots = p.dots
    s.moved = p.moved
    s.pending = []
    s.waveAt = 0
    s.chain = 0
    s.turns = 0
    s.stampAt = Array<number>(CELLS).fill(-10)
    s.flipAt = Array<number>(CELLS).fill(-10)
    s.flipFrom = Array<number>(CELLS).fill(-1)
    s.burstCells = []
    s.burstSides = []
    s.burstAt = -10
    s.endedAt = -1
    s.winner = null
    s.round++
    s.roundAt = this.time
    this.ctx.audio.play('go')
  }

  /** Who holds more cells: used by the stalemate guard. */
  private byCells(): Side | 'draw' {
    const a = cellsOf(this.pos(), 0)
    const b = cellsOf(this.pos(), 1)
    return a === b ? 'draw' : a > b ? 0 : 1
  }

  private end(w: Side | 'draw'): void {
    const s = this.s
    const fx = this.ctx.fx
    s.pending = []
    s.endedAt = this.time
    s.winner = w
    if (w !== 'draw') {
      s.wins[w]++
      this.ctx.audio.play('explode', 0.9)
      fx.flash(SIDE[w].main, 0.35)
      fx.shake(0.45)
      fx.stop(8)
      for (let i = 0; i < CELLS; i++) {
        if (s.owner[i] !== w) continue
        const c = centre(i)
        fx.burst(c.x, c.y, SIDE[w].light, { count: 6, speed: 380, size: 10, life: 0.7 })
      }
    }
    // Stalemates score nothing. A round that does not decide the match is shown, then the next one starts.
    if (w === 'draw' || s.wins[w] < this.target) return
    // A single round keeps the cell count on the result screen; a match shows its round wins.
    const score: [number, number] =
      this.target > 1 ? s.wins : [cellsOf(this.pos(), 0), cellsOf(this.pos(), 1)]
    this.finish(w, { score, delay: 2 })
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    const live = !this.over && s.endedAt < 0 && s.pending.length === 0 && !this.isBot(s.turn)
    renderBoard(g, s, GEO, this.time, live)
    this.drawTurns(g, undefined, s.endedAt < 0 && s.pending.length === 0)
    const counts = [cellsOf(this.pos(), 0), cellsOf(this.pos(), 1)]
    for (const side of [0, 1] as Side[]) {
      const n = counts[side] ?? 0
      cellCount(g, side, n, side === 0 ? 130 : 870, hudY(g, side), n > (counts[other(side)] ?? 0))
    }
    // Round wins sit in the same corner as the cell count; a single round shows none.
    if (this.target > 1) {
      for (const side of [0, 1] as Side[]) {
        pips(g, side, s.wins[side], this.target, { x: side === 0 ? 130 : 870, inset: 170 })
      }
    }
    if (live && !s.moved[s.turn]) {
      hint(g, s.turn, 'Tap any cell to claim it', 0.6 + 0.4 * Math.sin(this.time * 4))
    }
    if (s.endedAt >= 0) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      const loser = s.winner === 'draw' || s.winner === null ? null : other(s.winner)
      const text =
        loser === null
          ? 'Stalemate'
          : cellsOf(this.pos(), loser) === 0
            ? `${this.ctx.names[loser]} wiped out!`
            : 'Most cells!'
      notice(g, text, a)
    }
    const since = this.time - s.roundAt
    if (s.round > 1 && since < 1.3 && s.endedAt < 0) {
      const a = Math.min(1, since * 6, (1.3 - since) * 4)
      notice(g, `Round ${s.round} · ${this.ctx.names[s.starter]} starts`, a)
    }
  }
}

export default () => new ColorWars()
