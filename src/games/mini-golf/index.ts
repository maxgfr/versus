import { DragAim } from '../../core/controls.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { type MatchSpec, type Side } from '../../core/game.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { banner, bigScore } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { think, TurnGame, type TurnState } from '../../engines/board/index.ts'
import { choose, type Shot } from './bot.ts'
import { type Aim, drawCard, drawHole } from './render.ts'
import type { Pt } from './rules.ts'
import {
  atRest,
  CUP_R,
  type Event,
  frame,
  halt,
  holeOver,
  holeScore,
  launch,
  makeGeo,
  MAX_ROLL,
  nextTurn,
  settle,
  spin,
  startTable,
  type Table,
  totals,
} from './rules.ts'

interface State extends TurnState {
  /** Hole being played, 0-based. */
  hole: number
  /** Template of the last hole, so the next one differs. */
  lastId: number
  table: Table
  /** Strokes per finished hole, red first. */
  card: [number[], number[]]
  /** aim: waiting for a putt. roll: balls moving. settle: a short beat after a roll. done: match over. */
  phase: 'aim' | 'roll' | 'settle' | 'done'
  /** End of the current settle beat (game time). */
  until: number
  rollAt: number
  holeAt: number
  /** Game time each bumper of the hole was last struck (its pop). */
  bumpAt: number[]
  /** The last putt (the putter's follow-through and the ball's kick). */
  shot: {
    side: Side
    x: number
    y: number
    dx: number
    dy: number
    power: number
    at: number
  } | null
}

/** Holes to play, chosen by the players before the match. */
export const match: MatchSpec = { unit: 'rounds', default: 6, min: 1, max: 9 }

/** The putter may start a drag anywhere on the course. */
const EVERYWHERE = { x: -600, y: -600, w: 2200, h: 3000 }

class MiniGolf extends TurnGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, EVERYWHERE, 300),
    new DragAim(1, EVERYWHERE, 300),
  ]
  /** The computer is searching for its shot in a worker: the windmills hold still meanwhile. */
  private waiting = false
  private gone = false
  /** Cosmetic: the putt being lined up. */
  private aiming: Aim | null = null
  /** Cosmetic: recent positions of each rolling ball. */
  private trails: [Pt[], Pt[]] = [[], []]
  /** Cosmetic: each ball's position at the previous step, for smooth motion between steps. */
  private prev: [Pt, Pt] | null = null
  /** Cosmetic: squash of each ball on impact (1 = round). */
  private squash: [Spring, Spring] = [new Spring(1, 420, 13), new Spring(1, 420, 13)]

  private get holes(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // In local 2P the player whose turn it is may drag anywhere on the course.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.turn
    const geo = makeGeo(this.ctx.rng)
    const table = startTable(geo)
    return {
      turn: nextTurn(table) ?? 0,
      hole: 0,
      lastId: geo.id,
      table,
      card: [[], []],
      phase: 'aim',
      until: 0,
      rollAt: 0,
      holeAt: 0,
      bumpAt: geo.bumpers.map(() => -9),
      shot: null,
    }
  }

  protected override step(dt: number): void {
    const [a, b] = this.s.table.balls
    this.prev = [
      { x: a.x, y: a.y },
      { x: b.x, y: b.y },
    ]
    super.step(dt)
  }

  protected override busy(): boolean {
    return this.s.phase !== 'aim'
  }

  protected override animate(dt: number): void {
    const s = this.s
    if (s.phase === 'roll') {
      const ev: Event[] = []
      frame(s.table, ev, dt)
      for (const e of ev) this.juice(e)
      if (atRest(s.table) || this.time - s.rollAt > MAX_ROLL) this.endRoll()
      return
    }
    if (s.phase === 'settle') {
      spin(s.table, dt)
      if (this.time >= s.until) this.afterSettle()
      return
    }
    if (s.phase === 'aim' && !this.waiting) spin(s.table, dt)
  }

  protected stepTurn(): void {
    const side = this.s.turn
    const a = this.aims[side]
    a.update(this.ctx.input.player(side))
    this.aiming = a.aim ? { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power } : null
    if (a.shot) this.strike(side, a.shot.dx, a.shot.dy, a.shot.power)
  }

  protected override botPlay(): Promise<void> {
    const side = this.s.turn
    const input = { table: this.s.table, side }
    const seed = (this.ctx.rng.next() * 2 ** 31) >>> 0
    this.waiting = true
    return think<Shot>('mini-golf', input, this.ctx.difficulty, seed).then((shot) => {
      this.waiting = false
      if (this.gone || this.s.phase !== 'aim' || this.s.turn !== side) return
      const k = shot ?? choose(input, this.ctx.difficulty, seed)
      this.strike(side, k.dx, k.dy, k.power)
    })
  }

  override destroy(): void {
    this.gone = true
  }

  private strike(side: Side, dx: number, dy: number, power: number): void {
    const s = this.s
    launch(s.table, side, dx, dy, power)
    s.phase = 'roll'
    s.rollAt = this.time
    const from = s.table.balls[side]
    s.shot = { side, x: from.x, y: from.y, dx, dy, power, at: this.time }
    this.aiming = null
    for (const a of this.aims) a.cancel()
    const b = s.table.balls[side]
    const { fx, audio } = this.ctx
    audio.play('hit', 0.85 + power * 0.5)
    if (power > 0.7) audio.play('swish', 1.1)
    fx.puff(b.x, b.y, 'rgba(255,255,255,0.8)', 6)
    fx.burst(b.x, b.y, C.grass, {
      count: Math.round(4 + power * 8),
      speed: 260 + power * 300,
      size: 8,
      life: 0.4,
      gravity: 0,
      drag: 4,
      spread: 1.4,
      dir: Math.atan2(-dy, -dx),
      colors: [C.grass, '#9be7a8', C.white],
      kind: 'square',
    })
    fx.shake(0.04 + power * 0.1)
    audio.buzz(Math.round(6 + power * 18))
    // The putter's force shows in the ball: a hard putt squashes it flat.
    this.squash[side].kick(-4 - power * 8)
    if (power > 0.9) {
      fx.stop(2)
      fx.ring(b.x, b.y, C.white, 90)
    }
  }

  /** The roll is over: score any ball that ran out of strokes and decide who putts next. */
  private endRoll(): void {
    const s = this.s
    // A roll cut short (a ball trapped by a windmill): nothing keeps drifting into the next putt.
    if (!atRest(s.table)) halt(s.table)
    const ev: Event[] = []
    settle(s.table, ev)
    for (const e of ev) this.juice(e)
    const over = holeOver(s.table)
    s.phase = 'settle'
    s.until = this.time + (over ? 1.8 : 0.6)
    if (!over) s.turn = nextTurn(s.table) ?? s.turn
  }

  private afterSettle(): void {
    const s = this.s
    if (!holeOver(s.table)) {
      s.phase = 'aim'
      return
    }
    s.card[0].push(holeScore(s.table.balls[0]))
    s.card[1].push(holeScore(s.table.balls[1]))
    if (s.card[0].length >= this.holes) {
      const [a, b] = totals(s.card)
      s.phase = 'done'
      s.holeAt = this.time
      const winner = a === b ? 'draw' : a < b ? 0 : 1
      const { fx } = this.ctx
      if (winner === 'draw') fx.confetti()
      else {
        fx.confetti(winner)
        fx.flash(SIDE[winner].main, 0.25)
      }
      this.finish(winner, { score: [a, b], delay: 2.4 })
      return
    }
    s.hole++
    const geo = makeGeo(this.ctx.rng, s.lastId, s.hole)
    s.lastId = geo.id
    s.table = startTable(geo)
    s.turn = nextTurn(s.table) ?? 0
    s.phase = 'aim'
    s.holeAt = this.time
    s.bumpAt = geo.bumpers.map(() => -9)
    s.shot = null
    this.trails = [[], []]
    this.prev = null
    this.ctx.audio.play('whoosh', 0.8)
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    // Impact strength (0..1) from the closing speed: it scales every reaction.
    const k = 'speed' in e ? Math.min(1, e.speed / 1300) : 0
    if (e.kind === 'wall' || e.kind === 'bump' || e.kind === 'mill' || e.kind === 'ball')
      this.kickNearest(e.x, e.y, k)
    if (e.kind === 'wall') {
      audio.play('wall', 0.9 + Math.min(0.5, e.speed / 1200))
      if (e.speed > 420) fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 8))
      if (e.speed > 900) {
        fx.shake(0.06 + k * 0.12)
        audio.buzz(8)
      }
    } else if (e.kind === 'bump') {
      audio.play('boing', 0.9 + Math.min(0.6, e.speed / 1400))
      fx.sparks(e.x, e.y, C.yellow, Math.round(8 + k * 10))
      fx.shake(0.06 + k * 0.12)
      audio.buzz(Math.round(6 + k * 12))
      // Pop the bumper that was struck.
      let best = 0
      let bd = Infinity
      s.table.geo.bumpers.forEach((p, i) => {
        const d = Math.hypot(p.x - e.x, p.y - e.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      s.bumpAt[best] = this.time
    } else if (e.kind === 'mill') {
      audio.play('thud', 1 + k * 0.3)
      fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 8))
      fx.shake(0.05 + k * 0.1)
      audio.buzz(10)
    } else if (e.kind === 'ball') {
      audio.play('click', 0.9 + Math.min(0.5, e.speed / 900))
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.6)', 5)
      fx.sparks(e.x, e.y, C.yellow, Math.round(3 + k * 9))
      if (e.speed > 600) {
        fx.shake(0.08 + k * 0.12)
        fx.stop(2)
        audio.buzz(14)
      }
    } else if (e.kind === 'holed') {
      const b = s.table.balls[e.side]
      b.holedAt = this.time
      const cup = s.table.geo.cup
      audio.play('coin')
      audio.play('score', 0.9)
      audio.buzz(14)
      fx.stop(4)
      fx.shake(0.18)
      if (e.strokes === 1) {
        fx.confetti(e.side)
        audio.play('powerup')
      }
      fx.burst(cup.x, cup.y, SIDE[e.side].main, {
        count: 28,
        speed: 520,
        size: 14,
        life: 0.8,
        gravity: 200,
        drag: 2.4,
        colors: [SIDE[e.side].main, SIDE[e.side].light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(cup.x, cup.y, SIDE[e.side].light, 170)
      fx.flash(SIDE[e.side].main, 0.16)
      floatFor(
        fx,
        e.side,
        e.strokes === 1 ? 'Hole in one!' : `In ${e.strokes}`,
        cup.x,
        cup.y - CUP_R - 40,
      )
    } else if (e.kind === 'picked') {
      audio.play('error')
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.7)', 8)
      floatFor(fx, e.side, 'Picked up', e.x, e.y - 60)
    }
  }

  /** Squash the ball nearest an impact, harder for a harder hit. */
  private kickNearest(x: number, y: number, k: number): void {
    const [a, b] = this.s.table.balls
    const i = Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? 0 : 1
    this.squash[i].kick(-2 - k * 7)
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    this.aiming = null
  }

  render(g: Draw, alpha = 1): void {
    const s = this.s
    // Smooth motion between fixed steps: draw each ball between its last two positions.
    const pos = s.table.balls.map((b, i): Pt => {
      const p = this.prev?.[i]
      return p && b.state === 'play'
        ? { x: lerp(p.x, b.x, alpha), y: lerp(p.y, b.y, alpha) }
        : { x: b.x, y: b.y }
    }) as [Pt, Pt]
    for (const b of s.table.balls) {
      const tr = this.trails[b.side]
      if (b.state === 'play' && Math.hypot(b.vx, b.vy) > 300) tr.push(pos[b.side])
      else tr.shift()
      while (tr.length > 7) tr.shift()
    }
    for (const sp of this.squash) sp.update(1 / 60)
    const look = {
      table: s.table,
      card: s.card,
      hole: s.hole,
      holes: this.holes,
      holeAt: s.phase === 'done' ? -9 : s.holeAt,
      time: this.time,
      turn: s.turn,
      live: s.phase === 'aim',
      aiming: s.phase === 'aim' ? this.aiming : null,
      bumpAt: s.bumpAt,
      trails: this.trails,
      pos,
      squash: [this.squash[0].value, this.squash[1].value] as [number, number],
      shot: s.shot,
    }
    drawHole(g, look)
    drawCard(g, 0, look)
    drawCard(g, 1, look)
    this.drawTurns(g, undefined, s.phase === 'aim')
    const [ta, tb] = totals(s.card)
    for (const side of [0, 1] as Side[]) {
      const total = side === 0 ? ta : tb
      bigScore(g, side, total, { x: 130 })
    }
    if (s.phase === 'done') {
      const label =
        ta === tb
          ? 'All square!'
          : `${this.ctx.names[ta < tb ? 0 : 1]} wins by ${Math.abs(ta - tb)}`
      const k = Math.min(1, (this.time - s.holeAt) / 0.25)
      banner(g, undefined, label, MID, { size: 50 + (1 - k) * 24, gap: 118, color: C.yellow })
    } else if (this.time - s.holeAt < 1.8) {
      const last = s.hole + 1 === this.holes && this.holes > 1
      banner(g, undefined, last ? 'Final hole!' : `Hole ${s.hole + 1} of ${this.holes}`, MID, {
        size: 50,
        gap: 118,
        alpha: Math.min(1, (1.8 - (this.time - s.holeAt)) / 0.3),
      })
    }
  }
}

export default () => new MiniGolf()
