import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { PlayerInput, Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { cellCenter, geom, tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { hoverX, impactTime, renderBoard, SPILL } from './render.ts'
import {
  addRound,
  type Cell,
  COLS,
  dropRow,
  emptyBoard,
  legalColumns,
  matchOver,
  nextStarter,
  outcome,
  play,
  ROWS,
  TARGET,
} from './rules.ts'

export interface State {
  turn: Side
  cells: Cell[]
  /** Game time each disc was dropped, per cell (drives the fall and the squash). */
  placedAt: number[]
  /** Cell of the disc still falling, or -1. */
  falling: number
  /** Game time the falling disc first hits the stack, or -1. */
  landAt: number
  /** X the falling disc started from (where it hovered). */
  fromX: number
  /** Game time the side to move got the turn (the hovering disc pops in). */
  turnAt: number
  wins: [number, number]
  starter: Side
  /** Rounds started, counting the current one. */
  round: number
  /** Winning four, in order, or null. */
  line: readonly number[] | null
  /** Game time the round ended, or -1 while playing. */
  endedAt: number
  roundText: string
  /** The last board, pouring out of the bottom between rounds, or null. */
  spill: Cell[] | null
  /** Game time the board was let go, or -1. */
  spillAt: number
  /** Game time the current round began. */
  roundAt: number
  /** X of the human's finger holding the next disc over the board, or -1 (the guest sees it too). */
  aimX: number
}

/**
 * A notice both players can read: in local 2P one copy sits near each edge,
 * upright for its player, clear of the board. On one screen it sits near the
 * bottom edge.
 */
function notice(g: Draw, text: string, alpha: number, color?: string): void {
  const o = { size: 58, alpha, color }
  if (g.flipTop) banner(g, undefined, text, MID, { ...o, gap: 640 })
  else banner(g, 0, text, MID + 640, o)
}

const GEO = geom(COLS, ROWS, 780, 780, MID - 10)

/** A tap counts for a column anywhere along its height, from the hover spot to just below the frame. */
function columnAt(x: number, y: number): number | null {
  const top = GEO.y - GEO.cell * 1.6
  const bottom = GEO.y + GEO.h + 90
  if (y < top || y > bottom) return null
  const c = Math.floor((x - GEO.x) / GEO.cell)
  return c >= 0 && c < COLS ? c : null
}

/** Seconds the winning four shows before the board is let go. */
const SHOW = 1.5

export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class FourInARow extends TurnGame<State> {
  /** The finger holding the next disc (press, slide over a column, let go to drop). */
  private hold: { input: PlayerInput; id: number } | null = null

  /** Round wins that decide the match, as chosen on the ready screen. */
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: starter,
      cells: emptyBoard(),
      placedAt: Array<number>(COLS * ROWS).fill(0),
      falling: -1,
      landAt: -1,
      fromX: GEO.x + GEO.w / 2,
      turnAt: 0,
      wins: [0, 0],
      starter,
      round: 1,
      line: null,
      endedAt: -1,
      roundText: '',
      spill: null,
      spillAt: -1,
      roundAt: 0,
      aimX: -1,
    }
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.falling >= 0) return true
    if (s.endedAt < 0) return false
    if (this.over) return true
    // Round over: show the four, let the board pour out, then the other player starts.
    if (s.spillAt < 0 && this.time - s.endedAt > SHOW) {
      s.spill = s.cells
      s.spillAt = this.time
      s.cells = emptyBoard()
      s.line = null
      s.roundText = ''
      this.ctx.audio.play('slide')
      this.ctx.audio.play('roll', 0.9)
      this.ctx.fx.shake(0.18)
    }
    if (s.spillAt >= 0 && this.time - s.spillAt > SPILL) {
      s.spill = null
      s.spillAt = -1
      s.starter = nextStarter(s.starter)
      s.turn = s.starter
      s.turnAt = this.time
      s.placedAt = Array<number>(COLS * ROWS).fill(0)
      s.endedAt = -1
      s.round++
      s.roundAt = this.time
      this.ctx.audio.play('go')
      return false
    }
    return true
  }

  protected override animate(): void {
    if (this.s.falling >= 0 && this.time >= this.s.landAt) this.land()
  }

  /** The inputs that may move the disc this turn (same routing as `turnTap`). */
  private turnInputs(): PlayerInput[] {
    const [a, b] = this.ctx.input.players
    if (this.ctx.mode === 'online') return [this.ctx.input.player(this.s.turn)]
    if (this.ctx.mode === '1p') return [a]
    return [a, b]
  }

  /**
   * Press over the board to pick up the next disc, slide it over a column and
   * let go to drop it there. A quick tap on a column drops straight in.
   */
  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    const s = this.s
    if (!this.hold && tap && columnAt(tap.x, tap.y) !== null) {
      const input = this.turnInputs().find((i) => i.downs.includes(tap))
      if (input) {
        this.hold = { input, id: tap.id }
        this.ctx.audio.play('tick', 1.3)
      }
    }
    if (!this.hold) return
    const { input, id } = this.hold
    const held = input.held.get(id)
    const p = held ?? input.ups.find((u) => u.id === id)
    if (!p) {
      this.hold = null
      s.aimX = -1
      return
    }
    const x = Math.max(GEO.x + GEO.cell / 2, Math.min(GEO.x + GEO.w - GEO.cell / 2, p.x))
    const before = s.aimX < 0 ? -1 : Math.floor((s.aimX - GEO.x) / GEO.cell)
    s.aimX = x
    const col = Math.floor((x - GEO.x) / GEO.cell)
    // A soft click as the disc passes over each column.
    if (held && before >= 0 && before !== col) this.ctx.audio.play('tick', 1.1 + col * 0.03)
    if (held) return
    this.hold = null
    s.aimX = -1
    if (dropRow(s.cells, col) < 0) {
      this.ctx.audio.play('error')
      this.ctx.fx.shake(0.06)
      const { x: cx } = cellCenter(GEO, col, 0)
      this.ctx.fx.burst(cx, GEO.y - 40, C.white, { count: 6, speed: 220, size: 8, life: 0.3 })
      return
    }
    this.drop(col, x)
  }

  /** The computer answers briskly; its search runs off-thread. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.65 : d === 'normal' ? 0.5 : 0.4) + this.ctx.rng.range(0, 0.25)
  }

  protected botPlay(): Promise<void> | void {
    const r = choose(this.s.cells, this.s.turn, this.ctx.difficulty, this.ctx.rng)
    if (typeof r === 'number') this.botDrop(r)
    else return r.then((col) => this.botDrop(col))
  }

  private botDrop(col: number): void {
    if (this.over || this.s.falling >= 0 || this.s.endedAt >= 0 || !this.isBot(this.s.turn)) return
    // A search that answered late must never drop into a full column.
    const legal = legalColumns(this.s.cells)
    if (legal.length === 0) return
    this.drop(legal.includes(col) ? col : (legal[0] as number), hoverX(GEO, this.time, true))
  }

  /** Start a disc falling into `col` for the side to move, from where it hovered. */
  private drop(col: number, fromX: number): void {
    const s = this.s
    const row = dropRow(s.cells, col)
    const index = row * COLS + col
    s.cells = play(s.cells, col, s.turn)
    s.placedAt[index] = this.time
    s.falling = index
    s.fromX = fromX
    s.landAt = this.time + impactTime(GEO, row)
    s.aimX = -1
    this.hold = null
    this.ctx.audio.play('swish', s.turn === 0 ? 1 : 1.12)
  }

  /** The falling disc hits the stack: thud, dust, then judge the round. */
  private land(): void {
    const s = this.s
    const index = s.falling
    const side = s.cells[index] as Side
    const row = Math.floor(index / COLS)
    const { x, y } = cellCenter(GEO, index % COLS, row)
    s.falling = -1
    s.landAt = -1
    // Heavier thud the further it fell: pitch, dust, shake and haptics all scale with the drop.
    const k = (row + 1) / ROWS
    this.ctx.audio.play('thud', (side === 0 ? 1 : 1.12) * (1.15 - row * 0.04))
    this.ctx.audio.buzz(Math.round(6 + k * 14))
    this.ctx.fx.puff(x, y + GEO.cell * 0.42, 'rgba(255,255,255,0.4)', Math.round(3 + k * 6))
    this.ctx.fx.burst(x, y + GEO.cell * 0.4, SIDE[side].light, {
      count: Math.round(5 + k * 9),
      speed: 200 + k * 200,
      size: 7,
      life: 0.35,
      spread: Math.PI,
      dir: -Math.PI / 2,
    })
    this.ctx.fx.shake(0.04 + k * 0.1)

    const o = outcome(s.cells)
    if (!o) {
      s.turn = other(side)
      s.turnAt = this.time
      return
    }
    s.endedAt = this.time
    if (o.winner === 'draw') {
      s.roundText = 'Board full — draw'
      this.ctx.audio.play('draw')
      return
    }
    s.line = o.line
    s.wins = addRound(s.wins, o)
    const decided = matchOver(s.wins, this.target)
    s.roundText = decided === null ? `${this.ctx.names[o.winner]} takes the round` : ''
    this.ctx.audio.play('score')
    this.ctx.audio.buzz(30)
    this.ctx.fx.stop(7)
    this.ctx.fx.shake(0.3)
    this.ctx.fx.flash(SIDE[o.winner].main, 0.3)
    o.line.forEach((i, k) => {
      const p = cellCenter(GEO, i % COLS, Math.floor(i / COLS))
      this.ctx.fx.burst(p.x, p.y, C.yellow, {
        count: 10 + k * 2,
        speed: 420,
        size: 10,
        life: 0.6,
        kind: 'spark',
      })
      this.ctx.fx.burst(p.x, p.y, SIDE[o.winner].main, { count: 10, speed: 360, size: 12 })
    })
    const mid = cellCenter(
      GEO,
      (o.line[1] as number) % COLS,
      Math.floor((o.line[1] as number) / COLS),
    )
    this.ctx.fx.ring(mid.x, mid.y, C.yellow, 360)
    if (decided !== null) {
      this.ctx.fx.confetti(decided)
      this.finish(decided, { score: s.wins, delay: 2.4 })
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.hold = null
  }

  render(g: Draw): void {
    const s = this.s
    const live = s.endedAt < 0 && s.falling < 0 && s.spillAt < 0
    const thinking = this.isBot(s.turn)
    tableBackdrop(g)
    renderBoard(
      g,
      s,
      GEO,
      this.time,
      live && !this.over
        ? {
            side: s.turn,
            x: s.aimX >= 0 ? s.aimX : hoverX(GEO, this.time, thinking),
            since: s.turnAt,
            // The landing ghost is the holder's own guide: not drawn on the rival's phone.
            ghost: s.aimX >= 0 && (g.viewer === null || g.viewer === s.turn),
          }
        : null,
    )
    this.drawTurns(g, undefined, live)
    if (this.target > 1) {
      pips(g, 0, s.wins[0], this.target, { inset: 170 })
      pips(g, 1, s.wins[1], this.target, { inset: 170 })
    }
    if (s.roundText && s.endedAt >= 0) {
      const a = Math.min(1, (this.time - s.endedAt - 0.15) * 4)
      notice(g, s.roundText, a)
    } else if (this.over && s.line) {
      const w = s.cells[s.line[0] as number] as Side
      const a = Math.min(1, (this.time - s.endedAt - 0.4) * 4)
      notice(g, `${this.ctx.names[w]} wins the match`, a, C.yellow)
    }
    const since = this.time - s.roundAt
    if (s.round > 1 && since < 1.3 && s.endedAt < 0) {
      const a = Math.min(1, since * 6, (1.3 - since) * 4)
      notice(g, `Round ${s.round} · ${this.ctx.names[s.starter]} starts`, a)
    }
  }
}

export default () => new FourInARow()
