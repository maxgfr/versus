import { other, type MatchSpec, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { tableBackdrop, TurnGame, type TurnState } from '../../engines/board/index.ts'
import { buttonHit, type ButtonLayout, frame } from '../../engines/dice/index.ts'
import { decide } from './bot.ts'
import { finished, GOAL, makeBoard, move, type Link } from './rules.ts'
import {
  type Anim,
  DIE,
  endBanner,
  HOP,
  LINK_PAUSE,
  LINK_T,
  renderSnakes,
  ROLL_T,
  spot,
  tokenSpot,
} from './render.ts'

/** The one board every game plays on (see rules.ts). */
const BOARD = makeBoard()

/** A match is first to N round wins; each round is one race to square 100. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** Seconds a finished round stays on screen before the pawns go back to start. */
const ROUND_PAUSE = 2.4

/** A roll in progress on screen: the token hops, then climbs or slides. */
export interface Move extends Anim {
  face: number
  /** Hop sounds already played. */
  hop: number
  landed: boolean
  arrived: boolean
  /** Sparkle trail steps emitted while climbing (host bookkeeping). */
  trail: number
  /** Game time the whole move is over. */
  end: number
}

export interface State extends TurnState {
  /** Who opens the current round; the other player opens the next one. */
  starter: Side
  /** Round wins per side. */
  wins: [number, number]
  /** A round that ended without deciding the match: its winner, and when it ended. */
  round: { winner: Side; at: number } | null
  /** Game time the next round is set up, or -1 while this round is live. */
  nextAt: number
  /** Square of each side's token: 0 = still off the board, 100 = home. */
  pos: [number, number]
  /** Last face each side rolled. */
  dice: [number, number]
  /** Game time of each side's last roll (for the tumble). */
  rolledAt: [number, number]
  /** Rolls each side has made, for the result note. */
  rolls: [number, number]
  anim: Move | null
  /** The winner and when they reached 100, for the closing celebration. */
  end: { winner: Side; at: number } | null
}

const DIE_HIT: ButtonLayout = { x: DIE.x, y: DIE.y, w: DIE.hit, h: DIE.hit }

class SnakesAndLadders extends TurnGame<State> {
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
      pos: [0, 0],
      dice: [1, 1],
      rolledAt: [-10, -10],
      rolls: [0, 0],
      anim: null,
      end: null,
    }
  }

  protected override busy(): boolean {
    return this.s.anim !== null || this.s.nextAt >= 0
  }

  /** Plays the hop, landing and link effects as the move's clock passes them, then ends the move. */
  protected override animate(): void {
    const s = this.s
    if (s.nextAt >= 0 && this.time >= s.nextAt) {
      this.nextRound()
      return
    }
    const a = s.anim
    if (!a) return
    const fx = this.ctx.fx
    const t0 = a.start + ROLL_T
    const n = a.path.length
    if (a.hop === 0 && this.time >= t0) {
      // The die has settled.
      this.ctx.audio.play('place', 0.9)
      if (a.face === 6) {
        const at = frame(a.side, DIE.x, DIE.y)
        fx.sparks(at.x, at.y, C.yellow, 14)
        fx.float('Six! Roll again', at.x, at.y - (a.side === 0 ? 170 : -170), C.yellow, 44, a.side)
      }
    }
    while (a.hop < n && this.time >= t0 + a.hop * HOP) {
      const sq = a.path[a.hop] ?? 0
      this.ctx.audio.play('tick', 1 + a.hop * 0.07)
      if (a.hop > 0 && a.path[a.hop - 1] === GOAL) {
        const p = spot(a.side, GOAL)
        this.ctx.audio.play('boing')
        fx.float('Bounce!', p.x, p.y + 70, C.white, 44, a.side)
      }
      if (a.hop > 0) {
        const p = spot(a.side, a.path[a.hop - 1] ?? sq)
        fx.puff(p.x, p.y + 20, 'rgba(255,255,255,0.3)', 2)
      }
      a.hop++
    }
    if (!a.landed && this.time >= t0 + n * HOP) {
      a.landed = true
      this.land(a)
    }
    // A trail of sparkles up the ladder.
    if (a.link && a.link.to > a.link.from && !a.arrived) {
      const c0 = t0 + n * HOP + LINK_PAUSE
      while (this.time >= c0 + a.trail * 0.09 && a.trail * 0.09 < LINK_T) {
        a.trail++
        const p = tokenSpot(a, a.side, a.link.to, this.time)
        fx.sparks(p.x, p.y, C.yellow, 3)
      }
    }
    if (a.link && !a.arrived && this.time >= t0 + n * HOP + LINK_PAUSE + LINK_T) {
      a.arrived = true
      this.arrive(a.link, a.side)
    }
    if (this.time >= a.end) this.complete()
  }

  private land(a: Move): void {
    const fx = this.ctx.fx
    const at = spot(a.side, a.path[a.path.length - 1] ?? a.from)
    const hi = a.side === 0 ? 1 : 1.12
    if (!a.link) {
      this.ctx.audio.play('pop', hi)
      fx.burst(at.x, at.y, SIDE[a.side].main, { count: 12, speed: 320, size: 10 })
      return
    }
    if (a.link.to > a.link.from) {
      this.ctx.audio.play('powerup', hi)
      fx.ring(at.x, at.y, C.yellow, 90)
      fx.sparks(at.x, at.y, C.yellow, 10)
    } else {
      // The snake bites.
      this.ctx.audio.play('chomp', 0.9)
      this.ctx.audio.play('hit', 0.8)
      fx.stop(6)
      fx.shake(0.45)
      fx.ring(at.x, at.y, C.orange, 110)
      fx.burst(at.x, at.y, C.green, { count: 16, speed: 420, size: 11 })
      fx.float('Snake!', at.x, at.y + (a.side === 0 ? -90 : 90), C.orange, 58, a.side)
    }
  }

  private arrive(link: Link, side: Side): void {
    const to = spot(side, link.to)
    const fx = this.ctx.fx
    if (link.to > link.from) {
      this.ctx.audio.play('coin', 1.1)
      fx.sparks(to.x, to.y, C.yellow, 18)
      fx.ring(to.x, to.y, C.yellow, 110)
      fx.float(
        `Ladder! +${link.to - link.from}`,
        to.x,
        to.y + (side === 0 ? -90 : 90),
        C.yellow,
        50,
        side,
      )
    } else {
      this.ctx.audio.play('thud', 1.1)
      fx.shake(0.25)
      fx.puff(to.x, to.y + 20, 'rgba(255,255,255,0.5)', 8)
      fx.float(`−${link.from - link.to}`, to.x, to.y + (side === 0 ? -80 : 80), C.white, 50, side)
    }
  }

  private complete(): void {
    const a = this.s.anim
    if (!a) return
    const s = this.s
    s.anim = null
    if (finished(s.pos[a.side])) {
      const p = spot(a.side, GOAL)
      const fx = this.ctx.fx
      fx.confetti(a.side)
      fx.flash(SIDE[a.side].main, 0.25)
      fx.sparks(p.x, p.y, C.yellow, 30)
      fx.ring(p.x, p.y, C.yellow, 160)
      if (this.roundWon(a.side)) {
        s.end = { winner: a.side, at: this.time }
        this.finish(a.side, { note: `Home in ${s.rolls[a.side]} rolls`, delay: 2.2 })
      } else this.pauseRound(a.side)
      return
    }
    // A six rolls again; anything else passes the turn.
    if (a.face !== 6) s.turn = other(a.side)
  }

  /** Count a round win; true when it was the round that wins the match. */
  private roundWon(side: Side): boolean {
    const s = this.s
    s.wins[side]++
    return s.wins[side] >= this.target
  }

  /** The round is over but not the match: show who got home, then send the pawns back to start. */
  private pauseRound(side: Side): void {
    this.s.round = { winner: side, at: this.time }
    this.s.nextAt = this.time + ROUND_PAUSE
  }

  /** Back to the start for a new round; the player who did not open the last one starts. */
  private nextRound(): void {
    const s = this.s
    s.starter = other(s.starter)
    s.turn = s.starter
    s.pos = [0, 0]
    s.rolls = [0, 0]
    s.anim = null
    s.round = null
    s.nextAt = -1
  }

  protected stepTurn(_dt: number, tap: Ptr | undefined): void {
    if (!tap || this.over) return
    if (buttonHit(DIE_HIT, this.s.turn, tap.x, tap.y)) this.roll()
  }

  protected botPlay(): void {
    if (decide(this.ctx.difficulty) === 'roll') this.roll()
  }

  private roll(): void {
    const s = this.s
    const side = s.turn
    const face = this.ctx.rng.int(1, 6)
    const m = move(s.pos[side], face, BOARD)
    const link = m.link ? { from: m.link.from, to: m.link.to } : null
    const tail = link ? LINK_PAUSE + LINK_T + 0.3 : 0.25
    s.dice[side] = face
    s.rolledAt[side] = this.time
    s.rolls[side]++
    s.anim = {
      side,
      from: s.pos[side],
      path: m.path,
      link,
      start: this.time,
      face,
      hop: 0,
      landed: false,
      arrived: false,
      trail: 0,
      end: this.time + ROLL_T + m.path.length * HOP + tail,
    }
    s.pos[side] = m.to
    this.ctx.audio.play('roll')
    this.ctx.fx.shake(0.08)
    const at = frame(side, DIE.x, DIE.y)
    this.ctx.fx.puff(at.x, at.y + (side === 0 ? 70 : -70), 'rgba(255,255,255,0.3)', 5)
  }

  render(g: Draw): void {
    const s = this.s
    tableBackdrop(g)
    renderSnakes(g, s, BOARD, this.time, this.over, (side) => this.isBot(side))
    this.drawTurns(g, undefined, s.nextAt < 0)
    if (this.target > 1) {
      pips(g, 0, s.wins[0], this.target)
      pips(g, 1, s.wins[1], this.target)
    }
    if (s.end) endBanner(g, 'Square 100!', s.end.winner, s.end.at, this.time)
    else if (s.round) {
      const text = `${this.ctx.names[s.round.winner]} takes the round`
      banner(g, undefined, text, MID, {
        size: 58,
        alpha: Math.min(1, (this.time - s.round.at) * 4),
      })
    }
  }
}

export default () => new SnakesAndLadders()
