import type { MatchSpec, Side } from '../../core/game.ts'
import { banner } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { store, submitRecord } from '../../core/store.ts'
import {
  fmtTime,
  keyAt,
  newRace,
  PuzzleRace,
  type RaceBase,
  toWorld,
} from '../../engines/puzzle/index.ts'
import { nextMove, PACE } from './bot.ts'
import { cellAt, drawHint, drawPanel, drawRoundWins, layout } from './render.ts'
import {
  completedUnits,
  digitCounts,
  generate,
  GIVENS,
  isSolved,
  matchWinner,
  progress,
  roundSeed,
} from './rules.ts'

interface Board {
  cells: number[]
  sel: number
  errCell: number
  errKey: number
  last: number
  lastAt: number
  flash: number[]
  flashAt: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
  botT: [number, number]
  /** Rounds started so far, from 0. Round r is the puzzle made from `roundSeed(seed, r)`. */
  round: number
  /** Round wins, red first. */
  wins: [number, number]
  /** Game time the current round started: its clocks count from here. */
  roundAt: number
  /** Game time the round was decided, or -1 while it runs (the clocks stop). */
  endedAt: number
  /** Game time the next round starts, or -1 while this one runs. */
  nextAt: number
  /** Banner shown between two rounds. */
  roundText: string
  /** Solo only: seconds the puzzles solved so far took, in total. */
  spent: number
}

const PENALTY = 10
/** Seconds the result of a round stays up before the next puzzle appears. */
const BETWEEN = 2.4
/** Seconds a round may last before it is called on progress (the whole match is not capped). */
const ROUND_CAP = 20 * 60

/** Match length: first to N round wins, each round a new puzzle (1 = one puzzle). */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

class Sudoku extends PuzzleRace<State> {
  protected recordId = 'sudoku'
  // Each round has its own clock (see step): the engine's match-wide cap stays off.
  protected override cap: number | null = null
  // Derived from the seed on both phones: never sent over the wire.
  private puzzle: number[] = []
  private solution: number[] = []
  /** The round whose puzzle is loaded in `puzzle` and `solution`. */
  private loaded = -1

  /** Round wins that take the match. */
  private get goal(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    this.loadRound(0)
    return {
      race: newRace(),
      boards: this.freshBoards(),
      botT: [0, 0],
      round: 0,
      wins: [0, 0],
      roundAt: 0,
      endedAt: -1,
      nextAt: -1,
      roundText: '',
      spent: 0,
    }
  }

  private loadRound(r: number): void {
    const p = generate(roundSeed(this.ctx.seed, r), GIVENS[this.ctx.difficulty])
    this.puzzle = p.puzzle
    this.solution = p.solution
    this.loaded = r
  }

  private freshBoards(): [Board, Board] {
    const board = (): Board => ({
      cells: this.puzzle.slice(),
      sel: -1,
      errCell: -1,
      errKey: -1,
      last: -1,
      lastAt: -1,
      flash: [],
      flashAt: -10,
    })
    return [board(), board()]
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest gets the round number in the snapshot and rebuilds the same puzzle.
    if (this.s.round !== this.loaded) this.loadRound(this.s.round)
  }

  /** Seconds on a side's clock for the current puzzle, penalties included. */
  override elapsed(side: Side): number {
    const s = this.s
    const r = s.race[side]
    return (r.done ?? (s.endedAt >= 0 ? s.endedAt : this.time)) - s.roundAt + r.penalty
  }

  protected progressOf(side: Side): number {
    return progress(this.s.boards[side].cells, this.puzzle)
  }

  protected override step(dt: number): void {
    const s = this.s
    if (s.nextAt >= 0) {
      if (this.time >= s.nextAt) this.startRound()
      return
    }
    super.step(dt)
    if (this.over || s.nextAt >= 0) return
    if (this.time - s.roundAt >= ROUND_CAP) this.timeUp()
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    if (this.s.nextAt >= 0) return
    const b = this.s.boards[side]
    if (this.isBot(side)) {
      this.s.botT[side] += dt
      if (this.s.botT[side] >= PACE[this.ctx.difficulty]) {
        this.s.botT[side] = 0
        const m = nextMove(b.cells, this.solution, this.ctx.difficulty, this.ctx.rng)
        if (m) {
          b.sel = m.cell
          this.enter(side, m.digit)
        }
      }
      return
    }
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    for (const t of taps) {
      const k = keyAt(l.keys, t.x, t.y)
      if (k >= 0) {
        this.enter(side, k + 1)
        continue
      }
      const i = cellAt(l, t.x, t.y)
      if (i >= 0) {
        b.sel = i
        this.ctx.audio.play('tick')
      }
    }
  }

  private enter(side: Side, d: number): void {
    const b = this.s.boards[side]
    const i = b.sel
    if (i < 0 || b.cells[i] !== 0) {
      this.ctx.audio.play('click')
      return
    }
    if (this.solution[i] !== d) {
      b.errCell = i
      b.errKey = d - 1
      this.penalize(side, PENALTY)
      return
    }
    b.cells[i] = d
    b.last = i
    b.lastAt = this.time
    this.ctx.audio.play('place', 0.9 + d * 0.04)
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    const at = toWorld(f, l.x0 + (i % 9) * l.c + l.c / 2, l.y0 + Math.floor(i / 9) * l.c + l.c / 2)
    this.ctx.fx.burst(at.x, at.y, SIDE[side].main, { count: 6, speed: 220, size: 8, life: 0.35 })
    const units = completedUnits(b.cells, i)
    if (units.length) {
      b.flash = units.flat()
      b.flashAt = this.time
      this.ctx.audio.play('score', 1 + units.length * 0.1)
    }
    if (isSolved(b.cells, this.solution)) this.complete(side)
  }

  /** A side solved the puzzle first: it takes the round. */
  protected override complete(side: Side): void {
    const r = this.s.race[side]
    if (r.done !== null || this.over || this.s.nextAt >= 0) return
    r.done = this.time
    r.progress = 1
    this.ctx.audio.play('coin')
    this.endRound(side, `Solved in ${fmtTime(this.elapsed(side))}`)
  }

  /** Round clock ran out: the side further along takes the round (a tie is replayed). */
  private timeUp(): void {
    const s = this.s
    if (this.solo) {
      s.endedAt = this.time
      this.finish(0, { note: 'Out of time' })
      return
    }
    const [a, b] = s.race
    this.endRound(a.progress === b.progress ? 'draw' : a.progress > b.progress ? 0 : 1, 'Time up')
  }

  /**
   * The round is decided: `winner` takes it (a draw takes nobody). The match ends
   * once someone has `goal` round wins; otherwise the next puzzle follows.
   */
  private endRound(winner: Side | 'draw', note: string): void {
    const s = this.s
    s.endedAt = this.time
    if (winner !== 'draw') {
      s.wins[winner]++
      if (this.solo) s.spent += this.elapsed(winner)
    }
    const won = matchWinner(s.wins, this.goal)
    if (won !== null) {
      this.conclude(won, note)
      return
    }
    s.nextAt = this.time + BETWEEN
    s.roundText =
      winner === 'draw'
        ? 'Draw round'
        : this.solo
          ? note
          : `${this.ctx.names[winner]} takes the round`
    this.ctx.audio.play(winner === 'draw' ? 'draw' : 'score')
  }

  /** The match is decided. Solo records the total time of its puzzles. */
  private conclude(winner: Side, note: string): void {
    const s = this.s
    if (this.solo) {
      this.finish(winner, { note: this.soloRecord(s.spent), delay: 1.2 })
      return
    }
    const o: { note: string; delay: number; score?: [number, number] } = { note, delay: 1.2 }
    if (this.goal > 1) o.score = [s.wins[0], s.wins[1]]
    this.finish(winner, o)
  }

  private soloRecord(total: number): string {
    const prev = store.records[this.recordId]
    const best = submitRecord(this.recordId, Math.round(total * 10) / 10, true)
    return best
      ? `New record: ${fmtTime(total)}`
      : `Time ${fmtTime(total)} · best ${fmtTime(prev ?? total)}`
  }

  private startRound(): void {
    const s = this.s
    s.round++
    this.loadRound(s.round)
    s.boards = this.freshBoards()
    s.botT = [0, 0]
    s.race = newRace()
    s.roundAt = this.time
    s.endedAt = -1
    s.nextAt = -1
    s.roundText = ''
    this.ctx.audio.play('go')
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    drawPanel(g, layout(w, h), {
      side,
      puzzle: this.puzzle,
      cells: b.cells,
      sel: b.sel,
      errCell: b.errCell,
      errKey: b.errKey,
      errAt: this.s.race[side].errAt,
      last: b.last,
      lastAt: b.lastAt,
      flash: b.flash,
      flashAt: b.flashAt,
      counts: digitCounts(b.cells),
      now: this.time,
    })
    if (this.goal > 1) drawRoundWins(g, side, w, h, this.s.wins[side], this.goal)
    if (b.sel < 0 && this.time < 6 && !this.isBot(side)) drawHint(g, layout(w, h))
  }

  override render(g: Draw): void {
    super.render(g)
    const s = this.s
    if (s.nextAt >= 0 && !this.over) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      banner(g, undefined, s.roundText, MID, { size: 58, alpha: a })
    }
  }
}

export default () => new Sudoku()
