import { frame, toLocal } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { tableBackdrop } from '../../engines/board/index.ts'
import { type CardRect, cardAt } from '../../engines/cards/index.ts'
import { botTriple, spotDelay, TAP_GAP } from './bot.ts'
import { renderTriple, tableGrid } from './render.ts'
import { type Board, DECK_SIZE, findSets, newBoard, TARGET, tapSlot, winner } from './rules.ts'

/** Match length: first to N points. */
export const match: MatchSpec = { unit: 'points', default: TARGET, min: 3, max: 15 }

export interface State extends Board {
  /** Game time each slot's card lands (it flips in from then), for the deal animation. */
  placedAt: number[]
  /** The last triple taken, for the cards flying to the scorer. `n` = table size then. */
  took: { side: Side; slots: number[]; ids: number[]; n: number; at: number } | null
  /** The last wrong triple, for the shake. */
  bad: { side: Side; slots: number[]; at: number } | null
  /** Game time each side last scored, for the score bump. */
  scoredAt: [number, number]
  /** When the game was decided (-1 = still on). */
  endAt: number
}

const centre = (rects: CardRect[]): { x: number; y: number } => ({
  x: rects.reduce((a, r) => a + r.x, 0) / Math.max(1, rects.length),
  y: rects.reduce((a, r) => a + r.y, 0) / Math.max(1, rects.length),
})

/**
 * Triple: twelve cards on a shared table, each with four traits. Either side
 * taps three cards; a real triple scores, a wrong one costs a point and a short
 * lockout. Whenever the table holds no triple, three more cards are dealt.
 * Each player taps their own copy of the table, in their half.
 */
class Triple extends BaseGame<State> {
  /** Computer: slots still to tap for the triple it is working on, and the card ids it expects there. */
  private plan: [number[], number[]] = [[], []]
  private ids: [number[], number[]] = [[], []]
  /** Computer: seconds until it next acts (-1 = not searching). */
  private clock: [number, number] = [-1, -1]
  private dealt = 0

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const deck = this.ctx.rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i))
    const b = newBoard(deck)
    return {
      ...b,
      placedAt: b.table.map((_, i) => 0.25 + i * 0.07),
      took: null,
      bad: null,
      scoredAt: [-10, -10],
      endAt: -1,
    }
  }

  protected step(dt: number): void {
    const s = this.s
    // Deal sounds for the opening flip-in.
    while (this.dealt < s.placedAt.length && this.time >= (s.placedAt[this.dealt] ?? 0)) {
      if (this.time < 3) this.ctx.audio.play('flip', 0.9 + this.dealt * 0.03)
      this.dealt++
    }
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side)) {
        this.botStep(side, dt)
        continue
      }
      const grid = tableGrid(s.table.length)
      for (const p of this.ctx.input.player(side).downs) {
        if (this.over) return
        const l = toLocal(side, p.x, p.y)
        const i = cardAt(grid, l.x, l.y)
        if (i >= 0) this.tap(side, i)
      }
    }
  }

  private tap(side: Side, slot: number): void {
    const s = this.s
    const fx = this.ctx.fx
    const n = s.table.length
    const before = tableGrid(n)
    // Effects land on the tapper's own copy of the table.
    const at = (i: number): CardRect => {
      const c = before[i] ?? { x: 500, y: 1300, w: 0, h: 0 }
      return { ...c, ...frame(side, c.x, c.y) }
    }
    const prev = [...s.table]
    const r = tapSlot(s, side, slot, this.time)
    switch (r.kind) {
      case 'ignored':
        if (!this.isBot(side) && s.lockUntil[side] > this.time) this.ctx.audio.play('error')
        return
      case 'select':
        this.ctx.audio.play('pop', 1 + s.sel[side].length * 0.12)
        this.ctx.audio.buzz(5)
        return
      case 'deselect':
        this.ctx.audio.play('tap', 0.85)
        return
      case 'invalid': {
        s.bad = { side, slots: r.slots, at: this.time }
        for (const i of r.slots) {
          const c = at(i)
          fx.puff(c.x, c.y, 'rgba(255,120,120,0.5)', 6)
        }
        const c = centre(r.slots.map(at))
        fx.float('-1', c.x, c.y + (side === 0 ? -170 : 170), C.redLight, 90, side)
        fx.shake(0.35)
        fx.flash(C.red, 0.15)
        fx.stop(3)
        this.ctx.audio.play('buzz')
        this.ctx.audio.buzz(40)
        return
      }
      case 'valid': {
        s.took = {
          side,
          slots: r.slots,
          ids: r.slots.map((i) => prev[i] ?? -1),
          n,
          at: this.time,
        }
        s.scoredAt[side] = this.time
        for (const i of r.slots) {
          const c = at(i)
          fx.burst(c.x, c.y, SIDE[side].main, { count: 18, speed: 480, size: 12 })
          fx.sparks(c.x, c.y, C.yellow, 8)
        }
        const c = centre(r.slots.map(at))
        fx.ring(c.x, c.y, SIDE[side].light, 260)
        fx.stop(4)
        fx.shake(0.18)
        fx.flash(SIDE[side].light, 0.12)
        // A point closer to the target lands harder: the last points ring out.
        const k = Math.min(1, s.score[side] / this.target)
        this.ctx.audio.play('coin', 0.9 + k * 0.3)
        this.ctx.audio.play('whoosh', 1.2)
        this.ctx.audio.buzz(Math.round(15 + k * 20))
        if (r.moved) {
          // The table closed up: cards that changed slot flip back in at their new place.
          const was = s.placedAt
          s.placedAt = r.moved.map((old, i) => (old === i ? (was[old] ?? 0) : this.time + 0.35))
        } else {
          // The replacements flip in once the old cards have left.
          for (const i of r.slots) s.placedAt[i] = this.time + 0.4
        }
        s.placedAt.length = Math.min(s.placedAt.length, s.table.length)
        while (s.placedAt.length < s.table.length) s.placedAt.push(this.time + 0.6)
        if (r.added.length) {
          for (const i of r.added) s.placedAt[i] = this.time + 0.7 + (i % 3) * 0.08
          for (const f of [0, 1] as Side[]) {
            const p = frame(f, 500, 1300)
            fx.float('No triple: +3 cards', p.x, p.y, C.yellow, 48, f)
          }
          this.ctx.audio.play('slide', 1.1)
        }
        const w = winner(s, this.target)
        if (w === null) fx.float('Triple!', c.x, c.y, SIDE[side].light, 80, side)
        if (w !== null) {
          s.endAt = this.time
          fx.stop(10)
          fx.shake(0.4)
          if (w !== 'draw') {
            fx.flash(SIDE[w].light, 0.35)
            fx.confetti(w)
          } else fx.confetti()
          this.finish(w, { score: [s.score[0], s.score[1]], delay: 2.3 })
        }
        return
      }
    }
  }

  /** The computer searches for a triple after a difficulty delay, then taps its three cards one by one. */
  private botStep(side: Side, dt: number): void {
    const s = this.s
    if (this.clock[side] < 0)
      this.clock[side] = spotDelay(this.ctx.difficulty, this.ctx.rng, findSets(s.table).length)
    this.clock[side] -= dt
    if (this.clock[side] > 0) return
    const plan = this.plan[side]
    if (plan.length === 0) {
      if (this.time < s.lockUntil[side]) return
      const t = botTriple(s.table, this.ctx.difficulty, this.ctx.rng)
      if (!t) {
        this.clock[side] = 0.5
        return
      }
      this.plan[side] = [...t]
      this.ids[side] = t.map((i) => s.table[i] ?? -1)
      this.clock[side] = 0.35
      return
    }
    const slot = plan[0] as number
    if (s.table[slot] !== this.ids[side][0] || this.time < (s.placedAt[slot] ?? 0)) {
      // The cards changed under it (the rival took them): start over.
      s.sel[side] = []
      this.plan[side] = []
      this.ids[side] = []
      this.clock[side] = -1
      return
    }
    plan.shift()
    this.ids[side].shift()
    this.tap(side, slot)
    const [lo, hi] = TAP_GAP[this.ctx.difficulty]
    this.clock[side] = plan.length ? this.ctx.rng.range(lo, hi) : -1
  }

  /** Pill text: locked countdown, how many picked, or the outcome. */
  private label(side: Side): string | undefined {
    const s = this.s
    if (s.endAt >= 0) {
      const o = other(side)
      return s.score[side] > s.score[o]
        ? 'Winner!'
        : s.score[side] === s.score[o]
          ? 'Draw'
          : undefined
    }
    const left = s.lockUntil[side] - this.time
    if (left > 0) return `Locked ${Math.ceil(left)}`
    const n = s.sel[side].length
    if (n > 0) return `${n} of 3`
    if (this.isBot(side)) return 'Looking…'
    return this.time < 6 ? 'Find a triple!' : undefined
  }

  render(g: Draw): void {
    tableBackdrop(g)
    renderTriple(g, this.s, this.time, this.ctx.names, (side) => this.label(side), this.target)
  }
}

export default () => new Triple()
