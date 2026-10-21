import { other, type Side } from '../../core/game.ts'
import { banner, hudY } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { boxCentre, boxCount, midpoint, renderBoard } from './render.ts'
import {
  type Board,
  BOX_COUNT,
  BOXES,
  countBoxes,
  drawLine,
  drawnSides,
  EDGES,
  emptyBoard,
  legalLines,
  type Owner,
  outcome,
} from './rules.ts'

export interface State {
  turn: Side
  /** Owner of each drawn line, by edge index. */
  lines: Owner[]
  /** Game time each line was drawn, by edge index. */
  lineAt: number[]
  /** Owner of each completed box, by box index. */
  boxes: Owner[]
  /** Game time each box was completed, by box index. */
  boxAt: number[]
  /** The last line drawn, or -1. */
  last: number
  /** Game time the last line went down, or -1 while lines remain. */
  endedAt: number
  /** Boxes taken so far this turn (the chain), for rising pitch. */
  streak: number
  /** Game time the finished board was judged (the closing wave), or -1. */
  doneAt: number
  /** Winner once judged: 0, 1, or -1 for a draw / not yet. */
  winner: number
}

/**
 * A notice both players can read: in local 2P one copy sits near each edge,
 * upright for its player, clear of the board. On one screen it sits near the
 * bottom edge.
 */
function notice(g: Draw, text: string, alpha: number, color?: string): void {
  const o = { size: 58, alpha, color }
  if (g.flipTop) banner(g, undefined, text, MID, { ...o, gap: 600 })
  else banner(g, 0, text, MID + 600, o)
}

/** Narrow enough that the left column of dots stays clear of the pause button. */
const GEO = geom(BOXES, BOXES, 720, 720, MID)

/** How far from a gap's midpoint a tap still counts for it (forgiving). */
const REACH = GEO.cell * 0.6

/** The gap nearest a tap, if it is close enough. */
function gapAt(x: number, y: number): number | null {
  let best: number | null = null
  let bestD = REACH * REACH
  for (let e = 0; e < EDGES; e++) {
    const m = midpoint(GEO, e)
    const d = (m.x - x) ** 2 + (m.y - y) ** 2
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

class DotsAndBoxes extends TurnGame<State> {
  protected setup(): State {
    return {
      turn: this.ctx.rng.chance(0.5) ? 0 : 1,
      lines: emptyBoard().lines,
      lineAt: Array<number>(EDGES).fill(-1),
      boxes: Array<Owner>(BOX_COUNT).fill(null),
      boxAt: Array<number>(BOX_COUNT).fill(-1),
      last: -1,
      endedAt: -1,
      streak: 0,
      doneAt: -1,
      winner: -1,
    }
  }

  private board(): Board {
    return { lines: this.s.lines, boxes: this.s.boxes }
  }

  protected override busy(): boolean {
    return this.s.endedAt >= 0
  }

  protected override step(dt: number): void {
    const s = this.s
    if (s.endedAt >= 0 && !this.over && this.time >= s.endedAt + 0.7) this.conclude()
    super.step(dt)
  }

  /** Every line is down: a wave across the winner's boxes, then the result. */
  private conclude(): void {
    const s = this.s
    const o = outcome(this.board())
    if (!o) return
    s.doneAt = this.time
    s.winner = o.winner === 'draw' ? -1 : o.winner
    this.ctx.fx.shake(0.3)
    this.ctx.fx.stop(6)
    if (o.winner !== 'draw') {
      this.ctx.fx.flash(SIDE[o.winner].main, 0.3)
      this.ctx.fx.confetti(o.winner)
      this.ctx.fx.ring(GEO.x + GEO.w / 2, GEO.y + GEO.h / 2, C.yellow, 480)
    }
    this.finish(o.winner, { score: o.counts, delay: 2.6 })
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const e = gapAt(tap.x, tap.y)
    if (e === null) return
    if (this.s.lines[e] !== null) {
      this.ctx.audio.play('error')
      return
    }
    this.draw(e)
  }

  protected botPlay(): void {
    const legal = legalLines(this.board())
    const e = choose(this.board(), this.s.turn, this.ctx.difficulty, this.ctx.rng)
    this.draw(legal.includes(e) ? e : (legal[0] as number))
  }

  /** Draw line `e` for the side to move. Completing a box keeps the turn. */
  private draw(e: number): void {
    const s = this.s
    const side = s.turn
    const res = drawLine(this.board(), e, side)
    s.lines = res.board.lines
    s.boxes = res.board.boxes
    s.lineAt[e] = this.time
    s.last = e
    const m = midpoint(GEO, e)
    this.ctx.audio.play('click', side === 0 ? 1 : 1.12)
    this.ctx.fx.sparks(m.x, m.y, SIDE[side].light, 5)

    if (res.completed.length) {
      for (const box of res.completed) {
        s.boxAt[box] = this.time
        s.streak++
        const c = boxCentre(GEO, box)
        this.ctx.fx.burst(c.x, c.y, SIDE[side].main, {
          count: 16,
          speed: 420,
          size: 12,
          life: 0.55,
        })
        this.ctx.fx.burst(c.x, c.y, C.yellow, {
          count: 8,
          speed: 520,
          size: 6,
          life: 0.35,
          kind: 'spark',
        })
      }
      const first = boxCentre(GEO, res.completed[0] as number)
      const n = res.completed.length
      // Each box in a chain rings a little higher.
      const pitch = (side === 0 ? 1 : 1.12) * Math.min(1.8, 1 + (s.streak - 1) * 0.08)
      this.ctx.audio.play(n > 1 ? 'coin' : 'score', pitch)
      const label = s.streak >= 3 ? `×${s.streak}` : `+${n}`
      this.ctx.fx.float(label, first.x, first.y, SIDE[side].light, 72, side)
      this.ctx.fx.shake(0.1 + 0.06 * n)
      this.ctx.fx.stop(n > 1 ? 5 : 3)
    } else {
      s.turn = other(side)
      s.streak = 0
    }

    if (legalLines(this.board()).length === 0) {
      s.endedAt = this.time
    }
  }

  render(g: Draw): void {
    const s = this.s
    const live = s.endedAt < 0
    const human = live && !this.isBot(s.turn)
    const b = this.board()
    const targets = human ? legalLines(b) : []
    const offered = human
      ? s.boxes.flatMap((o, box) => (o === null && drawnSides(b, box) === 3 ? [box] : []))
      : []
    const counts = countBoxes(b)
    tableBackdrop(g)
    renderBoard(g, s, GEO, this.time, targets, offered, s.turn)
    const streak: [string | undefined, string | undefined] = [undefined, undefined]
    if (live && s.streak > 0) streak[s.turn] = 'Again!'
    this.drawTurns(g, streak, live)
    for (const side of [0, 1] as Side[]) {
      let changed = -1
      s.boxes.forEach((o, box) => {
        if (o === side) changed = Math.max(changed, s.boxAt[box] ?? -1)
      })
      const bump = changed >= 0 ? (this.time - changed) / 0.25 : 1
      const theirs = counts[side === 0 ? 1 : 0]
      boxCount(g, side, counts[side], bump, 170, hudY(g, side, 70), counts[side] > theirs)
    }
    if (s.doneAt >= 0) {
      const [r, bl] = counts
      const text =
        s.winner < 0
          ? `Dead even ${r}–${bl}`
          : `${this.ctx.names[s.winner as Side]} wins ${Math.max(r, bl)}–${Math.min(r, bl)}`
      notice(g, text, Math.min(1, (this.time - s.doneAt - 0.3) * 4), C.yellow)
    }
  }
}

export default () => new DotsAndBoxes()
