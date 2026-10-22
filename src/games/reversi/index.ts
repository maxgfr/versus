import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { prog } from '../../core/fx/ease.ts'
import { banner, hudY, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { cellAt, cellCenter, geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { discCount, FLIP, renderBoard, shareBar, shown } from './render.ts'
import { type Cell, ending, flipsAt, legalMoves, N, nextTurn, play, startBoard } from './rules.ts'

export interface State {
  /** Side to move in the current round. */
  turn: Side
  cells: Cell[]
  /** Game time each disc was placed, per square, or -1. */
  placedAt: number[]
  /** Game time each disc starts turning over, per square, or -1. */
  flipAt: number[]
  /** Squares still to turn over, in the order they turn. */
  queue: number[]
  /** Square of the last disc placed, or -1. */
  last: number
  /** Game time the board is settled and the next move may start. */
  readyAt: number
  /** Game time of the last 'No move — pass' notice, or -1. */
  passAt: number
  /** Game time the game ended, or -1 while playing. */
  endedAt: number
  /** Game time the settled board was judged (the ending wave), or -1. */
  doneAt: number
  /** Winner once judged: 0, 1, or -1 for a draw / not yet. */
  winner: number
  /** Side that last had to pass, or -1. */
  passer: number
  /** Round wins, red first. */
  wins: [number, number]
  /** The side that opened the current round. Alternates every round. */
  starter: Side
  /** Between rounds: "Blue takes the round" or "Draw round", shown after the count. */
  roundText: string
  /** Game time the next round starts, or -1. */
  resetAt: number
}

/**
 * How long a match lasts: first to N round wins (one game is one round). The
 * default is a single game, the classic match.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** Seconds from the judged board to the next round, once a round is decided and the match goes on. */
const ROUND_TIME = 3.2

/**
 * A notice both players can read: in local 2P one copy sits near each edge,
 * upright for its player, clear of the board. On one screen it sits near the
 * bottom edge.
 */
function notice(g: Draw, text: string, alpha: number, color?: string): void {
  const o = { size: 58, alpha, color }
  if (g.flipTop) banner(g, undefined, text, MID, { ...o, gap: 610 })
  else banner(g, 0, text, MID + 610, o)
}

const GEO = geom(N, N, 780, 780, MID)

class Reversi extends TurnGame<State> {
  // Cosmetic only: how many flips the current move started with, for the rising chain pitch.
  private chain = 0

  private get target(): number {
    return this.ctx.target || match.default
  }

  /** The flips already make the board read as busy: the computer answers briskly. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.5 : d === 'normal' ? 0.4 : 0.2) + this.ctx.rng.range(0, 0.25)
  }

  protected setup(): State {
    return {
      turn: 0,
      cells: startBoard(),
      placedAt: Array<number>(N * N).fill(-1),
      flipAt: Array<number>(N * N).fill(-1),
      queue: [],
      last: -1,
      readyAt: 0,
      passAt: -1,
      endedAt: -1,
      doneAt: -1,
      winner: -1,
      passer: -1,
      wins: [0, 0],
      starter: 0,
      roundText: '',
      resetAt: -1,
    }
  }

  protected override busy(): boolean {
    return this.time < this.s.readyAt || this.s.endedAt >= 0
  }

  /** The next round: a fresh board, and the other side opens it. */
  private nextRound(): void {
    const s = this.s
    s.starter = other(s.starter)
    s.turn = s.starter
    s.cells = startBoard()
    s.placedAt = Array<number>(N * N).fill(-1)
    s.flipAt = Array<number>(N * N).fill(-1)
    s.queue = []
    s.last = -1
    s.readyAt = this.time + 0.4
    s.passAt = -1
    s.endedAt = -1
    s.doneAt = -1
    s.winner = -1
    s.passer = -1
    s.roundText = ''
    s.resetAt = -1
  }

  protected override step(dt: number): void {
    const s = this.s
    // Each disc turns over as its turn comes up: a click, a spark and the colour swap.
    while (s.queue.length && this.time >= (s.flipAt[s.queue[0] as number] ?? 0)) {
      const i = s.queue.shift() as number
      const { x, y } = cellCenter(GEO, i % N, Math.floor(i / N))
      const col = s.cells[i] as Side
      // Each disc of a chain clicks a little higher: long captures sing.
      const n = Math.max(0, this.chain - s.queue.length - 1)
      this.ctx.audio.play('flip', (col === 0 ? 1 : 1.12) + Math.min(0.6, n * 0.07))
      this.ctx.fx.sparks(x, y, SIDE[col].light, 5 + Math.min(6, n))
    }
    if (s.endedAt >= 0 && s.doneAt < 0 && this.time >= s.readyAt) this.conclude()
    if (s.resetAt >= 0 && this.time >= s.resetAt) this.nextRound()
    super.step(dt)
  }

  /** The board has settled on the last move: a wave across the winner's discs, then the result. */
  private conclude(): void {
    const s = this.s
    const e = ending(s.cells)
    if (!e) return
    const win = e.winner
    s.doneAt = this.time
    s.winner = win === 'draw' ? -1 : win
    this.ctx.fx.shake(0.3)
    this.ctx.fx.stop(6)
    if (win !== 'draw') {
      s.wins[win]++
      this.ctx.fx.flash(SIDE[win].main, 0.3)
      this.ctx.fx.confetti(win)
      this.ctx.fx.ring(GEO.x + GEO.w / 2, GEO.y + GEO.h / 2, C.yellow, 520)
    }
    // A single game ends the match as it always did, draws included.
    const decided = win === 'draw' ? this.target <= 1 : s.wins[win] >= this.target
    if (decided) {
      const score: [number, number] = this.target > 1 ? [s.wins[0], s.wins[1]] : e.counts
      this.finish(win, { score, delay: 2.6 })
      return
    }
    // Draws never count: the round is simply played again.
    s.roundText = win === 'draw' ? 'Draw round' : `${this.ctx.names[win]} takes the round`
    s.resetAt = this.time + ROUND_TIME
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const hit = cellAt(GEO, tap.x, tap.y)
    if (!hit) return
    const i = hit.r * N + hit.c
    if (flipsAt(this.s.cells, i, this.s.turn).length === 0) {
      this.ctx.audio.play('error')
      return
    }
    this.play(i)
  }

  protected botPlay(): Promise<void> | void {
    const r = choose(this.s.cells, this.s.turn, this.ctx.difficulty, this.ctx.rng)
    if (typeof r === 'number') this.botMove(r)
    else return r.then((i) => this.botMove(i))
  }

  private botMove(i: number): void {
    if (this.over || this.s.endedAt >= 0 || !this.isBot(this.s.turn)) return
    const legal = legalMoves(this.s.cells, this.s.turn)
    if (legal.length === 0) return
    this.play(legal.some((m) => m.at === i) ? i : (legal[0] as { at: number }).at)
  }

  /** Place a disc, turn over the rivals it brackets, then hand over (or pass). */
  private play(i: number): void {
    const s = this.s
    const side = s.turn
    const res = play(s.cells, i, side)
    s.cells = res.cells
    s.placedAt[i] = this.time
    s.last = i
    const r0 = Math.floor(i / N)
    const c0 = i % N
    // Flips ripple outwards from the placed disc.
    const order = res.flips
      .map((j) => ({ j, d: Math.max(Math.abs(Math.floor(j / N) - r0), Math.abs((j % N) - c0)) }))
      .sort((a, b) => a.d - b.d)
    let settle = this.time + 0.22
    s.queue = []
    for (const { j, d } of order) {
      const at = this.time + 0.12 + d * 0.1
      s.flipAt[j] = at
      s.queue.push(j)
      settle = Math.max(settle, at + FLIP)
    }
    this.chain = res.flips.length
    const { x, y } = cellCenter(GEO, c0, r0)
    const { fx, audio } = this.ctx
    // Impact scales with the capture: 1 flip is a tap, 8+ is a slam.
    const k = Math.min(1, res.flips.length / 8)
    const corner = (r0 === 0 || r0 === N - 1) && (c0 === 0 || c0 === N - 1)
    audio.play('place', (side === 0 ? 0.95 : 1.07) - k * 0.15)
    fx.burst(x, y, SIDE[side].main, {
      count: Math.round(8 + k * 14),
      speed: 320 + k * 380,
      size: 12,
      life: 0.45,
      colors: [SIDE[side].main, SIDE[side].light],
    })
    fx.ring(x, y, SIDE[side].light, GEO.cell * (0.8 + k * 0.8))
    fx.shake(0.06 + k * 0.26)
    audio.buzz(Math.round(8 + k * 22))
    if (k >= 0.75) fx.stop(3)
    // A big capture deserves a shout; a corner is forever.
    if (corner) {
      fx.float('Corner!', x, y - GEO.cell * 0.6, C.yellow, 64, side)
      fx.sparks(x, y, C.yellow, 16)
      audio.play('powerup', 1.1)
    } else if (res.flips.length >= 5) {
      fx.float(`+${res.flips.length}`, x, y - GEO.cell * 0.6, SIDE[side].light, 70, side)
      audio.play('coin', side === 0 ? 1 : 1.12)
    }

    const e = ending(res.cells)
    if (e) {
      s.endedAt = this.time
      s.readyAt = settle + 0.25
      return
    }
    const nt = nextTurn(res.cells, side)
    if (!nt) return
    s.readyAt = settle
    if (nt.passed) {
      s.turn = side
      s.passAt = settle
      s.passer = side === 0 ? 1 : 0
      s.readyAt = settle + 1.3
      this.ctx.audio.play('buzz')
    } else {
      s.turn = nt.turn
    }
  }

  /** Live disc counts as the board shows them (flips count at their midpoint), and when each last changed. */
  private live(): { n: [number, number]; changed: [number, number] } {
    const s = this.s
    const n: [number, number] = [0, 0]
    const changed: [number, number] = [-1, -1]
    s.cells.forEach((cell, i) => {
      if (cell === null) return
      const col = shown(cell, i, s, this.time)
      n[col]++
      const ft = s.flipAt[i] ?? -1
      const at = Math.max(s.placedAt[i] ?? -1, ft >= 0 ? ft + FLIP / 2 : -1)
      if (at <= this.time && at > changed[col]) changed[col] = at
      // A disc turned away from a side lowers its count too.
      if (ft >= 0 && ft + FLIP / 2 <= this.time) {
        const from = col === 0 ? 1 : 0
        if (ft + FLIP / 2 > changed[from]) changed[from] = ft + FLIP / 2
      }
    })
    return { n, changed }
  }

  render(g: Draw): void {
    const s = this.s
    const idle = s.endedAt < 0 && this.time >= s.readyAt
    // Online, the move hints are for the player to move: only their own phone shows them.
    const mine = g.viewer === null || g.viewer === s.turn
    const hints =
      idle && mine && !this.isBot(s.turn) ? legalMoves(s.cells, s.turn).map((m) => m.at) : []
    const passing =
      s.passAt >= 0 && this.time >= s.passAt && this.time - s.passAt < 1.5 && !this.over
    tableBackdrop(g)
    renderBoard(g, s, GEO, this.time, hints, s.turn)
    const text: [string | undefined, string | undefined] = [undefined, undefined]
    if (passing && s.passer >= 0) text[s.passer as Side] = 'No move'
    this.drawTurns(g, text, idle || passing)
    const { n, changed } = this.live()
    for (const side of [0, 1] as Side[]) {
      const bump = changed[side] >= 0 ? (this.time - changed[side]) / 0.22 : 1
      const theirs = n[side === 0 ? 1 : 0]
      discCount(g, side, n[side], bump, 170, hudY(g, side, 70), n[side] > theirs)
      // One bar per reader: both in local 2P, only this device's side otherwise.
      if (g.flipTop || side === this.ctx.local)
        shareBar(g, side, n[side], theirs, hudY(g, side, 200))
    }
    if (this.target > 1) {
      // Right-hand corner for both players: the disc counts already sit on the left.
      for (const side of [0, 1] as Side[]) {
        pips(g, side, s.wins[side], this.target, { x: W - 150 })
      }
    }
    if (passing) {
      const a = Math.min(1, (this.time - s.passAt) * 5, (1.5 - (this.time - s.passAt)) * 4)
      notice(g, 'No move — pass', a)
    }
    if (s.doneAt >= 0) {
      const since = this.time - s.doneAt
      // The count first, then who took the round, when the match goes on.
      if (s.roundText && since >= 1.9) notice(g, s.roundText, prog(since, 1.9, 2.2), C.yellow)
      else {
        const text =
          s.winner < 0
            ? `Dead even ${n[0]}–${n[1]}`
            : `${this.ctx.names[s.winner as Side]} wins ${Math.max(...n)}–${Math.min(...n)}`
        notice(g, text, Math.min(1, (since - 0.3) * 4), C.yellow)
      }
    }
  }
}

export default () => new Reversi()
