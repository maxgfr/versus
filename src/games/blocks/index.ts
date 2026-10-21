import { banner } from '../../core/hud.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { inOutCubic, lerp, outCubic, prog } from '../../core/fx/ease.ts'
import { C, SIDE, shade } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { store, submitRecord } from '../../core/store.ts'
import {
  type Frame,
  halfFrame,
  inFrame,
  localView,
  toLocal,
  toWorld,
} from '../../engines/runner/frame.ts'
import { chooseMove, PACE } from './bot.ts'
import { drawPanel, layout, type PanelView, TOYS, traySlotAt } from './render.ts'

/** How long the computer takes to carry a piece from its tray to the grid (s). */
const AIM = 0.32
/** Matches the render's pickup growth, so the carried piece lands where it is drawn. */
const PICKUP = 0.12
import {
  clearPoints,
  N,
  pieceSequence,
  type Shape,
  SHAPES,
  shapeOf,
  snap,
  step,
  trayAt,
} from './rules.ts'

export interface Board {
  grid: number[]
  tray: (number | null)[]
  /** Index of the tray on the table. */
  k: number
  score: number
  dead: boolean
  deadAt: number
  /** Cells of the last piece (they pop in) and when it landed. */
  placed: number[]
  placedAt: number
  /** Cells cleared by the last drop, with their value (they fade out). */
  fade: { cell: number; value: number }[]
  fadeAt: number
  /** Lines cleared by the last drop (the combo banner). */
  lines: number
  /** When the score last went up (it pops). */
  scoreAt: number
  /** A piece being dragged: its tray slot, the finger's panel-local position, and when it was picked up. */
  drag: { slot: number; id: number; x: number; y: number; at: number } | null
  /** A refused piece flying back to its slot from (x, y), since `at`. */
  back: { slot: number; x: number; y: number; at: number } | null
  /** The computer's chosen drop, carried across the board since `at`. */
  aim: { slot: number; x: number; y: number; at: number } | null
  botT: number
}

export interface State {
  boards: [Board, Board]
  /** Whole seconds left last step, to tick the last five. */
  sec: number
}

/** The match: 90 seconds by default, or until everyone is out of moves. */
const LIMIT = 90

/** Match length in seconds, chosen before the game. The clock and the whistle follow it. */
export const match: MatchSpec = { unit: 'seconds', default: LIMIT, min: 15, max: 180, step: 15 }

class Blocks extends BaseGame<State> {
  // Derived from the seed on both phones: never sent over the wire.
  private seq: number[] = []
  private frames!: [Frame, Frame]
  private solo = false

  private get target(): number {
    return this.ctx.target || match.default
  }

  override init(ctx: Parameters<BaseGame<State>['init']>[0]): void {
    this.solo = ctx.mode === '1p' && !ctx.bots[1]
    this.frames = [halfFrame(0, ctx.mode, this.solo), halfFrame(1, ctx.mode)]
    super.init(ctx)
  }

  protected setup(): State {
    this.seq = pieceSequence(this.ctx.seed)
    const board = (): Board => ({
      grid: Array<number>(N * N).fill(0),
      tray: trayAt(this.seq, 0),
      k: 0,
      score: 0,
      dead: false,
      deadAt: -1,
      placed: [],
      placedAt: -10,
      fade: [],
      fadeAt: -10,
      lines: 0,
      scoreAt: -10,
      drag: null,
      back: null,
      aim: null,
      botT: 0,
    })
    return { boards: [board(), board()], sec: this.target }
  }

  sides(): Side[] {
    return this.solo ? [0] : [0, 1]
  }

  private left(): number {
    return Math.max(0, this.target - this.time)
  }

  protected step(dt: number): void {
    const sec = Math.max(0, Math.ceil(this.left()))
    if (sec !== this.s.sec) {
      this.s.sec = sec
      if (sec > 0 && sec <= 5) this.ctx.audio.play('tick', 1 + (5 - sec) * 0.06)
    }
    for (const side of this.sides()) {
      if (this.s.boards[side].dead) continue
      if (this.isBot(side)) this.botTurn(side, dt)
      else this.humanTurn(side)
      if (this.over) return
    }
    if (this.time >= this.target) this.end(true)
    else if (this.sides().every((s) => this.s.boards[s].dead)) this.end(false)
  }

  private humanTurn(side: Side): void {
    const b = this.s.boards[side]
    const f = this.frames[side]
    const pi = this.ctx.input.player(side)
    const l = layout(f.w, f.h)
    if (!b.drag) {
      for (const p of pi.downs) {
        const q = toLocal(f, p.x, p.y)
        const slot = traySlotAt(f.w, l, q.x, q.y)
        if (slot < 0 || b.tray[slot] === null || b.tray[slot] === undefined) continue
        b.drag = { slot, id: p.id, x: q.x, y: q.y, at: this.time }
        b.back = null
        this.ctx.audio.play('pop', 1.1)
        return
      }
      return
    }
    const d = b.drag
    const up = pi.ups.find((u) => u.id === d.id)
    const p = pi.held.get(d.id) ?? up
    if (!p) {
      b.drag = null
      return
    }
    const q = toLocal(f, p.x, p.y)
    d.x = q.x
    d.y = q.y
    if (up) {
      b.drag = null
      this.drop(side, d.slot, q.x, q.y - l.lift)
    }
  }

  /** A finger let go: place the piece where its centre is, if it fits near there. */
  private drop(side: Side, slot: number, cx: number, cy: number): void {
    const b = this.s.boards[side]
    const code = b.tray[slot]
    if (code === null || code === undefined) return
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    const shape = SHAPES[shapeOf(code)] as Shape
    const s = snap(b.grid, shape, (cx - l.gx0) / l.cs, (cy - l.gy0) / l.cs)
    if (!s.ok) {
      // Refused: the piece flies back to its slot.
      b.back = { slot, x: cx, y: cy, at: this.time }
      this.ctx.audio.play('swish', 0.8)
      return
    }
    this.commit(side, slot, s.x, s.y)
  }

  private botTurn(side: Side, dt: number): void {
    const b = this.s.boards[side]
    if (b.aim) {
      if (this.time - b.aim.at < AIM) return
      const a = b.aim
      b.aim = null
      this.commit(side, a.slot, a.x, a.y)
      return
    }
    b.botT += dt
    if (b.botT < PACE[this.ctx.difficulty]) return
    b.botT = 0
    const m = chooseMove(b.grid, b.tray, this.ctx.difficulty, this.ctx.rng)
    if (m) {
      b.aim = { ...m, at: this.time }
      this.ctx.audio.play('pop', 1.1)
    }
  }

  /** Apply a drop: score it, clear lines, deal, and show it. */
  private commit(side: Side, slot: number, x: number, y: number): void {
    const b = this.s.boards[side]
    const r = step({ grid: b.grid, tray: b.tray, k: b.k }, this.seq, slot, x, y)
    if (!r) return
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    b.grid = r.board.grid
    b.tray = r.board.tray
    b.k = r.board.k
    b.score += r.points
    b.scoreAt = this.time
    b.lines = r.lines
    b.placed = r.placed
    b.placedAt = this.time

    // Centre of the piece, for the float text and the burst.
    let sx = 0
    let sy = 0
    for (const i of r.placed) {
      sx += (i % N) + 0.5
      sy += Math.floor(i / N) + 0.5
    }
    const at = toWorld(
      f,
      l.gx0 + (sx / r.placed.length) * l.cs,
      l.gy0 + (sy / r.placed.length) * l.cs,
    )
    this.ctx.fx.burst(at.x, at.y, SIDE[side].light, { count: 8, speed: 240, size: 8, life: 0.4 })
    if (r.lines) {
      b.fade = r.cleared
      b.fadeAt = this.time
      for (const c of r.cleared) {
        const p = toWorld(
          f,
          l.gx0 + ((c.cell % N) + 0.5) * l.cs,
          l.gy0 + (Math.floor(c.cell / N) + 0.5) * l.cs,
        )
        this.ctx.fx.burst(p.x, p.y, TOYS[c.value - 1] ?? C.white, {
          count: 5,
          speed: 340,
          size: 10,
          life: 0.55,
          kind: 'square',
        })
      }
      const mid = toWorld(f, l.gx0 + (N * l.cs) / 2, l.gy0 + (N * l.cs) / 2)
      if (r.lines >= 2) {
        this.ctx.fx.stop(3 + r.lines)
        this.ctx.fx.ring(mid.x, mid.y, C.yellow, 420)
        this.ctx.fx.flash(C.yellow, 0.12 + 0.04 * r.lines)
      }
      // Above the placed piece, but low enough that its drift stays inside the
      // grid: a clear on the top row must not float off into the header.
      const top = toWorld(
        f,
        l.gx0 + (sx / r.placed.length) * l.cs,
        Math.max(l.gy0 + 120, l.gy0 + (sy / r.placed.length) * l.cs - 90),
      )
      this.ctx.fx.float(`+${clearPoints(r.lines)}`, top.x, top.y, C.yellow, 64, side)
      this.ctx.fx.shake(0.12 + 0.05 * r.lines)
      this.ctx.audio.play('score', 1 + r.lines * 0.12)
    } else {
      this.ctx.audio.play('place', 0.95 + r.placed.length * 0.02)
    }
    this.ctx.fx.float(`+${r.placed.length}`, at.x, at.y + (f.angle ? -40 : 40), C.white, 44, side)
    if (r.dead) this.die(side)
  }

  /** The bot's carried piece as a drag, so it is drawn (and ghosted) like a finger's. */
  private aimView(side: Side, b: Board): PanelView['drag'] {
    const a = b.aim
    const code = a ? b.tray[a.slot] : null
    if (!a || code === null || code === undefined) return null
    const f = this.frames[side]
    const l = layout(f.w, f.h)
    const shape = SHAPES[shapeOf(code)] as Shape
    const t = this.time - a.at
    const k = inOutCubic(prog(t, 0.05, AIM))
    const sx = (f.w / 3) * (a.slot + 0.5)
    const sy = l.trayTop + l.trayH / 2
    const tx = l.gx0 + (a.x + shape.w / 2) * l.cs
    const ty = l.gy0 + (a.y + shape.h / 2) * l.cs
    const grow = outCubic(prog(t, 0, PICKUP))
    return { slot: a.slot, x: lerp(sx, tx, k), y: lerp(sy, ty, k) + l.lift * grow, at: a.at }
  }

  private die(side: Side): void {
    const b = this.s.boards[side]
    b.dead = true
    b.deadAt = this.time
    b.drag = null
    b.aim = null
    const f = this.frames[side]
    const at = toWorld(f, f.w / 2, f.h / 2)
    this.ctx.audio.play('lose')
    this.ctx.fx.shake(0.25)
    this.ctx.fx.puff(at.x, at.y, 'rgba(255,255,255,0.5)', 12)
  }

  private end(timeUp: boolean): void {
    const [a, b] = this.s.boards
    const note = timeUp ? 'Time up' : 'Out of moves'
    // The final whistle: a flash, a ring, and confetti on the winner's side.
    this.ctx.fx.flash(C.white, 0.3)
    this.ctx.fx.shake(0.3)
    if (timeUp) this.ctx.fx.ring(500, MID, C.yellow, 600)
    const win = this.solo ? 0 : a.score === b.score ? null : a.score > b.score ? 0 : 1
    if (win !== null) this.ctx.fx.confetti(this.solo ? undefined : win)
    if (this.solo) {
      const score = a.score
      const prev = store.records.blocks
      // The record compares scores of the default length only: a longer clock scores more.
      const standard = this.target === match.default
      const best = standard && submitRecord('blocks', score, false)
      this.finish(0, {
        score: [score, 0],
        note: best ? `New record: ${score}` : `Score ${score} · best ${prev ?? score}`,
        delay: 1.4,
      })
      return
    }
    this.finish(a.score === b.score ? 'draw' : a.score > b.score ? 0 : 1, {
      score: [a.score, b.score],
      note,
      delay: 1.4,
    })
  }

  private view(side: Side): PanelView {
    const b = this.s.boards[side]
    return {
      side,
      name: this.ctx.names[side],
      score: b.score,
      grid: b.grid,
      tray: b.tray,
      placed: b.placed,
      placedAt: b.placedAt,
      fade: b.fade,
      fadeAt: b.fadeAt,
      lines: b.lines,
      scoreAt: b.scoreAt,
      drag: b.drag
        ? { slot: b.drag.slot, x: b.drag.x, y: b.drag.y, at: b.drag.at }
        : this.aimView(side, b),
      back: b.back,
      dead: b.dead,
      deadAt: b.deadAt,
      clock: this.left(),
      hint: !this.isBot(side) && !b.dead && b.score === 0 && this.time < 8,
      best: this.solo ? (store.records.blocks ?? null) : null,
      now: this.time,
    }
  }

  render(g: Draw): void {
    g.fillView(C.ink)
    for (const side of this.sides()) {
      const f = this.frames[side]
      inFrame(g, f, () => {
        const v = localView(g, f)
        g.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, shade(SIDE[side].main, -0.78))
        drawPanel(g, f.w, f.h, this.view(side))
      })
    }
    if (!this.solo) {
      // Each board carries its own clock in its header row: a single midline
      // clock sat on blue's tray whenever blue's half is not turned (online, demo).
      g.rect(g.stage.view.x - 2, MID - 7, g.stage.view.w + 4, 14, C.ink)
    }
    // Final whistle: "Time!" over each board still playing (a stuck board
    // already shows its "No moves left" card there).
    if (this.time >= this.target) {
      const k = prog(this.time - this.target, 0, 0.2)
      for (const side of this.sides()) {
        if (this.s.boards[side].dead) continue
        const f = this.frames[side]
        const l = layout(f.w, f.h)
        const at = toWorld(f, f.w / 2, l.gy0 + (N * l.cs) / 2)
        banner(g, side, 'Time!', at.y, { size: 84, color: C.yellow, alpha: k })
      }
    }
  }
}

export default () => new Blocks()
