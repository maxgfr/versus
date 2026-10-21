import { DragAim } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import { think, TurnGame, type TurnState } from '../../engines/board/index.ts'
import { choose, type Shot } from './bot.ts'
import { type Aim, backdrop, drawBoard, drawTray, type Sink } from './render.ts'
import {
  type Board,
  type Event,
  atRest,
  frame,
  newBoard,
  placeStriker,
  POCKETS,
  resolve,
  strike,
} from './rules.ts'

interface State extends TurnState {
  board: Board
  /** Boards won, red first. */
  wins: [number, number]
  /** Boards played so far, counting the current one. */
  boardNo: number
  /** Game time the current board started (for its banner). */
  boardAt: number
  /** Held back until this time (a beat after a shot, or between boards). */
  wait: number
  /** Pieces that dropped in the last moments (their sink animation). */
  sinks: Sink[]
  /** Game time each side last added a piece to its tray. */
  trayAt: [number, number]
  /** Game time the current board was won (its banner), -1 while in play. */
  wonAt: number
}

/** Boards to win the match: first to N, each board a full game of carrom. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** The striker may be flicked from anywhere on the board. */
const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

class Carrom extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 420),
    new DragAim(1, EVERYWHERE, 420),
  ]
  /** Cosmetic: the flick being lined up. */
  private aiming: Aim | null = null
  /** The turn side is sliding the striker along its baseline. */
  private placing = false
  private gone = false

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // In local 2P the player whose turn it is may touch anywhere on the board.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    const first: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return {
      turn: first,
      board: newBoard(first),
      wins: [0, 0],
      boardNo: 1,
      boardAt: 0,
      wait: 0,
      sinks: [],
      trayAt: [-9, -9],
      wonAt: -1,
    }
  }

  protected override busy(): boolean {
    return this.s.board.phase === 'roll' || this.s.board.phase === 'done' || this.time < this.s.wait
  }

  protected override animate(dt: number): void {
    const s = this.s
    const b = s.board
    if (b.phase === 'roll') {
      const ev: Event[] = []
      frame(b, ev, dt)
      for (const e of ev) this.juice(e)
      if (atRest(b)) {
        const after: Event[] = []
        const before: [number, number] = [b.kept[0], b.kept[1]]
        const shooter = b.turn
        resolve(b, after)
        for (const e of after) {
          // The striker's drop was already felt; this is the penalty being paid.
          if (e.kind === 'foul') this.penalty(e.side, before[e.side] > b.kept[e.side])
        }
        for (const side of [0, 1] as Side[])
          if (b.kept[side] > before[side]) s.trayAt[side] = this.time
        if (b.turn === shooter && b.winner === null && b.kept[shooter] > before[shooter]) {
          floatFor(this.ctx.fx, shooter, 'Again!')
          this.ctx.audio.play('powerup', 1.1)
        }
        s.turn = b.turn
        // A winner is set exactly when the board is over.
        if (b.winner !== null) this.boardOver()
        else s.wait = this.time + 0.45
      }
      return
    }
    if (b.phase === 'done' && !this.over && this.time >= s.wait) this.nextBoard()
  }

  /** A board is decided: count it, and finish the match when the target is reached. */
  private boardOver(): void {
    const s = this.s
    const w = s.board.winner as Side
    s.wins[w]++
    s.wonAt = this.time
    const { fx, audio } = this.ctx
    fx.confetti(w)
    fx.flash(SIDE[w].main, 0.28)
    fx.shake(0.3)
    audio.play('coin', 1.1)
    if (s.wins[w] >= this.target) {
      this.finish(w, { score: [s.wins[0], s.wins[1]], delay: 2.4 })
      return
    }
    s.wait = this.time + 2.4
  }

  /** The next board, opened by the other side. */
  private nextBoard(): void {
    const s = this.s
    const first = other(s.board.striker.side)
    s.board = newBoard(first)
    s.turn = first
    s.boardNo++
    s.boardAt = this.time
    s.wait = this.time
    s.wonAt = -1
    s.sinks = []
    this.ctx.audio.play('whoosh', 0.8)
  }

  protected stepTurn(): void {
    const s = this.s
    const b = s.board
    const side = b.turn
    const input = this.ctx.input.player(side)
    if (b.phase === 'place') {
      const p = input.first()
      if (p) {
        placeStriker(b, p.x)
        this.placing = true
        return
      }
      const t = input.tapped()
      if (t || this.placing) {
        if (t) placeStriker(b, t.x)
        this.placing = false
        b.phase = 'flick'
      }
      return
    }
    if (b.phase === 'flick') {
      const a = this.aims[side]
      a.update(input)
      this.aiming = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
      if (a.shot) this.flick(a.shot.dx, a.shot.dy, a.shot.power)
    }
  }

  protected override botPlay(): Promise<void> {
    const b = this.s.board
    const side = b.turn
    const input = { board: b }
    const seed = (this.ctx.rng.next() * 2 ** 31) >>> 0
    return think<Shot>('carrom', input, this.ctx.difficulty, seed).then((shot) => {
      const now = this.s.board
      if (this.gone || now.phase !== 'place' || now.turn !== side) return
      const k = shot ?? choose(input, this.ctx.difficulty, seed)
      placeStriker(now, k.x)
      this.flick(k.dx, k.dy, k.power)
    })
  }

  override destroy(): void {
    this.gone = true
  }

  private flick(dx: number, dy: number, power: number): void {
    const b = this.s.board
    strike(b, dx, dy, power)
    this.placing = false
    this.aiming = null
    for (const a of this.aims) a.cancel()
    // Old sinks are done animating; keep the state small.
    this.s.sinks = this.s.sinks.filter((k) => this.time - k.at < 0.5)
    const { fx, audio } = this.ctx
    audio.play('slap', 0.8 + power * 0.4)
    fx.puff(b.striker.x, b.striker.y, 'rgba(255,255,255,0.7)', 6)
    fx.ring(b.striker.x, b.striker.y, alpha(C.white, 0.7), 60 + power * 60)
    fx.shake(0.04 + power * 0.08)
  }

  /** Nearest pocket to a point. */
  private pocketAt(x: number, y: number): { x: number; y: number } {
    let best = POCKETS[0] as { x: number; y: number }
    for (const k of POCKETS)
      if (Math.hypot(k.x - x, k.y - y) < Math.hypot(best.x - x, best.y - y)) best = k
    return best
  }

  /** A foul has been paid: one of the shooter's pocketed pieces goes back to the centre. */
  private penalty(side: Side, returned: boolean): void {
    const { fx, audio } = this.ctx
    audio.play('error')
    audio.buzz(12)
    fx.shake(0.2)
    floatFor(fx, side, returned ? 'Foul! −1' : 'Foul!')
    if (returned) this.s.trayAt[side] = this.time
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    const turn = s.board.turn
    if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 1500)
      audio.play('click', 0.8 + k * 0.8)
      if (e.speed > 600) fx.sparks(e.x, e.y, C.white, Math.round(3 + k * 6))
      if (e.speed > 1200) fx.shake(0.08)
    } else if (e.kind === 'rail') {
      audio.play('wall', 0.9 + Math.min(0.4, e.speed / 2000))
      if (e.speed > 900) fx.puff(e.x, e.y, 'rgba(255,240,210,0.6)', 3)
    } else if (e.kind === 'pot') {
      const k = this.pocketAt(e.x, e.y)
      s.sinks.push({ x: e.x, y: e.y, px: k.x, py: k.y, owner: e.owner, side: turn, at: this.time })
      const col = e.owner === 2 ? C.red : SIDE[e.owner as Side].main
      if (e.owner === 2) audio.play('score', 1.2)
      else if (e.owner === turn) audio.play('coin', 1)
      else audio.play('pop', 0.9)
      fx.burst(e.x, e.y, col, {
        count: 22,
        speed: 520,
        size: 14,
        life: 0.7,
        gravity: 200,
        drag: 2.4,
        colors: [col, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(k.x, k.y, col, 140)
      if (e.owner === turn) {
        fx.stop(3)
        fx.shake(0.12)
      }
      const fy = k.y < MID ? k.y + 110 : k.y - 110
      const fxx = k.x < W / 2 ? k.x + 110 : k.x - 110
      if (e.owner === 2) floatFor(fx, turn, 'Queen!', fxx, fy)
      else if (e.owner === turn) floatFor(fx, turn, '+1', fxx, fy)
      else floatFor(fx, e.owner as Side, 'Back!', fxx, fy)
    } else if (e.kind === 'foul') {
      // The striker itself dropped.
      const k = this.pocketAt(e.x, e.y)
      s.sinks.push({ x: e.x, y: e.y, px: k.x, py: k.y, owner: -1, side: e.side, at: this.time })
      audio.play('splash', 0.8)
      fx.flash(C.red, 0.12)
    }
  }

  render(g: Draw): void {
    const s = this.s
    const b = s.board
    backdrop(g)
    const live = (b.phase === 'place' || b.phase === 'flick') && this.time >= s.wait
    drawBoard(g, {
      board: b,
      time: this.time,
      aim: this.aiming,
      hint: live && !this.isBot(b.turn),
      live,
      sinks: s.sinks,
    })
    this.drawTurns(g, undefined, live)
    for (const side of [0, 1] as Side[]) {
      drawTray(g, side, b.kept[side], this.time, s.trayAt[side])
      if (this.target > 1) pips(g, side, s.wins[side], this.target, { x: W - 130 })
    }
    if (s.wonAt >= 0 && b.winner !== null) {
      const k = Math.min(1, (this.time - s.wonAt) / 0.25)
      const name = this.ctx.names[b.winner]
      const label = s.wins[b.winner] >= this.target ? `${name} wins!` : `${name} takes the board`
      banner(g, undefined, label, MID, { size: 50 + (1 - k) * 24, color: C.yellow })
    } else if (this.time - s.boardAt < 1.8 && s.boardNo > 1) {
      banner(g, undefined, `Board ${s.boardNo}`, MID)
    }
  }
}

export default () => new Carrom()
