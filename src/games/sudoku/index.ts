import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { keyAt, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { nextMove, PACE } from './bot.ts'
import { cellAt, drawPanel, layout } from './render.ts'
import { completedUnits, digitCounts, generate, GIVENS, isSolved, progress } from './rules.ts'

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
}

const PENALTY = 10

class Sudoku extends PuzzleRace<State> {
  protected recordId = 'sudoku'
  protected override cap = 20 * 60
  // Derived from the seed on both phones: never sent over the wire.
  private puzzle: number[] = []
  private solution: number[] = []

  protected setup(): State {
    const p = generate(this.ctx.seed, GIVENS[this.ctx.difficulty])
    this.puzzle = p.puzzle
    this.solution = p.solution
    const board = (): Board => ({
      cells: p.puzzle.slice(),
      sel: -1,
      errCell: -1,
      errKey: -1,
      last: -1,
      lastAt: -1,
      flash: [],
      flashAt: -10,
    })
    return { race: newRace(), boards: [board(), board()], botT: [0, 0] }
  }

  protected progressOf(side: Side): number {
    return progress(this.s.boards[side].cells, this.puzzle)
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
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
    if (b.sel < 0 && this.time < 6 && !this.isBot(side)) {
      g.text('Tap a square, then a number', w / 2, h - 4, {
        size: 30,
        weight: 600,
        color: C.white,
        baseline: 'bottom',
      })
    }
  }
}

export default () => new Sudoku()
