import { other, type Side } from '../../core/game.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
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

export interface State extends TurnState {
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

class Ludo extends TurnGame<State> {
  private wasRolling = false

  protected setup(): State {
    return {
      turn: this.ctx.rng.chance(0.5) ? 0 : 1,
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
    return s.move !== null || rolling || this.time < s.wait
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
    const m = this.s.move
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
      fx.sparks(at.x, at.y, C.yellow, 20)
      fx.ring(at.x, at.y, SIDE[m.side].main, 100)
      fx.float('Home!', at.x, at.y + (m.side === 0 ? -90 : 90), C.yellow, 52, m.side)
    } else if (m.from === BASE) {
      this.ctx.audio.play('pop', hi)
      fx.burst(at.x, at.y, SIDE[m.side].main, { count: 12, speed: 320, size: 10 })
      fx.ring(at.x, at.y, SIDE[m.side].main, 70)
    } else {
      this.ctx.audio.play('place', hi)
      fx.puff(at.x, at.y + 16, 'rgba(255,255,255,0.4)', 4)
    }
  }

  private complete(m: Move): void {
    const s = this.s
    s.move = null
    if (won(s.tok, m.side)) {
      s.end = { winner: m.side, at: this.time }
      this.ctx.fx.confetti(m.side)
      this.ctx.fx.flash(SIDE[m.side].main, 0.25)
      this.finish(m.side, { note: 'All four pawns home', delay: 2.2 })
      return
    }
    // A six rolls again; anything else hands the turn over.
    s.face = 0
    if (m.face !== 6) s.turn = other(m.side)
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

  /** Bots hurry up between the steps of one turn. */
  protected override botDelay(): number {
    return this.s.face === 0 ? super.botDelay() : 0.45 + this.ctx.rng.range(0, 0.3)
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
    const s = this.s
    const face = this.ctx.rng.int(1, 6)
    s.face = face
    s.dice[s.turn] = face
    s.rolledAt[s.turn] = this.time
    this.ctx.audio.play('roll')
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
    s.wait = this.time + 0.9
    const face = s.face
    s.face = 0
    if (face !== 6) s.turn = other(side)
  }

  private move(i: number): void {
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

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    renderLudo(g, s, this.time, this.over, (side) => this.isBot(side))
    this.drawTurns(g)
    if (s.end) endBanner(g, 'All home!', s.end.winner, s.end.at, this.time)
  }
}

export default () => new Ludo()
