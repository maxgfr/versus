import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { botTap, PACE } from './bot.ts'
import { store } from '../../core/store.ts'
import { cellAt, cellCentre, chip, drawBoard, layout, tileColor } from './render.ts'
import { CELLS, distance, isSolved, progress, scramble, SIZE, slide, solvePlan } from './rules.ts'

export interface Board {
  tiles: number[]
  /** Where each tile came from on its last slide (its own cell if it did not move). */
  from: number[]
  movedAt: number
  moves: number
  /** Cells of a row / column that just fell into place (they glow), and when. */
  glow: number[]
  glowAt: number
  /** Bit mask of the rows / columns (see LINES) that have already been cheered. */
  cheered: number
  /** The tile tapped for nothing (it shakes), and when. */
  nope: number
  nopeAt: number
  /** The computer's queue of taps (empty for people). */
  plan: number[]
  botT: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
}

/** Five minutes: then the most progress wins. */
const CAP = 300

/** The rows and columns of the board, as cell lists. */
const LINES: number[][] = [
  ...Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => r * SIZE + c)),
  ...Array.from({ length: SIZE }, (_, c) => Array.from({ length: SIZE }, (_, r) => r * SIZE + c)),
]

/** Is every cell of a line holding its own tile (the last cell holds the gap)? */
const lineDone = (tiles: readonly number[], line: readonly number[]): boolean =>
  line.every((i) => tiles[i] === (i + 1) % CELLS)

class SlidingPuzzle extends PuzzleRace<State> {
  protected recordId = 'sliding-puzzle'
  protected override cap = CAP
  /** Tile distance of the shared scramble: progress is measured against it. */
  private start = 1

  protected setup(): State {
    const sc = scramble(new Rng(this.ctx.seed))
    this.start = Math.max(1, distance(sc.tiles))
    const plan = solvePlan(sc.path)
    const board = (): Board => ({
      tiles: sc.tiles.slice(),
      from: sc.tiles.map((_, i) => i),
      movedAt: -10,
      moves: 0,
      glow: [],
      glowAt: -10,
      cheered: 0,
      nope: -1,
      nopeAt: -10,
      plan: plan.slice(),
      botT: 0,
    })
    return { race: newRace(), boards: [board(), board()] }
  }

  protected progressOf(side: Side): number {
    return progress(this.s.boards[side].tiles, this.start)
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    const f = this.frames[side]
    if (this.isBot(side)) {
      b.botT += dt
      if (b.botT < PACE[this.ctx.difficulty]) return
      b.botT = 0
      const m = botTap(b.tiles, b.plan, this.ctx.difficulty, this.ctx.rng)
      if (!m) return
      b.plan = m.plan
      this.move(side, m.cell)
      return
    }
    const l = layout(f.w, f.h)
    for (const t of taps) {
      const i = cellAt(l, t.x, t.y)
      if (i >= 0) this.move(side, i)
    }
  }

  /** Slide the tiles for a tap on `cell`, with the sound and sparks for any tile that lands home. */
  private move(side: Side, cell: number): void {
    if (this.over) return
    const b = this.s.boards[side]
    const r = slide(b.tiles, cell)
    if (!r) {
      if (b.tiles[cell] !== 0) {
        b.nope = cell
        b.nopeAt = this.time
      }
      this.ctx.audio.play('tick', 0.8)
      return
    }
    const before = b.tiles
    b.tiles = r.tiles
    b.from = r.from
    b.movedAt = this.time
    b.moves++
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    let homed = 0
    for (let i = 0; i < CELLS; i++) {
      if (r.from[i] === i || b.tiles[i] !== i + 1) continue
      homed++
      const p = cellCentre(l, i)
      const at = toWorld(f, p.x, p.y)
      this.ctx.fx.burst(at.x, at.y, tileColor(side, i + 1), {
        count: 10,
        speed: 280,
        size: 9,
        life: 0.4,
      })
    }
    const slid = r.from.filter((v, i) => v !== i).length
    if (homed) this.ctx.audio.play('place', 1 + homed * 0.08)
    else this.ctx.audio.play('slide', 1.15 - Math.min(slid, 3) * 0.08)

    if (isSolved(b.tiles)) {
      this.solved(side)
      return
    }
    // A row or column that just fell into place: glow, chime, a pat on the back.
    // Each line is cheered once: sliding it apart and back again is no news.
    const fresh = LINES.filter(
      (line, k) => !(b.cheered & (1 << k)) && lineDone(b.tiles, line) && !lineDone(before, line),
    )
    LINES.forEach((line, k) => {
      if (lineDone(b.tiles, line)) b.cheered |= 1 << k
    })
    if (fresh.length) {
      b.glow = fresh.flat()
      b.glowAt = this.time
      this.ctx.audio.play('score', 1 + fresh.length * 0.1)
      const mid = fresh[0] as number[]
      const a = cellCentre(l, mid[0] as number)
      const z = cellCentre(l, mid[mid.length - 1] as number)
      const at = toWorld(f, (a.x + z.x) / 2, (a.y + z.y) / 2)
      for (const i of b.glow) {
        const p = cellCentre(l, i)
        const w = toWorld(f, p.x, p.y)
        this.ctx.fx.sparks(w.x, w.y, C.yellow, 5)
      }
      this.ctx.fx.float('Nice!', at.x, at.y, C.yellow, 60, side)
    }
  }

  /** The finish: the board flashes, sparks fly, confetti rains on the winner's side. */
  private solved(side: Side): void {
    const f = this.frames[side]
    const c = toWorld(f, f.w / 2, f.h / 2)
    this.ctx.fx.stop(5)
    this.ctx.fx.shake(0.35)
    this.ctx.fx.flash(SIDE[side].light, 0.35)
    this.ctx.fx.ring(c.x, c.y, C.yellow, 520)
    this.ctx.fx.burst(c.x, c.y, C.yellow, {
      count: 40,
      speed: 760,
      size: 13,
      life: 0.9,
      colors: [C.yellow, C.white, SIDE[side].light],
    })
    this.ctx.fx.confetti(this.solo ? undefined : side)
    this.complete(side)
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const l = layout(w, h)
    const human = !this.isBot(side)
    drawBoard(g, l, {
      side,
      tiles: b.tiles,
      from: b.from,
      movedAt: b.movedAt,
      glow: b.glow,
      glowAt: b.glowAt,
      nope: b.nope,
      nopeAt: b.nopeAt,
      hint: human && b.moves === 0 && this.s.race[side].done === null,
      doneAt: this.s.race[side].done,
      now: this.time,
    })
    const size = (l.c + l.gap) * SIZE - l.gap
    const bottom = l.y0 + size + 28
    const y = h > 1000 ? bottom + 80 : (bottom + h) / 2
    if (b.moves === 0 && this.time < 10 && human) {
      g.text('Tap a tile next to the gap', w / 2, y, {
        size: 36,
        weight: 600,
        color: alpha(C.white, 0.9),
      })
    } else chip(g, w / 2, y, `${b.moves} ${b.moves === 1 ? 'move' : 'moves'}`, side)
    const best = store.records[this.recordId]
    if (this.solo && best !== undefined) chip(g, w / 2, y + 80, `Best ${fmtTime(best)}`, side, '🏆')
  }
}

export default () => new SlidingPuzzle()
