import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { tableBackdrop, TurnGame, type TurnState } from '../../engines/board/index.ts'
import { buttonHit, type ButtonLayout, frame, ROLL_TIME } from '../../engines/dice/index.ts'
import { choose } from './bot.ts'
import { BASE, FINISH, legalTokens, step, TOKENS, type Tokens, won } from './rules.ts'
import {
  CELL,
  DIE,
  endBanner,
  HOP,
  landTime,
  type Move,
  moveEnd,
  rankOf,
  renderLudo,
  tokenWorld,
} from './render.ts'

/** A match is first to N round wins; each round is one whole race home. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** Seconds a finished round stays on screen before the pawns go back to base. */
const ROUND_PAUSE = 2.4

export interface State extends TurnState {
  /** Who opens the current round; the other player opens the next one. */
  starter: Side
  /** Round wins per side. */
  wins: [number, number]
  /** A round that ended without deciding the match: its winner, and when it ended. */
  round: { winner: Side; at: number } | null
  /** Game time the next round is set up, or -1 while this round is live. */
  nextAt: number
  /** Progress of every token of both sides (see rules.ts). */
  tok: Tokens
  /** Face rolled this turn and not yet used; 0 = the side to move still has to roll. */
  face: number
  /** Last face each side rolled, for the dice on each half. */
  dice: [number, number]
  /** Game time of each side's last roll (for the tumble). */
  rolledAt: [number, number]
  /** Game time before which nothing happens (a pause after a pass). */
  wait: number
  /** The token currently hopping along the track, or null. */
  move: Move | null
  /** The winner and when the last token got home, for the closing celebration. */
  end: { winner: Side; at: number } | null
}

const DIE_HIT: ButtonLayout = { x: DIE.x, y: DIE.y, w: DIE.hit, h: DIE.hit }

/** A beat before a pawn with no real choice moves by itself. */
const AUTO = 0.35

class Ludo extends TurnGame<State> {
  private wasRolling = false
  /** Game time the current face became playable (for the automatic move). */
  private readyAt = -1

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
      tok: [Array(TOKENS).fill(BASE), Array(TOKENS).fill(BASE)],
      face: 0,
      dice: [1, 1],
      rolledAt: [-10, -10],
      wait: 0,
      move: null,
      end: null,
    }
  }

  protected override busy(): boolean {
    const s = this.s
    const rolling = this.time - s.rolledAt[s.turn] < ROLL_TIME
    if (this.wasRolling && !rolling) this.settled()
    this.wasRolling = rolling
    return s.move !== null || rolling || this.time < s.wait || s.nextAt >= 0
  }

  /** The die comes to rest: a thunk, and a cheer for a six. */
  private settled(): void {
    const s = this.s
    this.ctx.audio.play('place', 0.9)
    if (s.face === 6) {
      const at = frame(s.turn, DIE.x, DIE.y)
      this.ctx.fx.sparks(at.x, at.y, C.yellow, 16)
      this.ctx.fx.float('Six!', at.x, at.y - (s.turn === 0 ? 110 : -110), C.yellow, 60, s.turn)
      this.ctx.audio.play('powerup', 1.25)
    }
  }

  /** Plays hop and landing effects as the token's clock passes them, then ends the move. */
  protected override animate(): void {
    const s = this.s
    if (s.nextAt >= 0 && this.time >= s.nextAt) {
      this.nextRound()
      return
    }
    const m = s.move
    if (!m) return
    const n = m.path.length
    const fx = this.ctx.fx
    while (m.hop < n && this.time >= m.start + (m.hop + 1) * HOP) {
      m.hop++
      if (m.hop < n) {
        this.ctx.audio.play('tick', 1 + m.hop * 0.06)
        const p = tokenWorld(m.side, m.path[m.hop - 1] ?? m.to, m.token, 0)
        fx.puff(p.x, p.y + 14, 'rgba(255,255,255,0.25)', 2)
      }
    }
    if (!m.landed && this.time >= landTime(m)) {
      m.landed = true
      this.land(m)
    }
    if (this.time >= moveEnd(m)) this.complete(m)
  }

  private land(m: Move): void {
    const fx = this.ctx.fx
    const s = this.s
    const at = tokenWorld(m.side, m.to, m.token, rankOf(s.tok, m.side, m.token))
    const hi = m.side === 0 ? 1 : 1.1
    if (m.captured.length > 0) {
      this.ctx.audio.play('hit', hi)
      this.ctx.audio.play('boing', 0.8)
      this.ctx.audio.buzz(30)
      fx.stop(5)
      fx.shake(0.4)
      fx.ring(at.x, at.y, C.yellow, 120)
      fx.burst(at.x, at.y, SIDE[m.side].main, { count: 16, speed: 420, size: 12 })
      for (const c of m.captured) {
        const p = tokenWorld(c.side, c.prog, c.token, 0)
        fx.burst(p.x, p.y, SIDE[c.side].main, { count: 18, speed: 460, size: 12 })
        fx.burst(p.x, p.y, C.white, { count: 8, speed: 300, size: 6, kind: 'spark' })
      }
      fx.float('Captured!', at.x, at.y + (m.side === 0 ? -100 : 100), C.yellow, 54, m.side)
    } else if (m.to === FINISH) {
      this.ctx.audio.play('coin', hi)
      this.ctx.audio.play('score', hi)
      this.ctx.audio.buzz(18)
      fx.stop(3)
      fx.sparks(at.x, at.y, C.yellow, 20)
      fx.ring(at.x, at.y, SIDE[m.side].main, 100)
      fx.float('Home!', at.x, at.y + (m.side === 0 ? -90 : 90), C.yellow, 52, m.side)
    } else if (m.from === BASE) {
      this.ctx.audio.play('pop', hi)
      fx.burst(at.x, at.y, SIDE[m.side].main, { count: 12, speed: 320, size: 10 })
      fx.ring(at.x, at.y, SIDE[m.side].main, 70)
    } else {
      // A long run lands heavier than a short step.
      const k = Math.min(1, m.path.length / 6)
      this.ctx.audio.play('place', hi * (1.1 - k * 0.2))
      this.ctx.audio.buzz(Math.round(5 + k * 8))
      fx.puff(at.x, at.y + 16, 'rgba(255,255,255,0.4)', Math.round(3 + k * 4))
      if (k > 0.8) fx.shake(0.08)
    }
  }

  private complete(m: Move): void {
    const s = this.s
    s.move = null
    if (won(s.tok, m.side)) {
      this.ctx.fx.confetti(m.side)
      this.ctx.fx.flash(SIDE[m.side].main, 0.25)
      if (this.roundWon(m.side)) {
        s.end = { winner: m.side, at: this.time }
        this.finish(m.side, { note: 'All four pawns home', delay: 2.2 })
      } else this.pauseRound(m.side)
      return
    }
    // A six rolls again; anything else hands the turn over.
    s.face = 0
    if (m.face !== 6) s.turn = other(m.side)
  }

  /** Count a round win; true when it was the round that wins the match. */
  private roundWon(side: Side): boolean {
    const s = this.s
    s.wins[side]++
    return s.wins[side] >= this.target
  }

  /** The round is over but not the match: show who took it, then send the pawns home again. */
  private pauseRound(side: Side): void {
    this.s.round = { winner: side, at: this.time }
    this.s.nextAt = this.time + ROUND_PAUSE
  }

  /** Back to base for a new round; the player who did not open the last one starts. */
  private nextRound(): void {
    const s = this.s
    s.starter = other(s.starter)
    s.turn = s.starter
    s.tok = [Array(TOKENS).fill(BASE), Array(TOKENS).fill(BASE)]
    s.face = 0
    s.move = null
    s.round = null
    s.nextAt = -1
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    // The game may have been decided on this very step (last token home): nothing more to play.
    if (this.over) return
    const s = this.s
    if (s.face === 0) {
      if (tap && buttonHit(DIE_HIT, s.turn, tap.x, tap.y)) this.roll()
      return
    }
    const legal = legalTokens(s.tok, s.turn, s.face)
    // Nothing to move: the turn passes on its own, no tap needed.
    if (legal.length === 0) {
      this.pass()
      return
    }
    // No real choice (one pawn, or only pawns leaving base): it goes by itself after a beat.
    if (this.readyAt < 0) this.readyAt = this.time
    const same = legal.every((i) => (s.tok[s.turn][i] ?? BASE) === BASE)
    if ((legal.length === 1 || same) && this.time - this.readyAt >= AUTO) {
      this.move(legal[0] as number)
      return
    }
    if (!tap) return
    const i = this.tokenUnder(tap.x, tap.y)
    if (i < 0) return
    if (legal.includes(i)) this.move(i)
    else {
      this.ctx.audio.play('error')
      this.ctx.fx.puff(tap.x, tap.y, 'rgba(255,255,255,0.5)', 4)
    }
  }

  protected botPlay(): void {
    const s = this.s
    const side = s.turn
    if (s.face === 0) {
      this.roll()
      return
    }
    const legal = legalTokens(s.tok, side, s.face)
    if (legal.length === 0) {
      this.pass()
      return
    }
    this.move(choose(s.tok, side, s.face, this.ctx.difficulty, this.ctx.rng))
  }

  /** Bots roll briskly and hurry up between the steps of one turn. */
  protected override botDelay(): number {
    if (this.s.face !== 0) return 0.35 + this.ctx.rng.range(0, 0.2)
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.55 : 0.4) + this.ctx.rng.range(0, 0.25)
  }

  /** The legal token of the side to move under a world point (or any of its tokens), or -1. */
  private tokenUnder(x: number, y: number): number {
    const s = this.s
    const side = s.turn
    const legal = legalTokens(s.tok, side, s.face)
    let best = -1
    let bd = Infinity
    for (let i = 0; i < TOKENS; i++) {
      const p = tokenWorld(side, s.tok[side][i] ?? BASE, i, rankOf(s.tok, side, i))
      // Legal tokens win ties: a stacked square resolves to the one that can move.
      const d = Math.hypot(p.x - x, p.y - y) - (legal.includes(i) ? CELL * 0.3 : 0)
      if (d < bd && d < CELL * 0.8) {
        bd = d
        best = i
      }
    }
    return best
  }

  private roll(): void {
    this.readyAt = -1
    const s = this.s
    const face = this.ctx.rng.int(1, 6)
    s.face = face
    s.dice[s.turn] = face
    s.rolledAt[s.turn] = this.time
    this.ctx.audio.play('roll')
    this.ctx.audio.buzz(10)
    this.ctx.fx.shake(0.08)
    const at = frame(s.turn, DIE.x, DIE.y)
    this.ctx.fx.puff(at.x, at.y + (s.turn === 0 ? 60 : -60), 'rgba(255,255,255,0.3)', 5)
  }

  private pass(): void {
    const s = this.s
    const side = s.turn
    const at = frame(side, DIE.x, DIE.y)
    this.ctx.fx.float('No move', at.x, at.y + (side === 0 ? -110 : 110), C.white, 48, side)
    this.ctx.audio.play('buzz', 0.9)
    s.wait = this.time + 0.5
    const face = s.face
    s.face = 0
    if (face !== 6) s.turn = other(side)
  }

  private move(i: number): void {
    this.readyAt = -1
    const s = this.s
    const side = s.turn
    const before = s.tok
    const from = before[side][i] ?? BASE
    const r = step(before, side, i, s.face)
    const n = from === BASE ? 1 : r.to - from
    s.tok = r.tok
    s.move = {
      side,
      token: i,
      from,
      to: r.to,
      face: s.face,
      path: from === BASE ? [0] : Array.from({ length: n }, (_, k) => from + k + 1),
      // Where each captured rival stood, so it can be drawn there until it lands.
      captured: r.captured.map(([o, j]) => ({ side: o, token: j, prog: before[o][j] ?? BASE })),
      start: this.time,
      hop: 0,
      landed: false,
    }
    this.ctx.audio.play(from === BASE ? 'powerup' : 'tick', side === 0 ? 1 : 1.1)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.readyAt = -1
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    // Online, the roll prompt and the movable-pawn glow show only on the mover's phone.
    renderLudo(
      g,
      s,
      this.time,
      this.over,
      (side) => this.isBot(side) || (g.viewer !== null && g.viewer !== side),
    )
    this.drawTurns(g, undefined, s.nextAt < 0)
    if (this.target > 1) {
      pips(g, 0, s.wins[0], this.target)
      pips(g, 1, s.wins[1], this.target)
    }
    if (s.end) endBanner(g, 'All home!', s.end.winner, s.end.at, this.time)
    else if (s.round) {
      const text = `${this.ctx.names[s.round.winner]} takes the round`
      banner(g, undefined, text, MID, {
        size: 58,
        alpha: Math.min(1, (this.time - s.round.at) * 4),
      })
    }
  }
}

export default () => new Ludo()
