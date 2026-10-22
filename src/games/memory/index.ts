import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { outBack, prog, Spring } from '../../core/fx/ease.ts'
import { banner, bigScore, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { tableBackdrop, TurnGame } from '../../engines/board/index.ts'
import { cardAt, dealPairs, GLYPHS } from '../../engines/cards/index.ts'
import { CAREFUL, choose, type Memory, remember } from './bot.ts'
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
/** A missed pair stays up this long, unless a tap sends it back sooner (after MISS_MIN). */
const MISS_SHOW = 1
const MISS_MIN = 0.35

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
  /** Pairs in a row by the side on turn (a combo). */
  streak: number
}

class MemoryGame extends TurnGame<State> {
  /** Cosmetic: the pair counts pop when they go up. */
  private pulse: [Spring, Spring] = [new Spring(0, 260, 11), new Spring(0, 260, 11)]

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
      streak: 0,
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
    // A tap sends a missed pair back down early: no waiting on a pair you have already read.
    const tap = this.time >= s.resolveAt - MISS_SHOW + MISS_MIN ? this.turnTap() : undefined
    if (this.time >= s.resolveAt || tap) {
      for (const i of s.table.up) s.flippedAt[i] = this.time
      hideMiss(s.table)
      s.resolveAt = -1
      s.turn = other(s.turn)
      s.streak = 0
      this.ctx.audio.play('flip', 0.8)
      // The tap that skipped the wait must not also turn the next player's first card.
      return !!tap
    }
    return true
  }

  private nextRound(): void {
    const s = this.s
    const starter = other(s.starter)
    Object.assign(s, this.deal(), {
      starter,
      turn: starter,
      roundAt: -1,
      roundText: '',
      streak: 0,
    })
    this.ctx.audio.play('swish', 1.05)
  }

  protected override botDelay(): number {
    // The second card comes quicker: the computer already "looked".
    const d = this.ctx.difficulty
    if (this.s.table.up.length === 1) return d === 'hard' ? 0.4 : 0.5
    return (d === 'easy' ? 0.75 : d === 'normal' ? 0.6 : 0.45) + this.ctx.rng.range(0, 0.25)
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const i = cardAt(CARDS, tap.x, tap.y)
    if (i < 0) return
    if (!canTurn(this.s.table, i)) return
    this.turn(i)
  }

  protected botPlay(): void {
    const careful = CAREFUL[this.ctx.difficulty]
    this.turn(choose(this.s.table, this.s.seen, this.ctx.rng, careful))
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
      const audio = this.ctx.audio
      s.streak++
      // A run of pairs builds: higher pitch, bigger bursts, a stronger thump.
      const k = Math.min(1, (s.streak - 1) / 4)
      const [a, b] = [i, s.table.deck.findIndex((d, k) => k !== i && d === s.table.deck[i])]
      for (const n of [a, b]) {
        s.matchedAt[n] = this.time + 0.25
        const c = CARDS[n]
        if (!c) continue
        fx.burst(c.x, c.y, SIDE[side].main, {
          count: Math.round(14 + k * 16),
          speed: 420 + k * 260,
          size: 12,
          colors: [SIDE[side].main, SIDE[side].light, C.yellow],
          kind: 'square',
        })
        fx.ring(c.x, c.y, SIDE[side].light, c.w * (0.8 + k * 0.4))
      }
      const c = CARDS[i]
      const word = s.streak >= 2 ? `Pair! ×${s.streak}` : 'Pair!'
      if (c) fx.float(word, c.x, c.y - c.h * 0.4, SIDE[side].light, 56 + k * 14, side)
      audio.play('score', 1 + k * 0.3)
      audio.buzz(Math.round(12 + k * 18))
      fx.shake(0.1 + k * 0.15)
      fx.stop(2 + Math.round(k * 3))
      this.pulse[side].kick(12 + k * 8)
      if (cleared(s.table)) this.roundOver()
    } else if (result === 'miss') {
      s.resolveAt = this.time + MISS_SHOW
      this.ctx.audio.play('tap', 0.7)
      this.ctx.audio.buzz(6)
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
      // The last word stays on the table a moment before the result screen.
      s.roundAt = this.time
      s.roundText = decided === null ? 'Draw!' : `${this.ctx.names[decided]} wins!`
      const fx = this.ctx.fx
      if (decided !== null) {
        fx.confetti(decided)
        fx.flash(SIDE[decided].light, 0.3)
        fx.stop(6)
        fx.ring(W / 2, MID, SIDE[decided].light, 520)
      } else fx.confetti()
      fx.shake(0.3)
      this.finish(decided ?? 'draw', {
        score: this.target > 1 ? [s.wins[0], s.wins[1]] : [r, bl],
        delay: 2,
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
      this.ctx.fx.flash(SIDE[won].light, 0.2)
      this.ctx.fx.ring(W / 2, MID, SIDE[won].light, 420)
    }
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    backdropGlow(g)
    const live = !this.over && s.resolveAt < 0 && s.roundAt < 0
    renderCards(g, s, this.time, live ? s.turn : null)
    this.drawTurns(g, undefined, s.resolveAt < 0 && s.roundAt < 0)
    for (const side of [0, 1] as Side[]) {
      const p = Math.max(0, this.pulse[side].update(1 / 60))
      bigScore(g, side, pairsOf(s.table, side), { size: 76 + Math.min(34, p * 1.8) })
    }
    if (this.target > 1) {
      // Both rows on the right: the score sits on the left for both players.
      pips(g, 0, s.wins[0], this.target, { x: W - 150 })
      pips(g, 1, s.wins[1], this.target, { x: W - 150 })
    }
    if (s.roundAt >= 0) {
      const k = outBack(prog(this.time - s.roundAt, 0.15, 0.5))
      if (k > 0) banner(g, undefined, s.roundText, MID, { size: 58 * k, alpha: Math.min(1, k) })
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    for (const p of this.pulse) p.set(0)
  }
}

export default () => new MemoryGame()
