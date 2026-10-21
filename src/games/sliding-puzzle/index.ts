import type { MatchSpec, Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { botTap, PACE } from './bot.ts'
import { store } from '../../core/store.ts'
import { MID } from '../../core/stage.ts'
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
  /** Tile distance of this race's scramble: progress is measured against it. */
  start: number
  /** Races won per side. The match is first to the target. */
  wins: [number, number]
  /** Race index, from 0. Each race is a fresh puzzle, derived from the seed on both phones. */
  round: number
  /** Game time this race was dealt: its clock runs from here. */
  roundAt: number
  /** Game time this race was decided (a short break follows), or -1 while it runs. */
  roundEnd: number
  /** Banner for the decided race. */
  roundText: string
}

/** Five minutes a race: then the most progress wins it. */
const CAP = 300
/** Seconds between two races, so the one just decided can be read. */
const BREAK = 2

/** Race wins to take the match: one race is one round. Solo keeps a single time trial. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

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

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return this.deal(0, 0)
  }

  /** Race `round`, dealt at game time `at`: a fresh scramble, the same on both phones. */
  private deal(round: number, at: number): State {
    const sc = scramble(new Rng(this.ctx.seed + round))
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
    this.cap = at + CAP
    return {
      race: newRace(),
      boards: [board(), board()],
      start: Math.max(1, distance(sc.tiles)),
      wins: [0, 0],
      round,
      roundAt: at,
      roundEnd: -1,
      roundText: '',
    }
  }

  private nextRace(): void {
    const wins = this.s.wins
    this.s = { ...this.deal(this.s.round + 1, this.time), wins }
  }

  protected progressOf(side: Side): number {
    return progress(this.s.boards[side].tiles, this.s.start)
  }

  /** Seconds on this race's clock for a side, penalties included. Frozen once the race is decided. */
  override elapsed(side: Side): number {
    const r = this.s.race[side]
    const end = this.s.roundEnd >= 0 ? this.s.roundEnd : this.time
    return (r.done ?? end) - this.s.roundAt + r.penalty
  }

  protected override step(dt: number): void {
    if (this.s.roundEnd >= 0) {
      if (this.time - this.s.roundEnd >= BREAK) this.nextRace()
      return
    }
    super.step(dt)
  }

  /**
   * The engine ends a race through `finish` (solved, or the clock ran out). In a
   * longer match that is a round: its winner takes it, the match ends at the
   * target, and a draw takes nobody's round. Solo and first-to-one end as before.
   */
  protected override finish(
    winner: Side | 'draw',
    o: { score?: [number, number]; note?: string; delay?: number } = {},
  ): void {
    if (this.solo || this.target <= 1) {
      super.finish(winner, o)
      return
    }
    const s = this.s
    if (this.over || s.roundEnd >= 0) return
    if (winner !== 'draw') s.wins[winner]++
    if (winner !== 'draw' && s.wins[winner] >= this.target) {
      super.finish(winner, { ...o, score: [s.wins[0], s.wins[1]] })
      return
    }
    s.roundEnd = this.time
    s.roundText = winner === 'draw' ? 'Draw round' : `${this.ctx.names[winner]} takes the round`
    this.ctx.audio.play(winner === 'draw' ? 'draw' : 'score')
  }

  override render(g: Draw): void {
    super.render(g)
    if (this.solo || this.target <= 1) return
    pips(g, 0, this.s.wins[0], this.target)
    pips(g, 1, this.s.wins[1], this.target)
    if (this.s.roundEnd >= 0 && !this.over) {
      const a = Math.min(1, (this.time - this.s.roundEnd) * 4)
      banner(g, undefined, this.s.roundText, MID, { size: 58, alpha: a })
    }
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
    if (this.over || this.s.roundEnd >= 0) return
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
    if (b.moves === 0 && this.time - this.s.roundAt < 10 && human) {
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
