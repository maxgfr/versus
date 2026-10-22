import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, hudY, pips } from '../../core/hud.ts'
import type { PlayerInput, Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { boxCentre, boxCount, dot, midpoint, renderBoard } from './render.ts'
import {
  type Board,
  BOX_COUNT,
  BOXES,
  countBoxes,
  completes,
  drawLine,
  drawnSides,
  DOTS,
  EDGES,
  hLine,
  emptyBoard,
  legalLines,
  type Owner,
  outcome,
  vLine,
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
  /** Winner of the board once judged: 0, 1, or -1 for a draw / not yet. */
  winner: number
  /** Rounds won so far by each side. */
  wins: [number, number]
  /** Who opened the current round. The other player opens the next one. */
  starter: Side
  /** Rounds started, counting the current one. */
  round: number
  /** Game time the current round began. */
  roundAt: number
  /** A line being pulled from a dot by the player to move: the dot and the finger, or null. */
  pull: { r: number; c: number; x: number; y: number } | null
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

/** Seconds a judged round stays on the board before the next one is drawn. */
const ROUND_PAUSE = 2.6

/**
 * One round is one board. The match is first to `target` round wins; the
 * default of one round is a single game, exactly as before.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

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

/** The dot nearest a point, if the point is close enough to it. */
function dotAt(x: number, y: number, reach: number): { r: number; c: number } | null {
  const c = Math.round((x - GEO.x) / GEO.cell)
  const r = Math.round((y - GEO.y) / GEO.cell)
  if (r < 0 || c < 0 || r >= DOTS || c >= DOTS) return null
  const d = dot(GEO, r, c)
  return Math.hypot(d.x - x, d.y - y) <= reach ? { r, c } : null
}

/** The line from dot (r, c) one step toward (dx, dy) (the main direction of a drag), or null off the board. */
function lineToward(r: number, c: number, dx: number, dy: number): number | null {
  if (Math.abs(dx) >= Math.abs(dy)) {
    const c2 = c + Math.sign(dx)
    if (c2 < 0 || c2 >= DOTS) return null
    return hLine(r, Math.min(c, c2))
  }
  const r2 = r + Math.sign(dy)
  if (r2 < 0 || r2 >= DOTS) return null
  return vLine(Math.min(r, r2), c)
}

class DotsAndBoxes extends TurnGame<State> {
  /** The finger that went down this turn: a tap on a gap, or a pull from dot to dot. */
  private hold: { input: PlayerInput; id: number; x0: number; y0: number } | null = null

  /** Round wins that decide the match, as chosen on the ready screen. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: starter,
      lines: emptyBoard().lines,
      lineAt: Array<number>(EDGES).fill(-1),
      boxes: Array<Owner>(BOX_COUNT).fill(null),
      boxAt: Array<number>(BOX_COUNT).fill(-1),
      last: -1,
      endedAt: -1,
      streak: 0,
      doneAt: -1,
      winner: -1,
      wins: [0, 0],
      starter,
      round: 1,
      roundAt: 0,
      pull: null,
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
    if (s.endedAt >= 0 && !this.over) {
      if (s.doneAt < 0 && this.time >= s.endedAt + 0.7) this.conclude()
      else if (s.doneAt >= 0 && this.time >= s.doneAt + ROUND_PAUSE) this.nextRound()
    }
    super.step(dt)
  }

  /** Every line is down: a wave across the winner's boxes, then the result or the next round. */
  private conclude(): void {
    const s = this.s
    const o = outcome(this.board())
    if (!o) return
    s.doneAt = this.time
    s.winner = o.winner === 'draw' ? -1 : o.winner
    this.ctx.fx.shake(0.3)
    this.ctx.fx.stop(6)
    if (o.winner !== 'draw') {
      s.wins[o.winner]++
      this.ctx.fx.flash(SIDE[o.winner].main, 0.3)
      this.ctx.fx.confetti(o.winner)
      this.ctx.fx.ring(GEO.x + GEO.w / 2, GEO.y + GEO.h / 2, C.yellow, 480)
    }
    // Draws score nothing. A round that does not decide the match is shown, then the next one starts.
    if (o.winner === 'draw' || s.wins[o.winner] < this.target) return
    // A single round keeps the box count on the result screen; a match shows its round wins.
    const score: [number, number] = this.target > 1 ? s.wins : o.counts
    this.finish(o.winner, { score, delay: 2.6 })
  }

  /** A clean board for the next round; the player who did not open the last one starts. */
  private nextRound(): void {
    const s = this.s
    const starter = other(s.starter)
    const board = emptyBoard()
    s.starter = starter
    s.turn = starter
    s.lines = board.lines
    s.lineAt = Array<number>(EDGES).fill(-1)
    s.boxes = board.boxes
    s.boxAt = Array<number>(BOX_COUNT).fill(-1)
    s.last = -1
    s.endedAt = -1
    s.streak = 0
    s.doneAt = -1
    s.winner = -1
    s.round++
    s.roundAt = this.time
    this.ctx.audio.play('go')
  }

  /** The inputs that may draw this turn (same routing as `turnTap`). */
  private turnInputs(): PlayerInput[] {
    const [a, b] = this.ctx.input.players
    if (this.ctx.mode === 'online') return [this.ctx.input.player(this.s.turn)]
    if (this.ctx.mode === '1p') return [a]
    return [a, b]
  }

  /**
   * Tap a gap to draw it, or press on a dot and pull the line out to the next
   * dot: the line stretches after the finger and snaps in when let go.
   */
  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    const s = this.s
    if (tap && !this.hold) {
      const input = this.turnInputs().find((i) => i.downs.includes(tap))
      if (input) this.hold = { input, id: tap.id, x0: tap.x, y0: tap.y }
    }
    const h = this.hold
    if (!h) return
    const held = h.input.held.get(h.id)
    const p = held ?? h.input.ups.find((u) => u.id === h.id)
    if (!p) {
      this.hold = null
      s.pull = null
      return
    }
    const from = dotAt(h.x0, h.y0, GEO.cell * 0.32)
    const dx = p.x - h.x0
    const dy = p.y - h.y0
    const far = Math.hypot(dx, dy) > GEO.cell * 0.3
    if (held) {
      if (from && far) {
        if (!s.pull) this.ctx.audio.play('tick', 1.2)
        s.pull = { r: from.r, c: from.c, x: p.x, y: p.y }
      }
      return
    }
    this.hold = null
    const pulled = s.pull
    s.pull = null
    let e: number | null
    if (pulled && from) {
      // Let go short of the next dot: nothing is drawn.
      if (Math.hypot(dx, dy) < GEO.cell * 0.5) return
      e = lineToward(from.r, from.c, dx, dy)
    } else e = gapAt(h.x0, h.y0)
    if (e === null) return
    if (s.lines[e] !== null) {
      this.ctx.audio.play('error')
      return
    }
    this.draw(e)
  }

  /** The computer: a beat to think before a quiet line, quick hands while it takes a chain. */
  protected override botDelay(): number {
    const b = this.board()
    if (legalLines(b).some((e) => completes(b, e))) return 0.22 + this.ctx.rng.range(0, 0.08)
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.6 : d === 'normal' ? 0.45 : 0.4) + this.ctx.rng.range(0, 0.25)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.hold = null
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
    s.pull = null
    const m = midpoint(GEO, e)
    this.ctx.audio.play('click', side === 0 ? 1 : 1.12)
    this.ctx.audio.buzz(6)
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
      // A long chain builds: every box hits a little harder.
      const k = Math.min(1, (s.streak - 1) / 6)
      this.ctx.fx.shake(0.1 + 0.06 * n + k * 0.12)
      this.ctx.fx.stop((n > 1 ? 5 : 3) + Math.round(k * 2))
      this.ctx.audio.buzz(Math.round(12 + 6 * n + k * 12))
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
    // Online, the open-gap targets and the boxes on offer guide only the mover's phone.
    const human = live && !this.isBot(s.turn) && (g.viewer === null || g.viewer === s.turn)
    const b = this.board()
    const targets = human ? legalLines(b) : []
    const offered = human
      ? s.boxes.flatMap((o, box) => (o === null && drawnSides(b, box) === 3 ? [box] : []))
      : []
    const counts = countBoxes(b)
    tableBackdrop(g)
    renderBoard(g, s, GEO, this.time, targets, offered, s.turn, human ? s.pull : null)
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
      // Round wins stack above (or below, for blue) the box count; a single round shows none.
      if (this.target > 1) pips(g, side, s.wins[side], this.target, { x: 170, inset: 170 })
    }
    if (s.doneAt >= 0) {
      const [r, bl] = counts
      const text = this.over
        ? s.winner < 0
          ? `Dead even ${r}–${bl}`
          : `${this.ctx.names[s.winner as Side]} wins ${Math.max(r, bl)}–${Math.min(r, bl)}`
        : s.winner < 0
          ? `Dead even ${r}–${bl}`
          : `${this.ctx.names[s.winner as Side]} takes the round`
      notice(g, text, Math.min(1, (this.time - s.doneAt - 0.3) * 4), C.yellow)
    }
    const since = this.time - s.roundAt
    if (s.round > 1 && since < 1.3 && s.endedAt < 0) {
      const a = Math.min(1, since * 6, (1.3 - since) * 4)
      notice(g, `Round ${s.round} · ${this.ctx.names[s.starter]} starts`, a)
    }
  }
}

export default () => new DotsAndBoxes()
