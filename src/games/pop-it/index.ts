import { other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { banner } from '../../core/hud.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import {
  backdrop,
  bubbleAt,
  bubbleCenter,
  countChip,
  doneButton,
  doneRect,
  drawTray,
  refillTime,
  ROW_COLORS,
  TRAY,
  inRect,
} from './render.ts'
import {
  BUBBLES,
  bubblesLeft,
  canPop,
  heapsOf,
  type Move,
  popBubble,
  ROWS,
  rowOf,
} from './rules.ts'

export interface State {
  turn: Side
  /** Per bubble: popped or still whole. */
  popped: boolean[]
  /** Game time each bubble was popped, or -10. */
  poppedAt: number[]
  /** The row this turn is locked to (its first pop), or -1. */
  lock: number
  /** Bubbles popped this turn. Done needs at least one. */
  pops: number
  /** Game time the turn started (the Done key pops in) and Done was last pressed. */
  turnAt: number
  doneAt: number
  /** Game time the last bubble went, or -1. Then the whole board springs back up. */
  endAt: number
}

class PopIt extends TurnGame<State> {
  /** The computer's plan for its turn (host only; never part of the shared state). */
  private plan: { row: number; left: number } | null = null

  protected setup(): State {
    // On the shared tray a touch belongs to whoever's turn it is, whichever half it came from.
    this.ctx.input.assign = (x, y) => {
      if (inRect(x, y, TRAY)) return this.s.turn
      return y >= MID ? 0 : 1
    }
    return {
      turn: this.ctx.rng.chance(0.5) ? 0 : 1,
      popped: Array<boolean>(BUBBLES).fill(false),
      poppedAt: Array<number>(BUBBLES).fill(-10),
      lock: -1,
      pops: 0,
      turnAt: 0,
      doneAt: -10,
      endAt: -1,
    }
  }

  protected override botDelay(): number {
    const r = this.ctx.rng
    // Pops come quickly; the first look at the board takes a moment.
    return this.plan ? 0.42 + r.range(0, 0.25) : 0.9 + r.range(0, 0.35)
  }

  protected stepTurn(_dt: number, _tap: Ptr | undefined): void {
    const side = this.s.turn
    const inp = this.ctx.input.player(side)
    for (const p of inp.downs) {
      if (!inRect(p.x, p.y, doneRect(side))) continue
      if (this.s.pops > 0) this.commit()
      else this.ctx.audio.play('error')
      return
    }
    for (const p of inp.downs) {
      if (this.over) return
      const i = bubbleAt(p.x, p.y)
      if (i === null) continue
      if (!canPop(this.s.popped, i, this.s.lock)) {
        this.ctx.audio.play('error')
        if (!this.s.popped[i]) {
          const c = bubbleCenter(i)
          this.ctx.fx.float('One row!', c.x, c.y - 40, C.white, 50, side)
        }
        continue
      }
      this.pop(i)
    }
  }

  protected botPlay(): void {
    const s = this.s
    if (!this.plan) {
      const move: Move = choose(heapsOf(s.popped), this.ctx.difficulty, this.ctx.rng)
      this.plan = { row: move.row, left: move.count }
    }
    if (this.plan.left > 0) {
      const open: number[] = []
      for (let i = 0; i < BUBBLES; i++) {
        if (canPop(s.popped, i, s.lock) && rowOf(i) === this.plan.row) open.push(i)
      }
      const i = this.ctx.rng.pick(open)
      this.plan.left--
      this.pop(i)
      return
    }
    this.plan = null
    this.commit()
  }

  private pop(i: number): void {
    const s = this.s
    const side = s.turn
    s.popped = popBubble(s.popped, i)
    s.poppedAt[i] = this.time
    if (s.lock < 0) s.lock = rowOf(i)
    s.pops++
    const { x, y } = bubbleCenter(i)
    const fx = this.ctx.fx
    const color = ROW_COLORS[rowOf(i)] ?? C.white
    fx.burst(x, y, color, { count: 12, speed: 360, size: 11, life: 0.45, gravity: 300 })
    fx.burst(x, y, C.white, { count: 5, speed: 260, size: 6, life: 0.3, kind: 'spark' })
    fx.shake(0.06)
    // Each row has its own note, and each pop in a turn climbs a little higher.
    this.ctx.audio.play('pop', 0.8 + (ROWS - 1 - rowOf(i)) * 0.07 + s.pops * 0.03)
    if (bubblesLeft(s.popped) > 0) return
    // The last bubble: whoever pops it loses. Make the moment land, then the board springs back.
    const winner = other(side)
    s.endAt = this.time
    fx.shake(0.8)
    fx.stop(8)
    fx.ring(x, y, C.white, 260)
    fx.burst(x, y, color, { count: 30, speed: 700, size: 14, life: 0.8 })
    fx.flash(SIDE[winner].main, 0.3)
    fx.confetti(winner)
    this.ctx.audio.play('thud')
    this.finish(winner, {
      note: `${this.ctx.names[side]} popped the last bubble`,
      delay: 3,
    })
  }

  /** The refill wave after the end: a pop and a puff as each row springs back up (host-side sound). */
  private refilled = 0
  protected override afterEnd(_dt: number): void {
    const s = this.s
    if (s.endAt < 0) return
    while (this.refilled < ROWS) {
      const first = (this.refilled * BUBBLES) / ROWS
      if (this.time - s.endAt < refillTime(first)) break
      const row = this.refilled++
      const c = bubbleCenter(first + 2)
      const color = ROW_COLORS[row] ?? C.white
      this.ctx.fx.burst(c.x + 58, c.y, color, {
        count: 10,
        speed: 300,
        size: 10,
        life: 0.4,
        gravity: 200,
      })
      this.ctx.audio.play('boing', 0.9 + (ROWS - 1 - row) * 0.08)
    }
  }

  /** Done: the turn passes to the other player with a fresh row choice. */
  private commit(): void {
    const s = this.s
    const side = s.turn
    s.doneAt = this.time
    const r = doneRect(side)
    this.ctx.fx.ring(r.x + r.w / 2, r.y + r.h / 2, SIDE[side].main, 200)
    s.turn = other(side)
    s.turnAt = this.time
    s.lock = -1
    s.pops = 0
    this.ctx.audio.play('click', side === 0 ? 1 : 1.1)
    this.ctx.audio.play('whoosh', 1.2)
  }

  render(g: Draw): void {
    const s = this.s
    const now = this.time
    backdrop(g)
    drawTray(g, s, now)
    const left = bubblesLeft(s.popped)
    if (!this.over) {
      const side = s.turn
      // The Done key of the player who just finished stays a moment, pressed in.
      const prev = other(side)
      if (now - s.doneAt < 0.3) doneButton(g, prev, { pops: 1, now, turnAt: -10, doneAt: s.doneAt })
      doneButton(g, side, { pops: s.pops, now, turnAt: s.turnAt, doneAt: -10 })
    }
    this.drawTurns(g, undefined, !this.over)
    if (this.ctx.mode === '2p') {
      countChip(g, left, now, 0)
      countChip(g, left, now, 1)
    } else countChip(g, left, now, this.ctx.mode === 'online' ? this.ctx.local : undefined)
    if (s.endAt >= 0) {
      const a =
        Math.min(1, (now - s.endAt) * 4) * (1 - Math.max(0, Math.min(1, (now - s.endAt - 2.2) * 3)))
      const who = this.ctx.names[s.turn]
      const text = `${who} popped the last one!`
      // A long name (up to 12 letters, some of them wide) shrinks the line so it fits the table.
      const size = Math.min(54, (54 * 860) / g.measure(text, 54, 700))
      banner(g, undefined, text, MID, {
        size,
        alpha: a,
        color: C.yellow,
        gap: 120,
      })
    }
  }
}

export default () => new PopIt()
