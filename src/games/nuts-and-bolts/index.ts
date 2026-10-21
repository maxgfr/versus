import { other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C } from '../../core/render/palette.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { nextTap, PACE } from './bot.ts'
import { celebrate, panelCard } from './ending.ts'
import {
  backdrop,
  boltAt,
  drawBolts,
  geometry,
  type Hand,
  hoverY,
  type Move,
  MOVE_T,
  NUT_COLOURS,
  nutY,
  place,
} from './render.ts'
import { buildPuzzle, CAP, isSolved, misplaced, SWAPS, topRun } from './rules.ts'

interface Board {
  /** Bolts bottom to top, each a list of nut colours. */
  bolts: number[][]
  /** The top run lifted off a bolt (and when, for the spin up). Null when the hand is empty. */
  hand: Hand | null
  /** The last drop, for the flight and screw-down. */
  move: Move | null
  /** Per bolt: when it was completed, for the glint and badge. */
  capAt: number[]
  /** The computer's place in its plan, and its pace timer. */
  idx: number
  botT: number
  /** The last refused tap (for the wobble). */
  bad: number
  badAt: number
  moves: number
  /** When the last nut was dropped on a solved board: the win lands once it has screwed down. */
  solvedAt: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
  /** When the race was decided (for the cards), or -1. */
  endAt: number
}

/** Can a bolt take a nut of colour c on top? */
function accepts(bolts: readonly (readonly number[])[], i: number, c: number): boolean {
  const b = bolts[i] ?? []
  return b.length < CAP && (b.length === 0 || b[b.length - 1] === c)
}

const full = (b: readonly number[]) => b.length === CAP && b.every((c) => c === b[0])

class NutsAndBolts extends PuzzleRace<State> {
  protected recordId = 'nuts-and-bolts'
  // Derived from the seed on both phones: never sent over the wire.
  private plan: [number, number][] = []
  private start = 1
  /** Cosmetic effects timed to land with an animation (host side; the guest gets them replayed). */
  private later: { at: number; fn: () => void }[] = []

  protected setup(): State {
    const p = buildPuzzle(this.ctx.seed, SWAPS[this.ctx.difficulty])
    this.plan = p.plan
    this.start = Math.max(1, misplaced(p.start))
    const board = (): Board => ({
      bolts: p.start.map((b) => b.slice()),
      hand: null,
      move: null,
      capAt: p.start.map((b) => (full(b) ? 0.01 : -10)),
      idx: 0,
      botT: 0,
      bad: -1,
      badAt: -10,
      moves: 0,
      solvedAt: -1,
    })
    return { race: newRace(), boards: [board(), board()], endAt: -1 }
  }

  /** Share of the scramble undone: 0 at the start, 1 when sorted. */
  protected progressOf(side: Side): number {
    const m = misplaced(this.s.boards[side].bolts)
    return Math.max(0, Math.min(1, 1 - m / this.start))
  }

  protected override step(dt: number): void {
    this.flush()
    super.step(dt)
  }

  protected override afterEnd(_dt: number): void {
    this.flush()
  }

  private flush(): void {
    if (!this.later.length) return
    const due = this.later.filter((l) => l.at <= this.time)
    this.later = this.later.filter((l) => l.at > this.time)
    for (const l of due) l.fn()
  }

  protected override complete(side: Side): void {
    if (this.over) return
    this.s.endAt = this.time
    celebrate(this.ctx.fx, this.frames[side], side)
    super.complete(side)
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    if (b.solvedAt >= 0) {
      // The last run is still screwing down: the win lands with it.
      if (this.time >= b.solvedAt + MOVE_T) this.complete(side)
      return
    }
    if (this.isBot(side)) {
      b.botT += dt
      if (b.botT < PACE[this.ctx.difficulty]) return
      b.botT = 0
      const t = nextTap(this.plan, b.idx, b.hand !== null)
      if (!t) return
      const dropping = b.hand !== null
      this.tap(side, t.bolt)
      if (dropping && b.hand === null) b.idx++
      return
    }
    const f = this.frames[side]
    const geo = geometry(f.w, f.h)
    for (const t of taps) {
      const i = boltAt(geo, b.bolts.length, t.x, t.y)
      if (i >= 0) this.tap(side, i)
      if (b.solvedAt >= 0) return
    }
  }

  /** First tap lifts the top run of a bolt; the second drops it on a bolt that takes it. */
  private tap(side: Side, i: number): void {
    const b = this.s.boards[side]
    const bolts = b.bolts
    const f = this.frames[side]
    const geo = geometry(f.w, f.h)
    const p = place(geo, i)
    const at = (y: number) => toWorld(f, p.x, y)
    if (!b.hand) {
      const src = bolts[i] ?? []
      if (!src.length) {
        this.refuse(side, i)
        return
      }
      const n = topRun(src)
      const c = src[src.length - 1] ?? 0
      src.splice(src.length - n, n)
      b.hand = { from: i, c, n, at: this.time }
      b.move = null
      if (b.capAt[i] !== undefined) b.capAt[i] = -10
      const w = at(hoverY(geo, p.base, src.length, 0))
      this.ctx.audio.play('roll', 1.15)
      this.ctx.fx.puff(w.x, w.y, alpha(C.white, 0.35), 4)
      return
    }
    const h = b.hand
    if (i === h.from) {
      // Put the run back where it came from.
      for (let k = 0; k < h.n; k++) bolts[i]?.push(h.c)
      b.hand = null
      b.move = { from: i, to: i, c: h.c, n: h.n, back: 0, at: this.time }
      this.ctx.audio.play('click', 0.9)
      this.land(side, i, 0.62)
      return
    }
    if (!accepts(bolts, i, h.c)) {
      this.refuse(side, i)
      return
    }
    const dst = bolts[i] ?? []
    const k = Math.min(h.n, CAP - dst.length)
    for (let m = 0; m < k; m++) dst.push(h.c)
    // Whatever did not fit goes back on the source.
    for (let m = 0; m < h.n - k; m++) bolts[h.from]?.push(h.c)
    b.hand = null
    b.move = { from: h.from, to: i, c: h.c, n: k, back: h.n - k, at: this.time }
    b.moves++
    this.ctx.audio.play('whoosh', 1.2)
    this.land(side, i, MOVE_T)
    if (h.n - k > 0) this.land(side, h.from, MOVE_T * 0.8)
    if (isSolved(bolts)) b.solvedAt = this.time
  }

  /** The thunk of a run landing on bolt i after `delay`, and the celebration if that completes it. */
  private land(side: Side, i: number, delay: number): void {
    const b = this.s.boards[side]
    const stack = b.bolts[i] ?? []
    const f = this.frames[side]
    const geo = geometry(f.w, f.h)
    const p = place(geo, i)
    const top = toWorld(f, p.x, nutY(geo, p.base, Math.max(0, stack.length - 1)))
    const c = stack[stack.length - 1] ?? 0
    const col = NUT_COLOURS[c % NUT_COLOURS.length] ?? C.pink
    const done = full(stack)
    if (done && b.capAt[i] !== undefined) b.capAt[i] = this.time + delay
    this.later.push({
      at: this.time + delay,
      fn: () => {
        this.ctx.audio.play('place', 0.85 + c * 0.05)
        this.ctx.fx.burst(top.x, top.y, col, { count: 8, speed: 240, size: 8, life: 0.35 })
        if (!done) return
        const mid = toWorld(f, p.x, nutY(geo, p.base, 1.5))
        this.ctx.audio.play('score', 1 + this.doneCount(side) * 0.06)
        this.ctx.fx.ring(mid.x, mid.y, col, 190 * geo.k)
        this.ctx.fx.sparks(top.x, top.y, C.yellow, 10)
        this.ctx.fx.shake(0.12)
      },
    })
  }

  private doneCount(side: Side): number {
    return this.s.boards[side].bolts.filter(full).length
  }

  private refuse(side: Side, i: number): void {
    const b = this.s.boards[side]
    b.bad = i
    b.badAt = this.time
    this.ctx.audio.play('error', 1.2)
    this.ctx.audio.buzz(20)
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const geo = geometry(w, h)
    backdrop(g, side, geo, h)
    const hand = b.hand
    drawBolts(g, geo, {
      side,
      bolts: b.bolts,
      hand,
      move: b.move,
      accepts: b.bolts.map(
        (_, i) => hand !== null && i !== hand.from && accepts(b.bolts, i, hand.c),
      ),
      capAt: b.capAt,
      bad: b.bad,
      badAt: b.badAt,
      now: this.time,
    })
    const base = geo.bases[geo.bases.length - 1] ?? h
    if (!hand && b.moves === 0 && this.time < 8 && !this.isBot(side) && this.s.endAt < 0) {
      g.text('Tap a bolt to lift its top nuts, then tap where they go', w / 2, base + 92 * geo.k, {
        size: 34,
        weight: 600,
        color: alpha(C.white, 0.85),
        maxWidth: w - 80,
      })
    }
    // The rival got there first.
    const r = this.s.race
    if (!this.solo && this.s.endAt >= 0 && r[side].done === null) {
      const o = other(side)
      panelCard(g, side, w, h, this.time, this.s.endAt, {
        title: `${this.ctx.names[o]} wins`,
        sub: `Sorted in ${fmtTime(this.elapsed(o))}`,
        win: false,
      })
    }
  }
}

export default () => new NutsAndBolts()
