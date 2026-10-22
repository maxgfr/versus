import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, pips as roundPips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { tableBackdrop, think, TurnGame, type TurnState } from '../../engines/board/index.ts'
import { frame, toLocal } from '../../engines/dice/index.ts'
import type { AiState } from './ai.ts'
import { planTurn } from './bot.ts'
import {
  BOARD,
  BAR_W,
  DICE,
  endBanner,
  type Flight,
  flightEnd,
  PW,
  renderBoard,
  renderDice,
  ROLL_T,
  spotOf,
  TRAY,
} from './render.ts'
import {
  absOf,
  apply,
  BAR,
  clone,
  nextSteps,
  own,
  type Pos,
  pips,
  result,
  sameStep,
  type Step,
  sequences,
  start,
} from './rules.ts'

/** Turns after which the game is decided on pip count (a safety cap for computer-vs-computer). */
export const PLY_CAP = 400
const FLIGHT = 0.34
/** A beat before a forced move (only one checker move possible) plays itself. */
const AUTO = 0.4
/** Seconds a finished round stays on screen before the board is set up again. */
const ROUND_PAUSE = 2.4

/** A match is first to N round wins; each round is one whole game. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

export interface State extends TurnState {
  /** Who opens the current round; the other player opens the next one. */
  starter: Side
  /** Round wins per side. */
  wins: [number, number]
  /** A round that ended without deciding the match: its winner, and when it began. */
  round: { winner: Side | 'draw'; at: number } | null
  /** Game time the next round is set up, or -1 while this round is live. */
  nextAt: number
  pos: Pos
  /** The dice of this turn (two, or four for doubles); empty before the roll. */
  roll: number[]
  /** The position the turn started from: the legal sequences are worked out from it. */
  origin: Pos | null
  /** Moves played so far this turn. */
  used: Step[]
  /** Distinct next moves for the side to move. */
  moves: Step[]
  /** Checker picked up by the player (side-relative point, or BAR), or null. */
  sel: number | null
  /** Last roll of each side, for the dice on its half. */
  shown: [number[], number[]]
  rolledAt: [number, number]
  flight: Flight | null
  /** Whether the turn goes on after the checker in flight lands. */
  more: boolean
  /** Game time before which nothing happens (a pause after a pass). */
  wait: number
  /** Turns played. */
  ply: number
  /** How the game ended, for the closing banner. */
  end: { winner: Side; at: number; text: string } | null
}

type Target = { kind: 'point'; rel: number } | { kind: 'bar' } | { kind: 'tray' }

/** What is under a world point, from `side`'s side-relative numbering. */
function targetAt(side: Side, x: number, y: number): Target | null {
  const t = TRAY[side]
  if (x >= t.x - 14 && x <= t.x + t.w + 24 && y >= t.y - 14 && y <= t.y + t.h + 14)
    return { kind: 'tray' }
  const b = BOARD
  if (x < b.x - 10 || x > b.x + b.w + 10 || y < b.y - 20 || y > b.y + b.h + 20) return null
  const barX = b.x + 6 * PW
  if (x >= barX && x <= barX + BAR_W) return { kind: 'bar' }
  const k = x < barX ? Math.floor((x - b.x) / PW) : 6 + Math.floor((x - barX - BAR_W) / PW)
  const col = Math.min(11, Math.max(0, k))
  const p = y > MID ? 12 - col : 13 + col
  return { kind: 'point', rel: absOf(side, p) }
}

class Backgammon extends TurnGame<State> {
  /** The computer's plan for the current turn (host only, never streamed). */
  private plan: Step[] = []
  private wasRolling = false
  /** When the current choice of moves opened up, keyed by turn and move number (for forced moves). */
  private forcedAt: { key: string; at: number } | null = null

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const turn: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn,
      starter: turn,
      wins: [0, 0],
      round: null,
      nextAt: -1,
      pos: start(),
      roll: [],
      origin: null,
      used: [],
      moves: [],
      sel: null,
      shown: [[], []],
      rolledAt: [-10, -10],
      flight: null,
      more: false,
      wait: 0,
      ply: 0,
      end: null,
    }
  }

  protected override busy(): boolean {
    const s = this.s
    const rolling = this.time - s.rolledAt[s.turn] < ROLL_T
    if (this.wasRolling && !rolling) this.ctx.audio.play('place', 0.9)
    this.wasRolling = rolling
    return s.flight !== null || this.time < s.wait || rolling || s.nextAt >= 0
  }

  /** Landing effects when a checker touches down; the turn goes on or passes when the flight ends. */
  protected override animate(): void {
    const s = this.s
    if (s.nextAt >= 0 && this.time >= s.nextAt) {
      this.nextRound()
      return
    }
    const fl = s.flight
    if (!fl) return
    if (!fl.landed && this.time >= fl.start + fl.dur) {
      fl.landed = true
      this.land(fl)
    }
    if (this.time < flightEnd(fl)) return
    s.flight = null
    const r = result(s.pos)
    if (r) {
      const text = r.points === 3 ? 'Backgammon!' : r.points === 2 ? 'Gammon!' : 'All off!'
      const fx = this.ctx.fx
      fx.confetti(r.winner)
      fx.flash(SIDE[r.winner].main, 0.25)
      fx.shake(0.35)
      const t = TRAY[r.winner]
      fx.sparks(t.x + t.w / 2, t.y + t.h / 2, C.yellow, 24)
      if (this.roundWon(r.winner)) {
        s.end = { winner: r.winner, at: this.time, text }
        this.finish(r.winner, {
          score: [s.pos.off[0], s.pos.off[1]],
          ...(r.points > 1 ? { note: text } : {}),
          delay: 2.2,
        })
      } else this.pauseRound(r.winner)
      return
    }
    if (!s.more) this.endTurn()
  }

  private land(fl: Flight): void {
    const s = this.s
    const fx = this.ctx.fx
    const side = fl.side
    const hi = side === 0 ? 1 : 1.08
    if (fl.to === 0) {
      const at = spotOf(side, 0, s.pos.off[side] - 1)
      this.ctx.audio.play('coin', hi + s.pos.off[side] * 0.02)
      this.ctx.audio.buzz(10)
      fx.sparks(at.x, at.y, C.yellow, 10)
      fx.burst(at.x, at.y, SIDE[side].main, { count: 8, speed: 260, size: 9 })
      return
    }
    const at = spotOf(side, fl.to, Math.max(0, own(s.pos, side, fl.to) - 1))
    if (fl.hit) {
      const foe = other(side)
      this.ctx.audio.play('hit', hi)
      this.ctx.audio.play('slap', 0.9)
      this.ctx.audio.buzz(30)
      fx.stop(5)
      fx.shake(0.4)
      fx.ring(at.x, at.y, C.yellow, 110)
      fx.burst(at.x, at.y, SIDE[foe].main, { count: 22, speed: 480, size: 12 })
      fx.burst(at.x, at.y, C.white, { count: 8, speed: 300, size: 7, kind: 'spark' })
      fx.float('Hit!', at.x, at.y + (at.y > MID ? -90 : 90), C.yellow, 56, side)
    } else {
      // A long run lands with more weight than a step.
      const span = fl.from === BAR ? 6 : Math.abs(fl.from - fl.to)
      const k = Math.min(1, span / 12)
      this.ctx.audio.play('place', hi * (1.08 - k * 0.18))
      this.ctx.audio.buzz(Math.round(5 + k * 10))
      fx.puff(at.x, at.y + 10, 'rgba(255,255,255,0.35)', Math.round(3 + k * 4))
      if (k > 0.6) fx.shake(0.06 + k * 0.05)
    }
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    // The game may have been decided on this very step (last checker off): nothing more to play.
    if (this.over) return
    const s = this.s
    if (s.roll.length === 0) {
      if (tap && this.inDice(s.turn, tap)) this.roll()
      return
    }
    // No legal move for these dice: the turn passes without a tap.
    if (s.moves.length === 0) {
      this.pass()
      return
    }
    // Only one checker move possible: it plays itself after a beat.
    const key = `${s.ply}:${s.used.length}`
    if (this.forcedAt?.key !== key) this.forcedAt = { key, at: this.time }
    if (s.moves.length === 1 && this.time - this.forcedAt.at >= AUTO) {
      this.play(s.moves[0] as Step)
      return
    }
    if (!tap) return
    const t = targetAt(s.turn, tap.x, tap.y)
    if (!t) {
      s.sel = null
      return
    }
    if (s.sel !== null) {
      const m = s.moves.find(
        (m) =>
          m.from === s.sel &&
          (t.kind === 'tray' ? m.to === 0 : t.kind === 'point' && m.to === t.rel),
      )
      if (m) {
        this.play(m)
        return
      }
    }
    const from = t.kind === 'bar' ? BAR : t.kind === 'point' ? t.rel : null
    if (from === null || s.sel === from) {
      s.sel = null
      return
    }
    if (s.moves.some((m) => m.from === from)) {
      s.sel = from
      this.ctx.audio.play('tap', 1.1)
    } else {
      s.sel = null
      this.ctx.audio.play('error')
    }
  }

  protected botPlay(): void | Promise<void> {
    const s = this.s
    if (s.roll.length === 0) {
      this.roll()
      return
    }
    if (s.moves.length === 0) {
      this.pass()
      return
    }
    if (s.used.length === 0 || !this.plan[s.used.length]) {
      const origin = s.origin ?? s.pos
      const d = this.ctx.difficulty
      if (d === 'hard') {
        const ply = s.ply
        const st: AiState = { pos: origin, side: s.turn, dice: s.roll }
        return think<Step[]>('backgammon', st, d, this.ctx.rng.int(0, 2 ** 30)).then((plan) => {
          if (this.over || this.s.ply !== ply || !this.isBot(this.s.turn)) return
          this.plan = plan ?? []
          this.playPlanned()
        })
      }
      this.plan = planTurn(origin, s.turn, s.roll, d, this.ctx.rng)
    }
    this.playPlanned()
  }

  /** Play the next move of the plan, or any legal move if the plan went stale. */
  private playPlanned(): void {
    const s = this.s
    if (s.flight || s.moves.length === 0) return
    const want = this.plan[s.used.length]
    const st = s.moves.find((m) => sameStep(m, want)) ?? s.moves[0]
    if (st) this.play(st)
  }

  /** Bots roll briskly and take their moves quicker still. */
  protected override botDelay(): number {
    if (this.s.roll.length !== 0) return 0.28 + this.ctx.rng.range(0, 0.2)
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.55 : 0.4) + this.ctx.rng.range(0, 0.25)
  }

  private inDice(side: Side, tap: Ptr): boolean {
    const p = toLocal(side, tap.x, tap.y)
    return Math.abs(p.x - DICE.x) <= DICE.hit.w / 2 && Math.abs(p.y - DICE.y) <= DICE.hit.h / 2
  }

  private roll(): void {
    const s = this.s
    const side = s.turn
    const a = this.ctx.rng.int(1, 6)
    const b = this.ctx.rng.int(1, 6)
    s.roll = a === b ? [a, a, a, a] : [a, b]
    s.shown[side] = s.roll.slice()
    s.rolledAt[side] = this.time
    s.origin = clone(s.pos)
    s.used = []
    s.sel = null
    this.plan = []
    this.refresh()
    this.ctx.audio.play('roll')
    this.ctx.audio.buzz(10)
    this.ctx.fx.shake(0.08)
    const at = frame(side, DICE.x, DICE.y)
    this.ctx.fx.puff(at.x, at.y + (side === 0 ? 50 : -50), 'rgba(255,255,255,0.3)', 5)
    if (a === b) {
      this.ctx.fx.sparks(at.x, at.y, C.yellow, 14)
      this.ctx.audio.play('powerup', 1.2)
    }
  }

  private pass(): void {
    const s = this.s
    const side = s.turn
    const at = frame(side, DICE.x, DICE.y)
    this.ctx.fx.float('No move', at.x, at.y + (side === 0 ? -150 : 150), C.white, 50, side)
    this.ctx.audio.play('buzz', 0.9)
    s.wait = this.time + 0.6
    this.endTurn()
  }

  /** Recompute the moves the side to move can make next, from the turn's origin. */
  private refresh(): void {
    const s = this.s
    if (!s.origin || s.roll.length === 0) {
      s.moves = []
      return
    }
    s.moves = nextSteps(sequences(s.origin, s.turn, s.roll), s.used)
  }

  private play(st: Step): void {
    const s = this.s
    const side = s.turn
    s.pos = apply(s.pos, side, st)
    s.used.push(st)
    s.sel = null
    s.flight = {
      side,
      from: st.from,
      to: st.to,
      start: this.time,
      dur: FLIGHT,
      hit: st.hit,
      landed: false,
    }
    this.refresh()
    s.more = s.moves.length > 0
    this.ctx.audio.play('whoosh', 1.3)
  }

  private endTurn(): void {
    const s = this.s
    s.turn = other(s.turn)
    s.roll = []
    s.origin = null
    s.used = []
    s.moves = []
    s.sel = null
    s.more = false
    s.ply++
    this.plan = []
    if (s.ply >= PLY_CAP && !this.over) {
      const a = pips(s.pos, 0)
      const b = pips(s.pos, 1)
      const winner = a === b ? 'draw' : a < b ? 0 : 1
      if (this.roundWon(winner)) {
        this.finish(winner, { note: 'Turn limit: lower pip count wins', delay: 1 })
      } else this.pauseRound(winner)
    }
  }

  /** Count a round win; true when it was the round that wins the match. */
  private roundWon(winner: Side | 'draw'): boolean {
    if (winner === 'draw') return false
    const s = this.s
    s.wins[winner]++
    return s.wins[winner] >= this.target
  }

  /** The round is over but not the match: show who took it, then set up the board again. */
  private pauseRound(winner: Side | 'draw'): void {
    this.s.round = { winner, at: this.time }
    this.s.nextAt = this.time + ROUND_PAUSE
  }

  /** Set the board up for the next round; the player who did not open the last one starts. */
  private nextRound(): void {
    const s = this.s
    s.starter = other(s.starter)
    s.turn = s.starter
    s.pos = start()
    s.roll = []
    s.origin = null
    s.used = []
    s.moves = []
    s.sel = null
    s.shown = [[], []]
    s.more = false
    s.ply = 0
    s.round = null
    s.nextAt = -1
    this.plan = []
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.forcedAt = null
  }

  render(g: Draw): void {
    const s = this.s
    // Online, the move hints and the roll prompt show only on the mover's phone.
    const mine = g.viewer === null || g.viewer === s.turn
    tableBackdrop(g)
    renderBoard(
      g,
      {
        turn: s.turn,
        pos: s.pos,
        sel: mine ? s.sel : null,
        moves: s.moves,
        flight: s.flight,
        hints: mine && !this.isBot(s.turn) && this.time - s.rolledAt[s.turn] >= ROLL_T,
        end: s.end,
      },
      this.time,
    )
    renderDice(
      g,
      {
        turn: s.turn,
        pos: s.pos,
        roll: s.roll,
        used: s.used,
        shown: s.shown,
        rolledAt: s.rolledAt,
      },
      this.time,
      this.over,
      (side) => this.isBot(side) || (g.viewer !== null && g.viewer !== side),
    )
    this.drawTurns(g, undefined, s.nextAt < 0)
    if (this.target > 1) {
      roundPips(g, 0, s.wins[0], this.target)
      roundPips(g, 1, s.wins[1], this.target)
    }
    if (s.end) endBanner(g, s.end.text, s.end.winner, s.end.at, this.time)
    else if (s.round) {
      const { winner, at } = s.round
      const text = winner === 'draw' ? 'Draw round' : `${this.ctx.names[winner]} takes the round`
      banner(g, undefined, text, MID, { size: 58, alpha: Math.min(1, (this.time - at) * 4) })
    }
  }
}

export default () => new Backgammon()
