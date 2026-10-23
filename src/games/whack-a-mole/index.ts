import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { frame, toLocal } from '../../core/frame.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { tapRipple } from '../../engines/reflex/index.ts'
import { MoleBot } from './bot.ts'
import { renderMoles } from './render.ts'
import {
  GAME_TIME,
  HOLES,
  holeAt,
  holeXY,
  MOLE_POINTS,
  pointsFor,
  QUICK,
  scheduleFor,
  tempoOf,
  winnerOf,
  type Pop,
  type PopKind,
} from './rules.ts'

export interface Cell {
  kind: PopKind
  /** When the pop started. */
  at: number
  /** When it goes back down if nobody whacks it. */
  until: number
  /** up: can be whacked. hit / bad: whacked (mole / bunny). down: gone. */
  st: 'up' | 'down' | 'hit' | 'bad'
  /** Game time the state last changed. */
  t: number
}

export interface State {
  /** The shared schedule of pops for the whole match. */
  plan: Pop[]
  /** Index of the next pop in `plan` to start. */
  next: number
  /** Each half's three-by-three grid, as it stands. */
  cells: [(Cell | null)[], (Cell | null)[]]
  score: [number, number]
  /** Game time each side's score last changed (for the pop). */
  scoreAt: [number, number]
  /** The result once the clock runs out, and when. */
  winner: Side | 'draw' | null
  endAt: number
  /** Seconds on the clock (the players' choice). */
  len: number
  /** Pop-rate multiplier set by the computer's level (1 without a bot), fixed at setup. */
  tempo: number
}

const emptyGrid = (): (Cell | null)[] => Array.from({ length: HOLES }, () => null)

/** Match length: a timed round. */
export const match: MatchSpec = { unit: 'seconds', default: GAME_TIME, min: 20, max: 120, step: 10 }

class WhackAMole extends BaseGame<State> {
  private bots: [MoleBot | null, MoleBot | null] = [null, null]

  protected setup(): State {
    const { ctx } = this
    this.bots = [0, 1].map((side) =>
      ctx.bots[side as Side] ? new MoleBot(ctx.rng.fork(), ctx.difficulty) : null,
    ) as [MoleBot | null, MoleBot | null]
    const len = ctx.target || match.default
    const tempo = tempoOf(ctx.difficulty, ctx.bots)
    return {
      plan: scheduleFor(ctx.rng, ctx.teams, len, tempo),
      next: 0,
      cells: [emptyGrid(), emptyGrid()],
      score: [0, 0],
      scoreAt: [-10, -10],
      winner: null,
      endAt: -1,
      len,
      tempo,
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this

    // Pops that are due start now, on both halves at once.
    for (;;) {
      const p = s.plan[s.next]
      if (!p || p.at > this.time) break
      s.next++
      for (const side of [0, 1] as Side[]) {
        s.cells[side][p.hole] = { kind: p.kind, at: p.at, until: p.at + p.dur, st: 'up', t: p.at }
        const w = frame(side, holeXY(p.hole).x, holeXY(p.hole).y)
        // A faster match kicks up a little more dirt.
        ctx.fx.puff(w.x, w.y, 'rgba(90,60,35,0.7)', s.tempo > 1 ? 8 : 5)
      }
    }

    // Whacks: humans from their taps, bots from their plan.
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      const holes = bot ? bot.drive(this.time, s.cells[side]) : this.tapped(side)
      for (const h of holes) this.whack(side, h)
    }

    // Pops that were not whacked go back down.
    for (const side of [0, 1] as Side[]) {
      for (const c of s.cells[side]) {
        if (c && c.st === 'up' && this.time >= c.until) {
          c.st = 'down'
          c.t = c.until
        }
      }
    }

    // The last seconds tick.
    const left = s.len - this.time
    if (left <= 5 && left > 0 && Math.ceil(left) !== Math.ceil(left + dt)) {
      ctx.audio.play('tick', left <= 1 ? 1.4 : 1.15)
    }

    if (this.time >= s.len && s.winner === null) {
      const w = winnerOf(s.score)
      s.winner = w
      s.endAt = this.time
      ctx.audio.play('buzz', 0.8)
      ctx.fx.shake(0.3)
      ctx.fx.flash('#ffffff', 0.25)
      if (w !== 'draw') ctx.fx.confetti(w)
      this.finish(w, { score: [s.score[0], s.score[1]], delay: 2 })
    }
  }

  /** Holes this side's humans tapped this step. Every tap ripples. */
  private tapped(side: Side): number[] {
    const { ctx } = this
    const out: number[] = []
    for (const p of ctx.input.player(side).downs) {
      tapRipple(ctx, side, p.x, p.y)
      const l = toLocal(side, p.x, p.y)
      const h = holeAt(l.x, l.y)
      if (h >= 0) out.push(h)
    }
    return out
  }

  /** A whack on a hole. Only a pop that is up can be whacked; the first whack counts. */
  private whack(side: Side, h: number): void {
    const s = this.s
    const { fx, audio } = this.ctx
    const c = s.cells[side][h]
    if (!c || c.st !== 'up') return
    const reaction = this.time - c.at
    const pts = pointsFor(c.kind, reaction)
    const quick = c.kind === 'mole' && pts > MOLE_POINTS
    s.score[side] += pts
    s.scoreAt[side] = this.time
    c.st = c.kind === 'mole' ? 'hit' : 'bad'
    c.t = this.time
    const { x, y } = holeXY(h)
    const p = frame(side, x, y)
    // "Above" the hole in the owner's frame, the same in every mode. Floats drift up for their reader,
    // so in 1P blue's top row would otherwise start at the top edge and run off it.
    const above = frame(side, x, y - 60)
    if (c.kind === 'mole') {
      // The quicker the whack, the harder it lands.
      const k = Math.max(0, Math.min(1, (QUICK + 0.3 - reaction) / 0.5))
      audio.play('hit', 0.9 + k * 0.25 + Math.random() * 0.08)
      audio.play('pop', 1.05 + k * 0.25 + Math.random() * 0.08)
      if (quick) audio.buzz(10 + Math.round(k * 12))
      fx.burst(p.x, p.y, '#8b5a2b', {
        count: 8 + Math.round(k * 8),
        speed: 300 + k * 160,
        size: 12,
        life: 0.45,
        gravity: 700,
      })
      fx.sparks(p.x, p.y - 40, C.yellow, 6 + Math.round(k * 12))
      fx.ring(p.x, p.y - 40, quick ? C.yellow : SIDE[side].light, 120 + k * 80)
      fx.float(
        quick ? 'Quick! +2' : '+1',
        above.x,
        above.y,
        quick ? C.yellow : '#fff3c4',
        quick ? 80 : 84,
        side,
      )
      fx.shake(0.05 + k * 0.1)
      fx.stop(quick ? 3 : 2)
    } else {
      audio.play('buzz')
      audio.play('boing', 0.8)
      fx.burst(p.x, p.y, '#ffffff', { count: 12, speed: 320, size: 10, life: 0.5, gravity: 500 })
      fx.burst(p.x, p.y - 60, '#ff6b8a', {
        count: 6,
        speed: 220,
        size: 26,
        life: 0.7,
        gravity: -200,
        kind: 'emoji',
        glyph: '💢',
      })
      fx.float('-2', above.x, above.y, '#ff6b6b', 96, side)
      fx.shake(0.2)
      audio.buzz(40)
    }
  }

  render(g: Draw): void {
    renderMoles(g, this.s, this.time, {
      names: this.ctx.names,
      over: this.over,
      left: this.s.len - this.time,
    })
  }
}

export default () => new WhackAMole()
