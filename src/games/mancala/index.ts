import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { think, TurnGame, tableBackdrop } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import { FLY, HOP, hopFor, notice, pitAt, pitCentre, renderMancala } from './render.ts'
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
  /** Seconds per hop for the sowing running now (big handfuls go quicker). */
  hop: number
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
  /** Game time the round is counted, once the last seeds are home. */
  finishAt: number
  /** Round wins, red first. */
  wins: [number, number]
  /** The side that opened the current round. Alternates every round. */
  starter: Side
  /** Between rounds: "Red takes the round" or "Draw round", shown once the seeds are home. */
  roundText: string
  /** Game time the next round starts, or -1. */
  resetAt: number
}

/** Seconds the seeds hover before the first drop. */
const LIFT = 0.16

/** Seconds from the seeds being home to the next round, once a round is decided and the match goes on. */
const ROUND_TIME = 2.6

/**
 * How long a match lasts: first to N round wins (one game is one round). The
 * default is a single game, the classic match.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** A spot on the mover's own half, between the board and their edge, for a floating message. */
const halfY = (side: Side): number => (side === 0 ? MID + 530 : MID - 530)

class Mancala extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

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
      hop: HOP,
      lastFrom: -1,
      lastTo: -1,
      flights: [],
      storeAt: [-10, -10],
      endedAt: -1,
      winner: null,
      finishAt: -1,
      wins: [0, 0],
      starter: p.turn,
      roundText: '',
      resetAt: -1,
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
      if (s.resetAt < 0 && this.time >= s.finishAt && s.winner !== null) this.roundOver()
      else if (s.resetAt >= 0 && this.time >= s.resetAt) this.nextRound()
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

  /** The round's seeds are all home: count it, then finish the match or set up the next round. */
  private roundOver(): void {
    const s = this.s
    const win = s.winner
    if (win === null) return
    if (win !== 'draw') {
      s.wins[win]++
      // The fuller store bursts the moment the count is in.
      const c = pitCentre(STORE[win])
      const fx = this.ctx.fx
      fx.burst(c.x, c.y, SIDE[win].main, { count: 26, speed: 560, size: 13, life: 0.7 })
      fx.burst(c.x, c.y, C.yellow, { count: 12, speed: 420, size: 8, life: 0.5, kind: 'spark' })
      fx.ring(c.x, c.y, SIDE[win].light, 260)
      fx.flash(SIDE[win].main, 0.2)
      fx.shake(0.25)
      fx.stop(4)
      this.ctx.audio.play('score')
      this.ctx.audio.buzz(25)
    } else this.ctx.audio.play('draw')
    // A single game ends the match as it always did, draws included.
    const decided = win === 'draw' ? this.target <= 1 : s.wins[win] >= this.target
    if (decided) {
      const score: [number, number] =
        this.target > 1 ? [s.wins[0], s.wins[1]] : [s.pits[STORE[0]] ?? 0, s.pits[STORE[1]] ?? 0]
      if (win !== 'draw') {
        this.ctx.fx.confetti(win)
        this.ctx.fx.float('Winner!', W / 2, halfY(win), SIDE[win].light, 72, win)
      }
      this.finish(win, { score, delay: 1.6 })
      return
    }
    // Draws never count: the round is simply played again.
    s.roundText = win === 'draw' ? 'Draw round' : `${this.ctx.names[win]} takes the round`
    s.resetAt = this.time + ROUND_TIME
  }

  /** The next round: the pits are filled again and the other side opens. */
  private nextRound(): void {
    const s = this.s
    const p = startPosition(other(s.starter))
    s.starter = p.turn
    s.turn = p.turn
    s.pits = p.pits
    s.queue = []
    s.from = -1
    s.mover = p.turn
    s.liftAt = -10
    s.hopAt = 0
    s.dropAt = -10
    s.hop = HOP
    s.lastFrom = -1
    s.lastTo = -1
    s.flights = []
    s.storeAt = [-10, -10]
    s.endedAt = -1
    s.winner = null
    s.finishAt = -1
    s.roundText = ''
    s.resetAt = -1
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
      // A bigger pile lands harder.
      const k = Math.min(1, f.n / 12)
      this.ctx.fx.burst(c.x, c.y, SIDE[side].light, {
        count: 8 + Math.min(24, f.n * 2),
        speed: 380 + k * 300,
        size: 10,
      })
      if (f.n >= 4) this.ctx.fx.ring(c.x, c.y, SIDE[side].light, 120 + k * 120)
      if (f.n >= 6) this.ctx.fx.shake(0.1 + k * 0.15)
      this.ctx.audio.play('coin', 0.9 + Math.min(f.n, 10) * 0.03)
      if (f.n >= 4) this.ctx.audio.buzz(Math.round(8 + k * 14))
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

  /** The computer answers briskly; the search itself runs off-thread. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.6 : d === 'normal' ? 0.45 : 0.35) + this.ctx.rng.range(0, 0.25)
  }

  protected botPlay(): Promise<void> {
    const pos = this.pos()
    const seed = this.ctx.rng.int(1, 2 ** 31 - 2)
    const turn = this.s.turn
    return think<number>('mancala', pos, this.ctx.difficulty, seed).then((pit) => {
      const s = this.s
      if (this.over || s.turn !== turn || s.queue.length > 0 || s.endedAt >= 0) return
      const legal = (p: number) => ownerOf(p) === turn && (s.pits[p] ?? 0) > 0
      this.start(
        typeof pit === 'number' && legal(pit)
          ? pit
          : choose(this.pos(), this.ctx.difficulty, this.ctx.rng),
      )
    })
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
    s.hop = hopFor(seeds)
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
    s.hopAt = this.time + s.hop
    const k = s.queue.length
    // Rising pitch as the hand empties: the last seed sings.
    this.ctx.audio.play('pop', 0.85 + Math.max(0, 8 - k) * 0.05)
    if (isStore(to)) s.storeAt[ownerOf(to)] = this.time + s.hop
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
    const at = this.time + s.hop
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
    // Online, only the player to move sees their pits pulse.
    const live =
      !this.over &&
      s.endedAt < 0 &&
      s.queue.length === 0 &&
      !s.flights.some((f) => !f.done) &&
      !this.isBot(s.turn) &&
      (g.viewer === null || g.viewer === s.turn)
    renderMancala(g, s, this.time, live)
    this.drawTurns(g, undefined, s.endedAt < 0)
    if (this.target > 1) {
      pips(g, 0, s.wins[0], this.target)
      pips(g, 1, s.wins[1], this.target)
    }
    if (s.endedAt >= 0) {
      // The seeds go home, then who took the round.
      if (s.roundText) notice(g, s.roundText, Math.min(1, (this.time - s.finishAt) * 4))
      else notice(g, 'Board cleared!', Math.min(1, (this.time - s.endedAt) * 4))
    }
  }
}

export default () => new Mancala()
