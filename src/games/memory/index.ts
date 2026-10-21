import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, bigScore, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { cardAt, dealPairs, GLYPHS } from '../../engines/cards/index.ts'
import { choose, type Memory, remember } from './bot.ts'
import { backdropGlow, CARDS, renderCards } from './render.ts'
import {
  canTurn,
  cleared,
  hideMiss,
  matchWinner,
  newTable,
  PAIRS,
  pairsOf,
  type Table,
  turnUp,
} from './rules.ts'

/** Seconds a cleared table stays on screen before the next one is dealt. */
const ROUND_PAUSE = 1.6

/** Match length: first to N round wins, each round one table. Default: a single table. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

export interface State {
  turn: Side
  /** Who started the current round; the other side starts the next. */
  starter: Side
  table: Table
  glyphs: string[]
  /** Game time each card last turned, for the flip animation. */
  flippedAt: number[]
  matchedAt: number[]
  /** When a missed pair turns back down (-1 = none pending). */
  resolveAt: number
  /** What the computer remembers (only used when a side is a bot). */
  seen: Memory
  /** Round wins so far. */
  wins: [number, number]
  /** Game time the table was cleared, or -1 while the round runs. */
  roundAt: number
  /** Banner for the round that just ended ("Draw round", "Red takes the round"…). */
  roundText: string
}

class MemoryGame extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  /** A fresh table: new glyphs and a new deal. */
  private deal(): Pick<
    State,
    'glyphs' | 'table' | 'flippedAt' | 'matchedAt' | 'resolveAt' | 'seen'
  > {
    const rng = this.ctx.rng
    const sets = Object.values(GLYPHS)
    const glyphs = rng.shuffle([...rng.pick(sets)]).slice(0, PAIRS)
    const table = newTable(dealPairs(rng, PAIRS))
    return {
      glyphs,
      table,
      flippedAt: table.deck.map(() => -10),
      matchedAt: table.deck.map(() => -10),
      resolveAt: -1,
      seen: table.deck.map(() => null),
    }
  }

  protected setup(): State {
    const dealt = this.deal()
    const starter: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      ...dealt,
      turn: starter,
      starter,
      wins: [0, 0],
      roundAt: -1,
      roundText: '',
    }
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.roundAt >= 0) {
      // Round over: show the result, then deal the next table with the other player starting.
      if (this.time - s.roundAt >= ROUND_PAUSE) this.nextRound()
      return true
    }
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

  private nextRound(): void {
    const s = this.s
    const starter = other(s.starter)
    Object.assign(s, this.deal(), { starter, turn: starter, roundAt: -1, roundText: '' })
    this.ctx.audio.play('swish', 1.05)
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
      if (cleared(s.table)) this.roundOver()
    } else if (result === 'miss') {
      s.resolveAt = this.time + 1.05
      this.ctx.audio.play('tap', 0.7)
    }
  }

  /** The table is full: the side with more pairs takes the round. Draws don't count. */
  private roundOver(): void {
    const s = this.s
    const r = pairsOf(s.table, 0)
    const bl = pairsOf(s.table, 1)
    const won: Side | 'draw' = r === bl ? 'draw' : r > bl ? 0 : 1
    if (won !== 'draw') s.wins[won]++
    const decided = matchWinner(s.wins, this.target)
    // A single-table match that ends level is a draw, as it always was.
    if (decided !== null || (won === 'draw' && this.target === 1)) {
      this.finish(decided ?? 'draw', {
        score: this.target > 1 ? [s.wins[0], s.wins[1]] : [r, bl],
        delay: 1.4,
      })
      return
    }
    s.roundAt = this.time
    if (won === 'draw') {
      s.roundText = 'Draw round'
      this.ctx.audio.play('draw')
    } else {
      s.roundText = `${this.ctx.names[won]} takes the round`
      this.ctx.audio.play('coin')
    }
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    backdropGlow(g)
    renderCards(g, s, this.time)
    this.drawTurns(g, undefined, s.resolveAt < 0 && s.roundAt < 0)
    bigScore(g, 0, pairsOf(s.table, 0))
    bigScore(g, 1, pairsOf(s.table, 1))
    if (this.target > 1) {
      // Both rows on the right: the score sits on the left for both players.
      pips(g, 0, s.wins[0], this.target, { x: W - 150 })
      pips(g, 1, s.wins[1], this.target, { x: W - 150 })
    }
    if (s.roundAt >= 0 && !this.over) banner(g, undefined, s.roundText, MID, { size: 58 })
  }
}

export default () => new MemoryGame()
