import type { MatchSpec, Side } from '../../core/game.ts'
import { Spring } from '../../core/fx/ease.ts'
import { banner } from '../../core/hud.ts'
import { Rng } from '../../core/rng.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { botPlan, botTap, PACE } from './bot.ts'
import { store } from '../../core/store.ts'
import { MID } from '../../core/stage.ts'
import {
  cellAt,
  cellCentre,
  chip,
  drawBoard,
  drawWins,
  layout,
  popAt,
  type TileVis,
  tileColor,
} from './render.ts'
import {
  CELLS,
  colOf,
  distance,
  isSolved,
  progress,
  rowOf,
  scramble,
  SIZE,
  slide,
} from './rules.ts'

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
  /** The computer's countdown to its next tap. */
  botT: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
  /** Tile distance of this race's scramble: progress is measured against it. */
  start: number
  /** Races won per side. The match is first to the target. */
  wins: [number, number]
  /** Game time each side last won a race (its newest pip pops in), or -10. */
  wonAt: [number, number]
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

/** Tile slide: launch speed, acceleration and top speed, in cells and seconds. */
const LAUNCH = 5
const ACCEL = 120
const TOP = 22

function newVis(): TileVis {
  return {
    x: new Float32Array(CELLS),
    y: new Float32Array(CELLS),
    speed: new Float32Array(CELLS),
    axis: new Uint8Array(CELLS),
    squash: Array<number>(CELLS).fill(1),
  }
}

class SlidingPuzzle extends PuzzleRace<State> {
  protected recordId = 'sliding-puzzle'
  /** Sides that solved during the current step: two at once is a dead heat. */
  private solvedNow: Side[] = []
  // Cosmetic only (not synced): tiles drawn sliding toward their cells, with squash springs.
  private vis: [TileVis, TileVis] = [newVis(), newVis()]
  private springs: Spring[][] = [0, 1].map(() =>
    Array.from({ length: CELLS }, () => new Spring(1, 420, 13)),
  )
  /** The race whose tiles `vis` shows (-1: snap on the next frame). */
  private visRound = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return this.deal(0, 0)
  }

  /** Race `round`, dealt at game time `at`: a fresh scramble, the same on both phones. */
  private deal(round: number, at: number): State {
    const sc = scramble(new Rng(this.ctx.seed + round * 7919))
    const plan = botPlan(sc.path, this.ctx.difficulty)
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
      botT: PACE[this.ctx.difficulty] * 1.5,
    })
    this.cap = at + CAP
    return {
      race: newRace(),
      boards: [board(), board()],
      start: Math.max(1, distance(sc.tiles)),
      wins: [0, 0],
      wonAt: [-10, -10],
      round,
      roundAt: at,
      roundEnd: -1,
      roundText: '',
    }
  }

  private nextRace(): void {
    const { wins, wonAt } = this.s
    this.s = { ...this.deal(this.s.round + 1, this.time), wins, wonAt }
    this.ctx.audio.play('go')
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    // The race clock cap lives with the race: derive it again from the state.
    this.cap = this.s.roundAt + CAP
    this.visRound = -1
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
    this.solvedNow = []
    super.step(dt)
    const now = this.solvedNow
    if (!now.length || this.over || this.s.roundEnd >= 0) return
    if (now.length === 2) {
      // Both solved in the same step: neither was faster.
      for (const side of now) {
        const r = this.s.race[side]
        r.done = this.time
        r.progress = 1
      }
      this.ctx.audio.play('coin')
      this.finish('draw', { note: `Dead heat in ${fmtTime(this.elapsed(0))}`, delay: 1.4 })
      return
    }
    this.complete(now[0] as Side)
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
    if (winner !== 'draw') {
      s.wins[winner]++
      s.wonAt[winner] = this.time
    }
    if (winner !== 'draw' && s.wins[winner] >= this.target) {
      super.finish(winner, { ...o, score: [s.wins[0], s.wins[1]] })
      return
    }
    s.roundEnd = this.time
    s.roundText = winner === 'draw' ? 'Draw round' : `${this.ctx.names[winner]} takes the round`
    this.ctx.audio.play(winner === 'draw' ? 'draw' : 'score')
  }

  override render(g: Draw): void {
    this.animate()
    super.render(g)
    if (this.solo || this.target <= 1) return
    if (this.s.roundEnd >= 0 && !this.over) {
      const a = Math.min(1, (this.time - this.s.roundEnd) * 4)
      banner(g, undefined, this.s.roundText, MID, { size: 58, alpha: a })
    }
  }

  /**
   * Slide the drawn tiles toward their cells: each launches, accelerates and
   * slams into its socket, and the squash it takes there grows with the speed
   * it arrived at. Rapid taps never snap a tile: it carries on from where it is.
   */
  private animate(): void {
    const dt = 1 / 60
    const snap = this.visRound !== this.s.round
    this.visRound = this.s.round
    for (const side of [0, 1] as Side[]) {
      const v = this.vis[side]
      const springs = this.springs[side] as Spring[]
      const tiles = this.s.boards[side].tiles
      for (let i = 0; i < CELLS; i++) {
        const value = tiles[i] as number
        if (!value) continue
        const tx = colOf(i)
        const ty = rowOf(i)
        const spring = springs[value] as Spring
        if (snap) {
          v.x[value] = tx
          v.y[value] = ty
          v.speed[value] = 0
          spring.set(1)
          continue
        }
        const dx = tx - (v.x[value] as number)
        const dy = ty - (v.y[value] as number)
        const d = Math.abs(dx) + Math.abs(dy)
        if (d > 0) {
          if (dx) v.axis[value] = 0
          else if (dy) v.axis[value] = 1
          const sp = Math.min(TOP, Math.max(LAUNCH, (v.speed[value] as number) + ACCEL * dt))
          const stepLen = sp * dt
          if (stepLen >= d) {
            v.x[value] = tx
            v.y[value] = ty
            v.speed[value] = 0
            // The hit: a bigger squash the faster it came in.
            spring.kick(-Math.min(9, sp * 0.45))
          } else {
            v.x[value] = (v.x[value] as number) + (dx / d) * stepLen
            v.y[value] = (v.y[value] as number) + (dy / d) * stepLen
            v.speed[value] = sp
          }
        }
        v.squash[value] = spring.update(dt)
      }
    }
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    const f = this.frames[side]
    if (this.isBot(side)) {
      b.botT -= dt
      if (b.botT > 0) return
      b.botT = PACE[this.ctx.difficulty] * this.ctx.rng.range(0.7, 1.3)
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
      if (this.solvedNow.includes(side)) return
    }
  }

  /** Slide the tiles for a tap on `cell`, with the sound and sparks for any tile that lands home. */
  private move(side: Side, cell: number): void {
    if (this.over || this.s.roundEnd >= 0 || this.solvedNow.includes(side)) return
    const b = this.s.boards[side]
    const r = slide(b.tiles, cell)
    const { fx, audio } = this.ctx
    if (!r) {
      if (b.tiles[cell] !== 0) {
        b.nope = cell
        b.nopeAt = this.time
      }
      audio.play('tick', 0.8)
      return
    }
    const before = b.tiles
    // The force of a move: how many tiles it shoves, and how quick it follows the last.
    const slid = r.from.filter((v, i) => v !== i).length
    const quick = 1 - Math.min(1, Math.max(0, (this.time - b.movedAt - 0.12) / 0.6))
    const k = Math.min(1, (slid - 1) / 2) * 0.6 + quick * 0.4
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
      fx.burst(at.x, at.y, tileColor(side, i + 1), {
        count: 10,
        speed: 280,
        size: 9,
        life: 0.4,
      })
    }
    // Dust kicked off the front of the run, where the lead tile hits.
    const gap = r.tiles.indexOf(0)
    const lead = before.indexOf(0)
    const p0 = cellCentre(l, lead)
    const p1 = cellCentre(l, gap)
    const dirX = Math.sign(p0.x - p1.x)
    const dirY = Math.sign(p0.y - p1.y)
    const edge = toWorld(f, p0.x + dirX * l.c * 0.5, p0.y + dirY * l.c * 0.5)
    if (slid > 1 || quick > 0.5) {
      fx.burst(edge.x, edge.y, alpha(C.white, 0.6), {
        count: Math.round(3 + k * 6),
        speed: 120 + k * 160,
        size: 7,
        life: 0.3,
        gravity: 0,
        drag: 4,
      })
    }
    if (slid >= 3) audio.buzz(8)
    if (homed) audio.play('place', 1 + homed * 0.08 + quick * 0.1)
    else audio.play('slide', 1.2 - Math.min(slid, 3) * 0.1 + quick * 0.15)

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
      audio.play('score', 1 + fresh.length * 0.1)
      audio.buzz(14)
      const mid = fresh[0] as number[]
      const a = cellCentre(l, mid[0] as number)
      const z = cellCentre(l, mid[mid.length - 1] as number)
      const at = toWorld(f, (a.x + z.x) / 2, (a.y + z.y) / 2)
      for (const i of b.glow) {
        const p = cellCentre(l, i)
        const w = toWorld(f, p.x, p.y)
        fx.sparks(w.x, w.y, C.yellow, 5)
      }
      fx.float(fresh.length > 1 ? 'Double!' : 'Nice!', at.x, at.y, C.yellow, 60, side)
    }
  }

  /** The finish: the board flashes, sparks fly, confetti rains on the winner's side. */
  private solved(side: Side): void {
    const f = this.frames[side]
    const c = toWorld(f, f.w / 2, f.h / 2)
    const { fx, audio } = this.ctx
    fx.stop(5)
    fx.shake(0.35)
    fx.flash(SIDE[side].light, 0.35)
    fx.ring(c.x, c.y, C.yellow, 520)
    fx.burst(c.x, c.y, C.yellow, {
      count: 40,
      speed: 760,
      size: 13,
      life: 0.9,
      colors: [C.yellow, C.white, SIDE[side].light],
    })
    fx.confetti(this.solo ? undefined : side)
    audio.buzz(30)
    // Decided at the end of the step: a rival solving in the same step ties it.
    this.solvedNow.push(side)
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const l = layout(w, h)
    // Online, the rival's half shows its tiles but not its prompts: each phone hints its own player only.
    const human = !this.isBot(side) && (g.viewer === null || g.viewer === side)
    drawBoard(g, l, {
      side,
      tiles: b.tiles,
      vis: this.vis[side],
      glow: b.glow,
      glowAt: b.glowAt,
      nope: b.nope,
      nopeAt: b.nopeAt,
      hint: human && b.moves === 0 && this.s.race[side].done === null,
      doneAt: this.s.race[side].done,
      now: this.time,
    })
    if (!this.solo && this.target > 1)
      drawWins(g, l, side, this.s.wins[side], this.target, this.time - this.s.wonAt[side])
    const size = (l.c + l.gap) * SIZE - l.gap
    const bottom = l.y0 + size + 28
    const y = h > 1000 ? bottom + 80 : (bottom + h) / 2
    if (b.moves === 0 && this.time - this.s.roundAt < 10 && human) {
      g.text('Tap a tile next to the gap', w / 2, y + Math.sin(this.time * 3) * 4, {
        size: 36,
        weight: 600,
        color: alpha(C.white, 0.9),
      })
    } else {
      const label = `${b.moves} ${b.moves === 1 ? 'move' : 'moves'}`
      g.at(w / 2, y, 0, () => chip(g, 0, 0, label, side), popAt(this.time, b.movedAt))
    }
    const best = store.records[this.recordId]
    if (this.solo && best !== undefined) chip(g, w / 2, y + 80, `Best ${fmtTime(best)}`, side, '🏆')
  }
}

export default () => new SlidingPuzzle()
