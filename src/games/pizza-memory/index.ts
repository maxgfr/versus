import { frame, toLocal } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { tableBackdrop } from '../../engines/board/index.ts'
import { GAP, memorise, nextPick, THINK } from './bot.ts'
import { PIZZA, renderPizza, STRIP_Y, slotX, tileAt, tileXY } from './render.ts'
import {
  decide,
  LEAD,
  MAX_ORDERS,
  makeOrder,
  nextLength,
  placeSpots,
  rightPick,
  type Spot,
  START_LEN,
  SHOW,
  showTime,
  TOPPINGS,
  watchLength,
} from './rules.ts'

/** Seconds the finished attempts stay on screen before the next order (or the result). */
const AFTER = 2.4

/** Match length: a number of rounds (orders), the score deciding if no round is clean. */
export const match: MatchSpec = { unit: 'rounds', default: MAX_ORDERS, min: 1, max: 10 }

export interface State {
  /** Rounds finished so far. The current order is round + 1. */
  round: number
  order: number[]
  /** Where each topping of the order sits on the pizza. */
  spots: Spot[]
  /** Tray: tile i shows topping perm[i]. Same tray for both players. */
  perm: number[]
  phase: 'watch' | 'build' | 'after'
  /** Seconds between two toppings appearing this round: shorter as the match goes on. */
  show: number
  phaseAt: number
  /** Who rebuilds first this round (alternates). */
  first: Side
  /** Who is rebuilding right now. */
  builder: Side
  /** Toppings each side has placed correctly so far this round. */
  built: [number[], number[]]
  /** Each side's round: null = still building, true = right, false = wrong. */
  done: [boolean | null, boolean | null]
  /** Tray tile of each side's wrong pick (-1 = none): where the splat lands. */
  failTile: [number, number]
  scores: [number, number]
  /** Game time each strip slot was filled, per side (pop-in). */
  builtAt: [number[], number[]]
  /** Each side's last tray press, for the tile push. */
  press: [{ tile: number; at: number } | null, { tile: number; at: number } | null]
  /** Game time of each side's wrong pick this round. */
  failAt: [number, number]
  /** Game time each side last scored, for the score bump. */
  scoredAt: [number, number]
  /** When the game was decided (-1 = still on), and who won. */
  endAt: number
  winner: Side | 'draw' | null
}

/**
 * Pizza Memory: an order of toppings appears one by one on the shared pizza,
 * then hides. Both players rebuild it from their own tray, one topping at a
 * time. A round where only one player gets it right decides the game.
 */
class PizzaMemory extends BaseGame<State> {
  /** Computer: which slots of the current order it remembers. */
  private known: [boolean[], boolean[]] = [[], []]
  /** Computer: game time of its next pick (-1 = none planned). */
  private botAt = -1
  /** Toppings already shown on the pizza this round (sound pacing). */
  private shown = 0

  private get total(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const rng = this.ctx.rng
    const first: Side = rng.chance(0.5) ? 0 : 1
    const order = makeOrder(rng, START_LEN)
    return {
      round: 0,
      order,
      spots: placeSpots(rng, order.length),
      perm: rng.shuffle(TOPPINGS.map((_, i) => i)),
      phase: 'watch',
      show: SHOW,
      phaseAt: 0,
      first,
      builder: first,
      built: [[], []],
      done: [null, null],
      failTile: [-1, -1],
      scores: [0, 0],
      builtAt: [[], []],
      press: [null, null],
      failAt: [-10, -10],
      scoredAt: [-10, -10],
      endAt: -1,
      winner: null,
    }
  }

  protected step(_dt: number): void {
    const s = this.s
    if (s.phase === 'watch') {
      this.reveal()
      if (this.time - s.phaseAt >= watchLength(s.order.length, s.show)) this.beginBuild()
      return
    }
    if (s.phase === 'build') {
      for (const side of [0, 1] as Side[]) {
        if (this.isBot(side)) continue
        for (const p of this.ctx.input.player(side).downs) {
          if (this.over) return
          const l = toLocal(side, p.x, p.y)
          const tile = tileAt(l.x, l.y)
          if (tile >= 0) this.press(side, tile)
        }
      }
      this.botBuild()
      return
    }
    if (this.time - s.phaseAt >= AFTER) this.resolve()
  }

  /** Each topping pops onto the pizza as its time comes. */
  private reveal(): void {
    const s = this.s
    const fx = this.ctx.fx
    while (this.shown < s.order.length && this.time >= s.phaseAt + LEAD + this.shown * s.show) {
      const spot = s.spots[this.shown]
      if (spot) {
        // The topping lands a beat after it starts dropping.
        fx.puff(PIZZA.x + spot.x, PIZZA.y + spot.y + 20, 'rgba(255,240,200,0.6)', 6)
      }
      this.ctx.audio.play('pop', 0.9 + this.shown * 0.07)
      this.shown++
    }
  }

  private startRound(first: Side): void {
    const s = this.s
    s.phase = 'watch'
    s.phaseAt = this.time
    s.first = first
    s.builder = first
    s.built = [[], []]
    s.done = [null, null]
    s.failTile = [-1, -1]
    s.builtAt = [[], []]
    s.press = [null, null]
    this.shown = 0
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side))
        this.known[side] = memorise(s.order.length, this.ctx.difficulty, this.ctx.rng)
    }
    this.ctx.audio.play('swish', 1.05)
  }

  private beginBuild(): void {
    const s = this.s
    s.phase = 'build'
    s.phaseAt = this.time
    s.builder = s.first
    this.ctx.audio.play('whoosh')
    this.schedule(s.builder, true)
  }

  /** The computer's next move: a think time before the first pick, a gap after. */
  private schedule(side: Side, first: boolean): void {
    if (!this.isBot(side)) return
    const [lo, hi] = first ? THINK[this.ctx.difficulty] : GAP[this.ctx.difficulty]
    this.botAt = this.time + this.ctx.rng.range(lo, hi)
  }

  private botBuild(): void {
    const s = this.s
    const side = s.builder
    if (!this.isBot(side) || s.done[side] !== null || this.time < this.botAt) return
    const topping = nextPick(
      s.order,
      s.built[side],
      this.known[side],
      this.ctx.rng,
      this.ctx.difficulty,
    )
    const tile = s.perm.indexOf(topping)
    if (tile < 0) return
    this.press(side, tile)
    if (s.done[side] === null) this.schedule(side, false)
  }

  /** A player taps a tray tile: right topping goes on the strip, a wrong one ends the attempt. */
  private press(side: Side, tile: number): void {
    const s = this.s
    if (s.phase !== 'build' || s.builder !== side || s.done[side] !== null) return
    const topping = s.perm[tile]
    if (topping === undefined) return
    const fx = this.ctx.fx
    const k = s.built[side].length
    const c = frame(side, tileXY(tile).x, tileXY(tile).y)
    s.press[side] = { tile, at: this.time }
    if (rightPick(s.order, s.built[side], topping)) {
      s.built[side].push(topping)
      s.builtAt[side][k] = this.time
      const slot = frame(side, slotX(k, s.order.length), STRIP_Y)
      // Each right pick climbs in pitch and lands harder: the order builds to its finish.
      const climb = Math.min(1, k / Math.max(1, s.order.length - 1))
      fx.burst(slot.x, slot.y, SIDE[side].light, {
        count: Math.round(8 + climb * 8),
        speed: 280 + climb * 160,
        size: 9,
        kind: 'spark',
      })
      const spot = s.spots[k]
      if (spot) fx.ring(PIZZA.x + spot.x, PIZZA.y + spot.y, SIDE[side].light, 70)
      this.ctx.audio.play('pop', 1 + k * 0.08)
      this.ctx.audio.buzz(6 + Math.round(climb * 6))
      if (s.built[side].length === s.order.length) {
        s.done[side] = true
        fx.ring(slot.x, slot.y, C.yellow, 200)
        fx.burst(slot.x, slot.y, SIDE[side].main, { count: 26, speed: 460, size: 12 })
        fx.burst(PIZZA.x, PIZZA.y, C.yellow, { count: 14, speed: 380, size: 10, kind: 'spark' })
        fx.shake(0.12 + Math.min(0.2, s.order.length * 0.02))
        this.ctx.audio.play('coin', 0.9 + s.order.length * 0.03)
        this.ctx.audio.buzz(25)
        this.passOn(side)
      }
    } else {
      s.done[side] = false
      s.failTile[side] = tile
      s.failAt[side] = this.time
      fx.burst(c.x, c.y, '#c92e22', { count: 20, speed: 420, size: 12 })
      fx.puff(c.x, c.y, 'rgba(255,255,255,0.4)', 6)
      fx.float('Splat!', c.x, c.y - 100, C.redLight, 64, side)
      fx.shake(0.3)
      fx.stop(5)
      this.ctx.audio.play('splash')
      this.ctx.audio.play('error', 0.8)
      this.ctx.audio.buzz(35)
      this.passOn(side)
    }
  }

  /** The builder is done: the other side rebuilds, or the round is over. */
  private passOn(side: Side): void {
    const s = this.s
    const next = other(side)
    if (s.done[next] !== null) {
      s.phase = 'after'
      s.phaseAt = this.time
      this.ctx.audio.play('whoosh', 0.9)
      return
    }
    s.builder = next
    this.schedule(next, true)
  }

  private resolve(): void {
    const s = this.s
    const right: [boolean, boolean] = [s.done[0] === true, s.done[1] === true]
    for (const side of [0, 1] as Side[]) {
      if (!right[side]) continue
      s.scores[side]++
      s.scoredAt[side] = this.time
      floatFor(this.ctx.fx, side, '+1', side === 0 ? 130 : 870, side === 0 ? 1600 : 200)
    }
    const rounds = s.round + 1
    const w = decide(right, s.scores, rounds, this.total)
    if (w !== null) {
      // The ticket keeps showing the order just played (round + 1 while on).
      s.endAt = this.time
      s.winner = w
      const fx = this.ctx.fx
      fx.stop(8)
      fx.shake(0.35)
      this.ctx.audio.buzz(40)
      if (w !== 'draw') {
        fx.flash(SIDE[w].light, 0.3)
        fx.confetti(w)
      } else fx.confetti()
      this.finish(w, { score: [s.scores[0], s.scores[1]], delay: 2.3 })
      return
    }
    const len = nextLength(s.order.length, right[0] && right[1])
    s.round = rounds
    s.show = showTime(rounds)
    s.order = makeOrder(this.ctx.rng, len)
    s.spots = placeSpots(this.ctx.rng, len)
    this.startRound(other(s.first))
  }

  /** Name pill text for a side: whose turn, or how the attempt went. */
  private pill(side: Side): { text?: string; active: boolean } {
    const s = this.s
    if (s.endAt >= 0)
      return s.winner === side ? { text: 'Winner!', active: true } : { active: false }
    if (s.phase === 'watch') return { text: 'Watch!', active: true }
    const d = s.done[side]
    if (d === true) return { text: 'Got it!', active: false }
    if (d === false) return { text: 'Oops!', active: false }
    if (s.phase === 'build' && s.builder === side) {
      return { text: this.isBot(side) ? 'Thinking…' : 'Your turn!', active: true }
    }
    return { text: 'Wait…', active: false }
  }

  render(g: Draw): void {
    tableBackdrop(g)
    renderPizza(g, this.s, this.time, this.ctx.names, (side) => this.pill(side), this.total)
  }
}

export default () => new PizzaMemory()
