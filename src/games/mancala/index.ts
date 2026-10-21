import type { Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { bigScore } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { TurnGame, tableBackdrop } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { FLY, HOP, notice, pitAt, pitCentre, renderMancala, storeCount } from './render.ts'
import {
  isStore,
  opposite,
  ownerOf,
  type Position,
  settle,
  sowPath,
  startPosition,
  STORE,
  verdict,
} from './rules.ts'

/** Seeds flying home together: a capture, or one pit's share of the final sweep. */
export interface Flight {
  from: number
  to: number
  n: number
  /** Game time the seeds leave. */
  at: number
  /** Landed (its burst and sound have played). */
  done: boolean
}

export interface State {
  /** Side to move; stays the same while a sowing runs and changes when it settles. */
  turn: Side
  /** 14 positions: red's pits 0-5, red's store 6, blue's pits 7-12, blue's store 13. */
  pits: number[]
  /** Positions the seeds in hand will still land in, one per hop. Empty when idle. */
  queue: number[]
  /** The pit the sowing was lifted from, -1 when idle. */
  from: number
  /** Side whose sowing is running. */
  mover: Side
  /** Game time the seeds were lifted. */
  liftAt: number
  /** Game time of the next drop. */
  hopAt: number
  /** Game time of the last drop, for the seed in flight. */
  dropAt: number
  /** Where the last seed came from and where it landed (-1 before the first drop). */
  lastFrom: number
  lastTo: number
  /** Captured and swept seeds on their way to a store. */
  flights: Flight[]
  /** Game time each store last grew, for its badge bump. */
  storeAt: [number, number]
  /** Game time the board emptied, -1 while playing. */
  endedAt: number
  winner: Side | 'draw' | null
  /** Game time the result is declared, once the last seeds are home. */
  finishAt: number
}

/** Seconds the seeds hover before the first drop. */
const LIFT = 0.16

/** A spot on the mover's own half, between the board and their edge, for a floating message. */
const halfY = (side: Side): number => (side === 0 ? MID + 530 : MID - 530)

class Mancala extends TurnGame<State> {
  protected setup(): State {
    const p = startPosition(this.ctx.rng.chance(0.5) ? 0 : 1)
    return {
      turn: p.turn,
      pits: p.pits,
      queue: [],
      from: -1,
      mover: p.turn,
      liftAt: -10,
      hopAt: 0,
      dropAt: -10,
      lastFrom: -1,
      lastTo: -1,
      flights: [],
      storeAt: [-10, -10],
      endedAt: -1,
      winner: null,
      finishAt: -1,
    }
  }

  private pos(): Position {
    return { turn: this.s.turn, pits: this.s.pits }
  }

  /** Sowing and flights run on their own clock; the turn waits until they are done. */
  protected override step(dt: number): void {
    this.land()
    const s = this.s
    if (s.endedAt >= 0) {
      if (this.time >= s.finishAt && s.winner !== null) {
        const score: [number, number] = [s.pits[STORE[0]] ?? 0, s.pits[STORE[1]] ?? 0]
        this.finish(s.winner, { score, delay: 1.6 })
      }
      return
    }
    if (s.queue.length > 0) {
      if (this.time >= s.hopAt) this.drop()
      return
    }
    if (s.flights.some((f) => !f.done)) return
    super.step(dt)
  }

  protected override afterEnd(): void {
    this.land()
  }

  /** Flights that reach their store this step: a burst and a coin per pile. */
  private land(): void {
    const s = this.s
    for (const f of s.flights) {
      if (f.done || this.time < f.at + FLY) continue
      f.done = true
      const side = ownerOf(f.to)
      const c = pitCentre(f.to)
      s.storeAt[side] = this.time
      this.ctx.fx.burst(c.x, c.y, SIDE[side].light, { count: 8 + f.n, speed: 380, size: 10 })
      this.ctx.audio.play('coin', 0.9 + Math.min(f.n, 10) * 0.03)
    }
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap) return
    const pit = pitAt(tap.x, tap.y)
    if (pit === null) return
    if (ownerOf(pit) !== this.s.turn || (this.s.pits[pit] ?? 0) === 0) {
      this.ctx.audio.play('error')
      const c = pitCentre(pit)
      this.ctx.fx.ring(c.x, c.y, C.white, 70)
      return
    }
    this.start(pit)
  }

  protected botPlay(): void {
    this.start(choose(this.pos(), this.ctx.difficulty, this.ctx.rng))
  }

  /** Lift the seeds from `pit`; they are sown one hop at a time by `drop`. */
  private start(pit: number): void {
    const s = this.s
    const seeds = s.pits[pit] ?? 0
    s.pits[pit] = 0
    s.queue = sowPath(s.turn, pit, seeds)
    s.from = pit
    s.mover = s.turn
    s.lastFrom = pit
    s.lastTo = -1
    s.liftAt = this.time
    s.hopAt = this.time + LIFT
    const c = pitCentre(pit)
    this.ctx.audio.play('swish', 1.1)
    this.ctx.fx.burst(c.x, c.y, C.cream, { count: 8, speed: 220, size: 6, life: 0.35 })
  }

  private drop(): void {
    const s = this.s
    const to = s.queue.shift()
    if (to === undefined) return
    s.pits[to] = (s.pits[to] ?? 0) + 1
    s.lastFrom = s.lastTo < 0 ? s.from : s.lastTo
    s.lastTo = to
    s.dropAt = this.time
    // The seed lands at the end of its hop; the next one leaves right after.
    s.hopAt = this.time + HOP
    const k = s.queue.length
    // Rising pitch as the hand empties: the last seed sings.
    this.ctx.audio.play('pop', 0.85 + Math.max(0, 8 - k) * 0.05)
    if (isStore(to)) s.storeAt[ownerOf(to)] = this.time + HOP
    if (k === 0) this.settle()
  }

  private settle(): void {
    const s = this.s
    const fx = this.ctx.fx
    const mover = s.mover
    const last = s.lastTo
    const before = s.pits.slice()
    const r = settle(s.pits, mover, last)
    s.pits = r.pits
    // Effects land with the last seed, one hop from now.
    const at = this.time + HOP
    s.flights = []

    if (r.captured > 0) {
      const opp = opposite(last)
      s.flights.push({ from: last, to: STORE[mover], n: 1, at, done: false })
      s.flights.push({ from: opp, to: STORE[mover], n: r.captured - 1, at, done: false })
      before[last] = 0
      before[opp] = 0
      const c = pitCentre(opp)
      fx.burst(c.x, c.y, SIDE[other(mover)].main, { count: 16, speed: 460, size: 11, life: 0.6 })
      fx.ring(c.x, c.y, SIDE[mover].light, 130)
      fx.shake(0.22)
      fx.stop(4)
      fx.float(`Capture +${r.captured}`, W / 2, halfY(mover), SIDE[mover].light, 64, mover)
      this.ctx.audio.play('chomp', 1)
    }

    if (r.over) {
      // Whatever is left on the board goes home to its owner.
      const sweep = at + (r.captured > 0 ? FLY * 0.8 : 0.1)
      for (let i = 0; i < 14; i++) {
        const n = before[i] ?? 0
        if (isStore(i) || n === 0) continue
        s.flights.push({ from: i, to: STORE[ownerOf(i)], n, at: sweep, done: false })
      }
      const v = verdict({ turn: mover, pits: s.pits })
      s.endedAt = this.time
      s.winner = v?.winner ?? 'draw'
      s.finishAt = sweep + FLY + 0.25
      s.from = -1
      this.ctx.audio.play('whoosh', 0.9)
      return
    }

    s.from = -1
    if (r.again) {
      fx.float('Again!', W / 2, halfY(mover), SIDE[mover].light, 64, mover)
      this.ctx.audio.play('boing', 1.2)
      const c = pitCentre(STORE[mover])
      fx.sparks(c.x, c.y, C.yellow, 14)
      s.turn = mover
    } else {
      s.turn = other(mover)
    }
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    const live =
      !this.over &&
      s.endedAt < 0 &&
      s.queue.length === 0 &&
      !s.flights.some((f) => !f.done) &&
      !this.isBot(s.turn)
    renderMancala(g, s, this.time, live)
    this.drawTurns(g, undefined, s.endedAt < 0)
    bigScore(g, 0, storeCount(s, this.time, 0), { x: 130 })
    bigScore(g, 1, storeCount(s, this.time, 1), { x: 870 })
    if (s.endedAt >= 0) {
      const a = Math.min(1, (this.time - s.endedAt) * 4)
      notice(g, 'Board cleared!', a)
    }
  }
}

export default () => new Mancala()
