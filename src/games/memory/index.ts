import { other, type Side } from '../../core/game.ts'
import { bigScore } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import { tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { cardAt, dealPairs, GLYPHS } from '../../engines/cards/index.ts'
import { choose, type Memory, remember } from './bot.ts'
import { backdropGlow, CARDS, renderCards } from './render.ts'
import {
  cleared,
  hideMiss,
  PAIRS,
  pairsOf,
  type Table,
  newTable,
  turnUp,
  canTurn,
} from './rules.ts'

export interface State {
  turn: Side
  table: Table
  glyphs: string[]
  /** Game time each card last turned, for the flip animation. */
  flippedAt: number[]
  matchedAt: number[]
  /** When a missed pair turns back down (-1 = none pending). */
  resolveAt: number
  /** What the computer remembers (only used when a side is a bot). */
  seen: Memory
}

class MemoryGame extends TurnGame<State> {
  protected setup(): State {
    const rng = this.ctx.rng
    const sets = Object.values(GLYPHS)
    const glyphs = rng.shuffle([...rng.pick(sets)]).slice(0, PAIRS)
    const table = newTable(dealPairs(rng, PAIRS))
    return {
      turn: rng.chance(0.5) ? 0 : 1,
      table,
      glyphs,
      flippedAt: table.deck.map(() => -10),
      matchedAt: table.deck.map(() => -10),
      resolveAt: -1,
      seen: table.deck.map(() => null),
    }
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.resolveAt < 0) return false
    if (this.time >= s.resolveAt) {
      for (const i of s.table.up) s.flippedAt[i] = this.time
      hideMiss(s.table)
      s.resolveAt = -1
      s.turn = other(s.turn)
      this.ctx.audio.play('flip', 0.8)
      return false
    }
    return true
  }

  protected override botDelay(): number {
    // The second card comes quicker: the computer already "looked".
    return this.s.table.up.length === 1 ? 0.55 : super.botDelay()
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const i = cardAt(CARDS, tap.x, tap.y)
    if (i < 0) return
    if (!canTurn(this.s.table, i)) return
    this.turn(i)
  }

  protected botPlay(): void {
    this.turn(choose(this.s.table, this.s.seen, this.ctx.rng))
  }

  private turn(i: number): void {
    const s = this.s
    const side = s.turn
    const result = turnUp(s.table, i, side)
    s.flippedAt[i] = this.time
    this.ctx.audio.play('flip', 1 + this.ctx.rng.range(-0.08, 0.08))
    if (this.ctx.bots[0] || this.ctx.bots[1]) {
      remember(s.seen, i, s.table.deck[i] ?? 0, this.ctx.difficulty, this.ctx.rng)
    }
    if (result === 'match') {
      const fx = this.ctx.fx
      const [a, b] = [i, s.table.deck.findIndex((d, k) => k !== i && d === s.table.deck[i])]
      for (const k of [a, b]) {
        s.matchedAt[k] = this.time + 0.25
        const c = CARDS[k]
        if (c) fx.burst(c.x, c.y, SIDE[side].main, { count: 14, speed: 420, size: 12 })
      }
      const c = CARDS[i]
      if (c) fx.float('Pair!', c.x, c.y - c.h * 0.4, SIDE[side].light, 56, side)
      this.ctx.audio.play('score')
      fx.shake(0.12)
      if (cleared(s.table)) {
        const r = pairsOf(s.table, 0)
        const bl = pairsOf(s.table, 1)
        this.finish(r === bl ? 'draw' : r > bl ? 0 : 1, { score: [r, bl], delay: 1.4 })
      }
    } else if (result === 'miss') {
      s.resolveAt = this.time + 1.05
      this.ctx.audio.play('tap', 0.7)
    }
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    backdropGlow(g)
    renderCards(g, s, this.time)
    this.drawTurns(g, undefined, s.resolveAt < 0)
    bigScore(g, 0, pairsOf(s.table, 0))
    bigScore(g, 1, pairsOf(s.table, 1))
  }
}

export default () => new MemoryGame()
