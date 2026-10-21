import { type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import { fmtTime, newRace, PuzzleRace, type RaceBase, toWorld } from '../../engines/puzzle/index.ts'
import { nextMove, PACE } from './bot.ts'
import { celebrate, panelCard } from './ending.ts'
import {
  backdrop,
  cellAt,
  cellCenter,
  drawAdd,
  drawBoard,
  geometry,
  type Hit,
  inButton,
  type Shift,
} from './render.ts'
import {
  addRest,
  ADDS,
  anyPair,
  CAPACITY,
  canPair,
  COLS,
  cross,
  left,
  START,
  startNumbers,
} from './rules.ts'

interface Board {
  /** Digits in rows of nine; 0 is a crossed-out cell. */
  vals: number[]
  /** The first number of a pair being chosen, or -1. */
  sel: number
  /** Adds used so far, where the last copy starts and when (for the pop-in), and the last press. */
  adds: number
  addFrom: number
  addAt: number
  pressAt: number
  /** The last invalid second tap (for the wobble). */
  bad: number
  badAt: number
  /** The last pair crossed out and the rows that collapsed, for their animations. */
  hit: Hit | null
  shift: Shift | null
  /** No pair on the board (the Add button calls), and no Add left either (out of moves). */
  noPair: boolean
  stuck: boolean
  stuckAt: number
  botT: number
}

export interface State extends RaceBase {
  boards: [Board, Board]
  /** When the race was decided (for the cards), or -1. */
  endAt: number
}

/** Seconds of play before the cap decides by what is left (the players choose it). */
export const match: MatchSpec = { unit: 'seconds', default: 180, min: 60, max: 600, step: 60 }

class NumberMatch extends PuzzleRace<State> {
  protected recordId = 'number-match'

  protected setup(): State {
    this.cap = this.ctx.target || match.default
    const start = startNumbers(this.ctx.seed)
    const noPair = !anyPair(start)
    const board = (): Board => ({
      vals: start.slice(),
      sel: -1,
      adds: 0,
      addFrom: 0,
      addAt: -0.4,
      pressAt: -10,
      bad: -1,
      badAt: -10,
      hit: null,
      shift: null,
      noPair,
      stuck: false,
      stuckAt: -1,
      botT: 0,
    })
    return { race: newRace(), boards: [board(), board()], endAt: -1 }
  }

  /**
   * Fewer numbers left is more progress: 0 at the opening count, 1 when clear.
   * A board grown past its opening count goes below 0, so the cap still ranks
   * it by what is left (the bar just stays empty).
   */
  protected progressOf(side: Side): number {
    const n = left(this.s.boards[side].vals)
    return n <= START ? (START - n) / START : -(n - START) / CAPACITY
  }

  protected override step(dt: number): void {
    super.step(dt)
    // Everyone out of moves: no need to wait for the cap.
    if (
      !this.over &&
      this.sides().every((s) => this.s.boards[s].stuck || this.s.race[s].done !== null)
    ) {
      const [a, b] = this.s.race
      const winner = this.solo
        ? 0
        : a.progress === b.progress
          ? 'draw'
          : a.progress > b.progress
            ? 0
            : 1
      this.finish(winner, { note: 'No moves left', delay: 2 })
    }
    if (this.over && this.s.endAt < 0) this.ended()
  }

  /** The race was decided by the cap or by running out of moves: crown the side with fewest left. */
  private ended(): void {
    this.s.endAt = this.time
    if (this.solo) {
      this.ctx.audio.play('whoosh')
      return
    }
    const [a, b] = this.s.race
    if (a.progress === b.progress) return
    const w: Side = a.progress > b.progress ? 0 : 1
    celebrate(this.ctx.fx, this.frames[w], w)
  }

  protected override complete(side: Side): void {
    if (this.over) return
    this.s.endAt = this.time
    celebrate(this.ctx.fx, this.frames[side], side)
    super.complete(side)
  }

  private geo(side: Side) {
    const f = this.frames[side]
    return geometry(f.w, f.h, this.s.boards[side].vals.length)
  }

  protected stepSide(side: Side, dt: number, taps: { x: number; y: number }[]): void {
    const b = this.s.boards[side]
    if (b.stuck) return
    if (this.isBot(side)) {
      b.botT += dt
      if (b.botT < PACE[this.ctx.difficulty]) return
      b.botT = 0
      const m = nextMove(b.vals, ADDS - b.adds, this.ctx.difficulty, this.ctx.rng)
      if (!m) return
      if (m.kind === 'add') this.add(side)
      else this.cross(side, m.i, m.j)
      return
    }
    for (const t of taps) {
      const geo = this.geo(side)
      if (inButton(geo, t.x, t.y)) {
        this.add(side)
      } else {
        const i = cellAt(geo, b.vals.length, t.x, t.y)
        if (i >= 0 && b.vals[i]) this.choose(side, i)
      }
      if (this.over || b.stuck) return
    }
  }

  /** First tap picks a number; a second tap on a partner crosses both out; anything else re-picks. */
  private choose(side: Side, i: number): void {
    const b = this.s.boards[side]
    if (b.sel < 0) {
      b.sel = i
      this.ctx.audio.play('tick', 1.1)
      return
    }
    if (i === b.sel) {
      b.sel = -1
      this.ctx.audio.play('click', 0.8)
      return
    }
    if (canPair(b.vals, b.sel, i)) {
      this.cross(side, b.sel, i)
      return
    }
    b.bad = i
    b.badAt = this.time
    b.sel = i
    this.ctx.audio.play('error', 1.3)
    this.ctx.audio.buzz(15)
  }

  /** Cross out a pair (both cells are valid), collapse empty rows and check for the end. */
  private cross(side: Side, i: number, j: number): void {
    const b = this.s.boards[side]
    const f = this.frames[side]
    const geo = this.geo(side)
    const ci = cellCenter(geo, i)
    const cj = cellCenter(geo, j)
    const a = toWorld(f, ci.x, ci.y)
    const c = toWorld(f, cj.x, cj.y)
    const da = b.vals[i] ?? 0
    const db = b.vals[j] ?? 0
    const r = cross(b.vals, i, j)
    b.vals = r.vals
    b.sel = -1
    b.hit = {
      ax: ci.x,
      ay: ci.y,
      bx: cj.x,
      by: cj.y,
      a: da,
      b: db,
      size: geo.p - 10,
      at: this.time,
    }
    b.shift = r.rows ? { rows: r.removed, p: geo.p, at: this.time } : b.shift
    // Rows that collapsed move the newest copy up with them.
    b.addFrom = Math.max(0, b.addFrom - r.rows * COLS)
    const pitch = 0.9 + Math.min(0.5, (START - left(b.vals)) * 0.012)
    this.ctx.audio.play('pop', pitch)
    this.ctx.fx.burst(a.x, a.y, SIDE[side].light, { count: 10, speed: 320, size: 9, life: 0.4 })
    this.ctx.fx.burst(c.x, c.y, C.yellow, { count: 10, speed: 320, size: 9, life: 0.4 })
    if (r.rows) {
      const mid = toWorld(f, (ci.x + cj.x) / 2, (ci.y + cj.y) / 2)
      this.ctx.audio.play('score', 1.05 + r.rows * 0.1)
      this.ctx.fx.float(r.rows > 1 ? `Rows ×${r.rows}` : 'Row!', mid.x, mid.y, C.yellow, 60, side)
      this.ctx.fx.ring(mid.x, mid.y, C.yellow, 200)
      this.ctx.fx.shake(0.12 + r.rows * 0.06)
      for (const rm of r.removed) {
        const y = geo.y0 + (rm + 0.5) * geo.p
        for (let x = 0; x < COLS; x += 2) {
          const w = toWorld(f, geo.x0 + (x + 0.5) * geo.p, y)
          this.ctx.fx.sparks(w.x, w.y, C.yellow, 3)
        }
      }
    }
    this.check(side)
    if (left(b.vals) === 0) this.complete(side)
  }

  /** Refresh whether a side has a pair left, and whether it is out of moves for good. */
  private check(side: Side): void {
    const b = this.s.boards[side]
    b.noPair = left(b.vals) > 0 && !anyPair(b.vals)
    const wasStuck = b.stuck
    b.stuck = b.noPair && b.adds >= ADDS
    if (b.stuck && !wasStuck) {
      b.stuckAt = this.time
      this.ctx.audio.play('lose', 1.1)
      this.ctx.fx.shake(0.25)
    }
  }

  /** Copy the numbers left after the last one (up to ADDS times). */
  private add(side: Side): void {
    const b = this.s.boards[side]
    if (b.adds >= ADDS || this.over || left(b.vals) === 0) {
      this.ctx.audio.play('error')
      return
    }
    const r = addRest(b.vals)
    b.vals = r.vals
    b.addFrom = r.from
    b.adds++
    b.addAt = this.time
    b.pressAt = this.time
    b.sel = -1
    const f = this.frames[side]
    const geo = this.geo(side)
    const bc = toWorld(f, geo.btn.x + geo.btn.w / 2, geo.btn.y + geo.btn.h / 2)
    this.ctx.audio.play('whoosh')
    this.ctx.audio.play('powerup', 1.1)
    this.ctx.fx.burst(bc.x, bc.y, C.yellow, { count: 14, speed: 380, size: 9, life: 0.4 })
    this.check(side)
  }

  protected renderPanel(g: Draw, side: Side, w: number, h: number): void {
    const b = this.s.boards[side]
    const geo = geometry(w, h, b.vals.length)
    backdrop(g, side, geo, Math.ceil(b.vals.length / COLS))
    const partner = b.sel >= 0 ? b.vals.map((_, i) => canPair(b.vals, b.sel, i)) : []
    drawBoard(g, geo, {
      side,
      vals: b.vals,
      sel: b.sel,
      partner,
      bad: b.bad,
      badAt: b.badAt,
      addFrom: b.addFrom,
      addAt: b.addAt,
      hit: b.hit,
      shift: b.shift,
      now: this.time,
    })
    drawAdd(g, geo, side, b.adds, { stuck: b.noPair, now: this.time, pressAt: b.pressAt })
    if (b.sel < 0 && b.adds === 0 && this.time < 7 && !this.isBot(side) && !b.hit) {
      g.text('Tap two that match or make 10', w / 2, geo.btn.y - 36, {
        size: 34,
        weight: 600,
        color: alpha(C.white, 0.9),
        stroke: alpha(C.ink, 0.7),
        strokeWidth: 8,
      })
    }
    this.cards(g, side, w, h)
  }

  /** Out of moves while the rival plays on, or the end of the race by count. */
  private cards(g: Draw, side: Side, w: number, h: number): void {
    const s = this.s
    const b = s.boards[side]
    const n = left(b.vals)
    const count = `${n} number${n === 1 ? '' : 's'} left`
    if (s.race[side].done !== null) return
    if (s.endAt < 0) {
      if (b.stuck)
        panelCard(g, side, w, h, this.time, b.stuckAt, {
          title: 'No moves',
          sub: count,
          win: false,
        })
      return
    }
    if (this.solo) {
      // Out of moves ends the solo run at once; only the cap reads "Time!".
      panelCard(g, side, w, h, this.time, s.endAt, {
        title: b.stuck ? 'No moves' : 'Time!',
        sub: count,
        win: false,
      })
      return
    }
    const o = other(side)
    if (s.race[o].done !== null) {
      panelCard(g, side, w, h, this.time, s.endAt, {
        title: `${this.ctx.names[o]} wins`,
        sub: `Cleared in ${fmtTime(this.elapsed(o))}`,
        win: false,
      })
      return
    }
    const mine = s.race[side].progress
    const theirs = s.race[o].progress
    panelCard(g, side, w, h, this.time, s.endAt, {
      title:
        mine === theirs ? 'Draw' : mine > theirs ? 'Fewest left!' : `${this.ctx.names[o]} wins`,
      sub: count,
      win: mine > theirs,
    })
  }
}

export default () => new NumberMatch()
