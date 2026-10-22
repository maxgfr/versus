import { type MatchSpec, other, type Side } from '../../core/game.ts'
import { prog } from '../../core/fx/ease.ts'
import { banner, pips } from '../../core/hud.ts'
import type { Ptr } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { TurnGame } from '../../engines/board/index.ts'
import { choose } from './bot.ts'
import {
  backdrop,
  button,
  CELL,
  cellAtWorld,
  cellPos,
  drawFleetTracker,
  drawSea,
  drawShell,
  GRID,
  GX,
  inRect,
  peekRect,
  reticle,
  seaRect,
  seaTop,
  shuffleRect,
} from './render.ts'
import {
  CELLS,
  FLEET,
  fire,
  freshSea,
  HIT,
  isSunk,
  placeFleet,
  type Sea,
  shipName,
  sunkCount,
  UNTRIED,
  viewOf,
} from './rules.ts'

/** Seconds to hide your fleet before the guns open. Shuffle works only inside it. Every round starts with one. */
export const SETUP = 8
/** Seconds a shell is in the air. */
const FLIGHT = 0.62
/** Seconds the fleets stay on show after a round is decided, before the next round. */
const ROUND_TIME = 4.5

/**
 * How long a match lasts: first to N round wins (one fleet destroyed is one
 * round). The default is a single round, the classic match.
 */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

export interface Shell {
  /** Who fired. */
  by: Side
  /** Whose sea it lands on (the other side). */
  owner: Side
  cell: number
  t0: number
  landAt: number
}

export interface State {
  turn: Side
  seas: [Sea, Sea]
  shell: Shell | null
  /** Game time until which the turn waits after a landing (so the result can be read). -1 = free. */
  pauseUntil: number
  /** Game time each cell of each sea was shot at, or -10. */
  landedAt: [number[], number[]]
  /** Game time each ship of each sea was sunk, or -1. */
  revealAt: [number[], number[]]
  /** Whether each player is holding Peek. */
  peek: [boolean, boolean]
  /** The last sinking, for its banner. */
  sank: { by: Side; owner: Side; len: number; at: number } | null
  /** Game time each side last re-rolled its fleet (the ships pop back in), or -10. */
  shuffledAt: [number, number]
  /** Game time the last ship went down, or -1. */
  endAt: number
  /** Game time the setup (hiding your fleet, shuffling it) ends. Every round starts with one. */
  setupEnd: number
  /** Round wins, red first. */
  wins: [number, number]
  /** The side that opened the current round. Alternates every round. */
  starter: Side
  /** Between rounds: "Red takes the round", shown after the sinking. */
  roundText: string
  /** Game time the next round starts, or -1. */
  resetAt: number
}

/** What a round starts with: both fleets placed at random, the guns closed until `setupEnd`. */
type Round = Omit<State, 'turn' | 'starter' | 'wins' | 'roundText' | 'resetAt'>

function freshRound(rng: Rng, setupEnd: number): Round {
  const seas: [Sea, Sea] = [freshSea(rng), freshSea(rng)]
  const blank = () => Array<number>(CELLS).fill(-10)
  const none = () => Array<number>(FLEET.length).fill(-1)
  return {
    seas,
    shell: null,
    pauseUntil: -1,
    landedAt: [blank(), blank()],
    revealAt: [none(), none()],
    peek: [false, false],
    sank: null,
    shuffledAt: [-10, -10],
    endAt: -1,
    setupEnd,
  }
}

class SeaBattle extends TurnGame<State> {
  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const rng = this.ctx.rng
    // On a shared phone a touch on a sea belongs to whoever is firing, not to the half it sits in.
    this.ctx.input.assign = (x, y) => {
      const turn = this.s.turn
      if (inRect(x, y, seaRect(other(turn)))) return turn
      return y >= MID ? 0 : 1
    }
    const round = freshRound(rng, SETUP)
    const starter: Side = rng.chance(0.5) ? 0 : 1
    return { ...round, turn: starter, starter, wins: [0, 0], roundText: '', resetAt: -1 }
  }

  /** Picking a cell takes the computer a beat, not a pause: the shell flight already reads as its turn. */
  protected override botDelay(): number {
    const d = this.ctx.difficulty
    return (d === 'easy' ? 0.5 : d === 'normal' ? 0.4 : 0.3) + this.ctx.rng.range(0, 0.3)
  }

  protected override step(dt: number): void {
    this.handleButtons()
    super.step(dt)
  }

  /** The next round: fresh fleets, a new setup, and the other side opens. */
  private nextRound(): void {
    const s = this.s
    const starter = other(s.starter)
    Object.assign(s, freshRound(this.ctx.rng, this.time + SETUP), {
      turn: starter,
      starter,
      roundText: '',
      resetAt: -1,
    })
    this.boom = 0
  }

  /**
   * Online, the snapshot goes to the other phone. This device's unsunk ships
   * stay off the wire, so the rival cannot read them; sunk ships and shots are public.
   */
  override snapshot(): unknown {
    const snap = super.snapshot() as { s: State; t: number; r: unknown; p: unknown }
    // Once a round is decided, both fleets are shown to both players.
    if (this.over || this.s.resetAt >= 0) return snap
    const seas = snap.s.seas.map((sea, owner): Sea => {
      if (owner !== this.ctx.local) return sea
      return { ...sea, ships: sea.ships.map((cells, i) => (isSunk(sea, i) ? cells : [])) }
    }) as [Sea, Sea]
    return { ...snap, s: { ...snap.s, seas } }
  }

  /** Peek is held (local 2P only), Shuffle is tapped during setup. Both work for either side. */
  private handleButtons(): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      const inp = this.ctx.input.player(side)
      // Peek is a local-2P control only: elsewhere a finger in that corner must not reveal a fleet.
      const peek =
        this.ctx.mode === '2p' &&
        [...inp.held.values()].some((p) => inRect(p.x, p.y, peekRect(side)))
      if (peek !== s.peek[side]) s.peek[side] = peek
      if (this.time < s.setupEnd && inp.downs.some((p) => inRect(p.x, p.y, shuffleRect(side)))) {
        s.seas[side].ships = placeFleet(this.ctx.rng)
        s.shuffledAt[side] = this.time
        const c = { x: W / 2, y: seaTop(side) + GRID / 2 }
        this.ctx.fx.ring(c.x, c.y, '#bfe4ff', 380)
        this.ctx.fx.burst(c.x, c.y, '#8fd3ff', {
          count: 16,
          speed: 520,
          size: 10,
          life: 0.5,
          gravity: 0,
        })
        this.ctx.audio.play('swish', side === 0 ? 1 : 1.1)
      }
    }
  }

  protected override busy(): boolean {
    const s = this.s
    if (s.resetAt >= 0 || this.time < s.setupEnd) return true
    if (s.shell) {
      if (this.time >= s.shell.landAt) this.land()
      return true
    }
    if (s.pauseUntil >= 0) {
      if (this.time < s.pauseUntil) return true
      s.pauseUntil = -1
    }
    return false
  }

  protected stepTurn(_dt: number, _tap: Ptr | undefined): void {
    const turn = this.s.turn
    const target = other(turn)
    for (const p of this.ctx.input.player(turn).downs) {
      const cell = cellAtWorld(target, p.x, p.y)
      if (cell === null) continue
      if (this.s.seas[target].shots[cell] !== UNTRIED) {
        this.ctx.audio.play('error')
        continue
      }
      this.fire(cell)
      return
    }
  }

  protected botPlay(): void {
    const target = other(this.s.turn)
    this.fire(choose(viewOf(this.s.seas[target]), this.ctx.difficulty, this.ctx.rng))
  }

  private fire(cell: number): void {
    const s = this.s
    const by = s.turn
    const owner = other(by)
    s.shell = { by, owner, cell, t0: this.time, landAt: this.time + FLIGHT }
    const from = this.origin(by)
    const fx = this.ctx.fx
    fx.burst(from.x, from.y, C.yellow, {
      count: 14,
      speed: 420,
      size: 11,
      life: 0.4,
      kind: 'spark',
    })
    fx.puff(from.x, from.y, 'rgba(220,225,235,0.6)', 8)
    fx.ring(from.x, from.y, C.yellow, 160)
    fx.shake(0.12)
    this.ctx.audio.buzz(8)
    this.ctx.audio.play('shoot', by === 0 ? 1 : 1.1)
    this.ctx.audio.play('whoosh', 0.8)
  }

  /** The shell's launch point: the middle of the shooter's own sea. */
  private origin(side: Side): { x: number; y: number } {
    return { x: W / 2, y: seaTop(side) + GRID / 2 }
  }

  /** Resolve the shell that just landed: the hit, the splash, any sinking, the win. */
  private land(): void {
    const s = this.s
    const sh = s.shell
    if (!sh) return
    s.shell = null
    const fx = this.ctx.fx
    const next = fire(s.seas[sh.owner], sh.cell)
    s.seas[sh.owner] = next.sea
    s.landedAt[sh.owner][sh.cell] = this.time
    const { hit, sunk, ship, win } = next.shot
    const p = cellPos(sh.owner, sh.cell)
    let pause = 0.4
    const fire3 = ['#ffb13b', '#ff4b5c', '#ffcd3c', C.white]
    if (hit) {
      pause = 0.65
      this.ctx.audio.buzz(sunk ? 45 : 20)
      fx.burst(p.x, p.y, '#ffb13b', { count: 30, speed: 600, size: 16, life: 0.7, colors: fire3 })
      fx.burst(p.x, p.y, C.white, { count: 12, speed: 380, size: 10, life: 0.4, kind: 'spark' })
      fx.puff(p.x, p.y, 'rgba(70,74,88,0.75)', 9)
      fx.ring(p.x, p.y, '#ffb13b', 170)
      fx.shake(sunk ? 0.75 : 0.45)
      fx.stop(sunk ? 6 : 3)
      if (sunk) {
        pause = 1.35
        s.revealAt[sh.owner][ship] = this.time
        const cells = next.sea.ships[ship] ?? []
        s.sank = { by: sh.by, owner: sh.owner, len: cells.length, at: this.time }
        // The whole ship goes up, bow to stern.
        for (const c of cells) {
          const q = cellPos(sh.owner, c)
          fx.burst(q.x, q.y, '#ff8b3d', {
            count: 16,
            speed: 480,
            size: 14,
            life: 0.8,
            colors: fire3,
          })
          fx.burst(q.x, q.y, '#8fd3ff', { count: 8, speed: 300, size: 9, life: 0.6, gravity: 700 })
        }
        fx.ring(p.x, p.y, C.yellow, 300)
        fx.flash(SIDE[sh.by].main, 0.22)
        this.ctx.audio.play('explode', 0.75)
        this.ctx.audio.play('thud', 0.8)
      } else {
        this.ctx.audio.play('explode', sh.by === 0 ? 1.15 : 1.25)
      }
      fx.float(
        sunk ? 'Sunk!' : 'Hit!',
        p.x,
        p.y - 50,
        sunk ? C.yellow : C.orange,
        sunk ? 84 : 70,
        sh.by,
      )
    } else {
      fx.ring(p.x, p.y, '#e8f6ff', 160)
      fx.burst(p.x, p.y, '#8fd3ff', { count: 18, speed: 340, size: 10, life: 0.6, gravity: 800 })
      fx.burst(p.x, p.y, C.white, { count: 6, speed: 200, size: 7, life: 0.5, gravity: 600 })
      fx.shake(0.05)
      this.ctx.audio.play('splash', sh.by === 0 ? 1 : 1.1)
    }
    s.turn = other(sh.by)
    s.pauseUntil = this.time + pause
    if (win) {
      s.endAt = this.time
      s.wins[sh.by]++
      fx.confetti(sh.by)
      fx.flash(SIDE[sh.by].main, 0.35)
      fx.shake(1)
      // A single round ends the match as it always did.
      if (s.wins[sh.by] >= this.target) {
        const score: [number, number] =
          this.target > 1 ? [s.wins[0], s.wins[1]] : [sunkCount(s.seas[1]), sunkCount(s.seas[0])]
        this.finish(sh.by, { score, delay: 3 })
      } else {
        s.roundText = `${this.ctx.names[sh.by]} takes the round`
        s.resetAt = this.time + ROUND_TIME
      }
    }
  }

  protected override animate(dt: number): void {
    // The rival's sea keeps burning while a round is decided.
    if (this.s.endAt >= 0) this.burn(dt)
    if (this.s.resetAt >= 0 && this.time >= this.s.resetAt) this.nextRound()
  }

  /** The rival's sea keeps burning while the ending plays. */
  private boom = 0
  protected override afterEnd(dt: number): void {
    if (this.s.endAt >= 0) this.burn(dt)
  }

  private burn(dt: number): void {
    const s = this.s
    this.boom -= dt
    if (this.boom > 0) return
    this.boom = 0.28
    const loser = s.turn
    const burning = s.seas[loser].shots.flatMap((v, i) => (v === HIT ? [i] : []))
    const cell = burning[Math.floor(((this.time * 7.3) % 1) * burning.length)]
    if (cell === undefined) return
    const p = cellPos(loser, cell)
    this.ctx.fx.burst(p.x, p.y, '#ffb13b', {
      count: 12,
      speed: 380,
      size: 12,
      life: 0.6,
      colors: ['#ffb13b', '#ff4b5c', '#ffcd3c'],
    })
    this.ctx.fx.shake(0.15)
  }

  /** Whose fleet this screen may show without Peek: the local player's, outside local 2P. */
  private shown(side: Side): boolean {
    if (this.ctx.mode === '2p') return this.s.peek[side]
    return side === this.ctx.local || this.s.peek[side]
  }

  render(g: Draw): void {
    const s = this.s
    const setup = this.time < s.setupEnd
    const live = !this.over && !setup && s.shell === null && s.pauseUntil < 0 && s.resetAt < 0
    backdrop(g)
    for (const owner of [0, 1] as Side[]) {
      drawSea(g, owner, s, this.time, {
        target: live && owner === other(s.turn),
        show: this.shown(owner),
        reveal: this.over || s.resetAt >= 0,
      })
      drawFleetTracker(g, owner, s, this.time)
    }
    // The pips take the corners where Shuffle sits during setup, so they show once the guns are open.
    if (this.target > 1 && !setup) {
      pips(g, 0, s.wins[0], this.target)
      pips(g, 1, s.wins[1], this.target)
    }
    // The computer lines up its shot: a reticle drifting over the sea it aims at.
    if (live && this.isBot(s.turn)) {
      const t = g.t
      const x = GX + GRID / 2 + Math.sin(t * 1.9) * GRID * 0.32 + Math.sin(t * 4.3) * CELL * 0.3
      const y = seaTop(other(s.turn)) + GRID / 2 + Math.cos(t * 1.4) * GRID * 0.3
      reticle(g, x, y, 1, t * 3, 0.75)
    }
    drawShell(g, s, this.time, (o) => this.origin(o))
    const left = Math.max(1, Math.ceil(s.setupEnd - this.time))
    this.drawTurns(g, setup ? [`Battle in ${left}`, `Battle in ${left}`] : undefined, live || setup)
    if (!this.over) {
      for (const side of [0, 1] as Side[]) {
        if (this.isBot(side)) continue
        // Online, each phone shows only its own player's buttons.
        if (g.viewer !== null && side !== g.viewer) continue
        if (this.ctx.mode === '2p')
          button(g, side, peekRect(side), 'Peek', '👀', { on: s.peek[side], pressed: s.peek[side] })
        if (setup)
          button(g, side, shuffleRect(side), 'Shuffle', '🎲', {
            on: true,
            pressed: this.time - (s.shuffledAt[side] ?? -10) < 0.12,
            progress: Math.max(0, (s.setupEnd - this.time) / SETUP),
          })
      }
    }
    // In local 2P, a reminder in each empty sea during setup: your ships are there, hidden.
    if (setup && this.ctx.mode === '2p') {
      for (const side of [0, 1] as Side[]) {
        if (s.peek[side] || this.isBot(side)) continue
        const a = Math.min(1, this.time * 3) * (0.85 + 0.15 * Math.sin(g.t * 4))
        banner(g, side, 'Hold Peek to see your ships', seaTop(side) + GRID / 2, {
          size: 40,
          alpha: a,
        })
      }
    }
    // The sinking is announced over the sea it happened on, upright for the player who fired.
    if (s.sank && this.time - s.sank.at < 1.6 && !this.over) {
      const a = Math.min(1, (this.time - s.sank.at) * 5)
      const y = seaTop(s.sank.owner) + GRID / 2
      banner(g, s.sank.by, `${shipName(s.sank.len)} sunk!`, y, {
        size: 58,
        alpha: a,
        color: C.yellow,
      })
    }
    if (s.endAt >= 0 && (this.over || s.resetAt >= 0)) {
      const winner = other(s.turn)
      const since = this.time - s.endAt
      const y = seaTop(s.turn) + GRID / 2
      // A round that decides nothing yet: the fleet is gone, then who took the round.
      if (s.roundText && since >= 2) {
        const a = prog(since, 2, 2.3)
        banner(g, winner, s.roundText, y, { size: 58, alpha: a, color: C.yellow })
      } else {
        const a = Math.min(1, since * 4)
        banner(g, winner, 'Fleet destroyed!', y, { size: 64, alpha: a, color: C.yellow })
      }
    }
  }
}

export default () => new SeaBattle()
