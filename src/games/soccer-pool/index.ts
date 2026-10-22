import { DragAim } from '../../core/controls.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import type { Disc } from '../../engines/puck/index.ts'
import { type Pick, plan, TUNING } from './bot.ts'
import { render, type Aim } from './render.ts'
import {
  BALL_R,
  type Event,
  formation,
  newWorld,
  ownDiscs,
  RINK,
  SHOT_SPEED,
  shoot,
  shotClock,
  step,
  winner,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** The shot being lined up (for the aim guide), null when nobody is pulling. */
  aim: Aim | null
  /** Set once the match is decided: the winner and when (this.time). */
  end: { side: Side; at: number } | null
}

/** Goals to win, chosen by the players before the match. */
export const match: MatchSpec = { unit: 'points', default: 3, min: 1, max: 9 }

/** Whole table is the drag zone: the player to play may pull from anywhere. */
const ZONE = { x: -600, y: -600, w: 2200, h: 3000 }
const MAX_PULL = 360

function copyDiscs(discs: Disc[]): Disc[] {
  const out: Disc[] = []
  for (const d of discs) out.push({ ...d })
  return out
}

/** The disc of `side` nearest to a press point (the disc you grab). */
function nearestOwn(w: World, side: Side, o: { x: number; y: number }): number | null {
  let best: number | null = null
  let bd = Infinity
  for (const i of ownDiscs(w, side)) {
    const d = w.discs[i]
    if (!d) continue
    const dd = Math.hypot(d.x - o.x, d.y - o.y)
    if (dd < bd) {
      bd = dd
      best = i
    }
  }
  return best
}

class SoccerPool extends BaseGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, ZONE, MAX_PULL),
    new DragAim(1, ZONE, MAX_PULL),
  ]
  // Cosmetic only (not synced): previous positions for interpolation, springs, spin.
  private prev: { ball: Disc; discs: Disc[] } | null = null
  private squash: Spring[] = []
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private spin = 0
  private trail: { x: number; y: number }[] = []
  /** Seconds the computer has been thinking about its flick. */
  private thinking = 0
  private thinkFor = 0
  /** The computer's search, advanced a couple of trials per step while it thinks. */
  private search: Generator<void, Pick> | null = null
  private picked: Pick | null = null
  /** Last whole second of the shot clock that ticked (cosmetic). */
  private lastTick = -1
  /** Fading afterimages behind fast discs, per disc (cosmetic). */
  private ghosts: { x: number; y: number }[][] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // Local 2P: whoever's turn it is may pull from anywhere on the pitch.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.w.turn
    const turn: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    this.squash = formation().map(() => new Spring(1, 380, 12))
    this.ghosts = formation().map(() => [])
    return { w: newWorld(turn, this.target), aim: null, end: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, discs: copyDiscs(w.discs) }
    const turn = w.turn
    for (const e of step(w, dt)) this.juice(e)
    if (w.phase !== 'aim' || w.turn !== turn) {
      this.s.aim = null
      this.thinking = 0
      this.search = null
      this.picked = null
      if (w.phase !== 'aim') return
    }
    this.shotClock()
    if (this.isBot(w.turn)) {
      if (this.thinking === 0) {
        this.thinkFor = TUNING[this.ctx.difficulty].think + this.ctx.rng.range(0, 0.3)
        this.search = plan(w, w.turn, this.ctx.difficulty, this.ctx.rng)
        this.picked = null
      }
      this.thinking += dt
      // Spread the search over the thinking time: a couple of trials per step.
      for (let k = 0; k < 2 && this.search && !this.picked; k++) {
        const r = this.search.next()
        if (r.done) this.picked = r.value
      }
      if (this.thinking >= this.thinkFor && this.picked) {
        const p = this.picked
        this.thinking = 0
        this.search = null
        this.picked = null
        this.fire(p.disc, p.dx, p.dy, p.power)
      }
      return
    }
    this.thinking = 0
    this.stepTurn()
  }

  /** The last seconds of the shot clock tick, quicker and higher at the very end. */
  private shotClock(): void {
    const w = this.s.w
    const left = Math.ceil(shotClock(w) - w.t)
    if (left <= 5 && left > 0 && left !== this.lastTick) {
      this.lastTick = left
      this.ctx.audio.play('tick', left <= 2 ? 1.4 : 1.15)
    }
    if (left > 5) this.lastTick = -1
  }

  private stepTurn(): void {
    const w = this.s.w
    const side = w.turn
    const a = this.aims[side]
    const origin = a.origin
    a.update(this.ctx.input.player(side))
    if (a.shot && origin) {
      const idx = nearestOwn(w, side, origin)
      if (idx !== null) this.fire(idx, a.shot.dx, a.shot.dy, a.shot.power)
      return
    }
    const f = a.finger
    const idx = origin ? nearestOwn(w, side, origin) : null
    if (a.aim && origin && f && idx !== null) {
      this.s.aim = {
        disc: idx,
        dx: a.aim.dx,
        dy: a.aim.dy,
        power: a.aim.power,
        ox: origin.x,
        oy: origin.y,
        fx: f.x,
        fy: f.y,
      }
    } else this.s.aim = null
  }

  private fire(idx: number, dx: number, dy: number, power: number): void {
    for (const e of shoot(this.s.w, idx, dx, dy, power)) this.juice(e)
    this.s.aim = null
    for (const a of this.aims) a.cancel()
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 1800)
      audio.play('hit', 0.8 + k * 0.6)
      if (e.speed > 250) fx.sparks(e.x, e.y, C.white, Math.round(4 + k * 10))
      if (e.speed > 600) fx.ring(e.x, e.y, alpha(C.white, 0.7), 60 + k * 70)
      if (e.speed > 900) fx.shake(0.1 + k * 0.16)
      if (e.speed > 1500) fx.stop(2)
      this.squashNearest(e.x, e.y, -2 - k * 3)
      if (e.speed > 1200) audio.buzz(8)
    } else if (e.kind === 'wall' || e.kind === 'post') {
      audio.play('wall', e.kind === 'post' ? 1.3 : 0.9 + Math.min(0.4, e.speed / 3000))
      if (e.speed > 700) fx.sparks(e.x, e.y, C.white, 5)
    } else if (e.kind === 'kick') {
      // The pull sets the power; the power sets the kick's sound, dust, ring and shake.
      const p = e.speed / SHOT_SPEED
      audio.play('shoot', 0.9 + p * 0.4)
      const d = w.discs[e.disc]
      const x = d?.x ?? e.x
      const y = d?.y ?? e.y
      fx.puff(x, y, 'rgba(255,255,255,0.7)', 5 + Math.round(p * 6))
      fx.burst(x, y, SIDE[e.side].light, {
        count: Math.round(6 + p * 10),
        speed: 300 + p * 300,
        size: 9,
        life: 0.4,
        gravity: 0,
        drag: 4,
      })
      fx.ring(x, y, alpha(p > 0.9 ? C.yellow : SIDE[e.side].light, 0.7), 80 + p * 70)
      if (p > 0.85) {
        fx.shake(0.1 + (p - 0.85) * 0.6)
        audio.buzz(10)
      }
      this.squashNearest(e.x, e.y, -3 - p * 3)
    } else if (e.kind === 'goal') {
      const col = SIDE[e.side]
      // Side 0 scores in the top goal, side 1 in the bottom one.
      const gy = e.side === 0 ? RINK.y0 : RINK.y1
      audio.play('score')
      audio.buzz(30)
      fx.flash(col.main, 0.35)
      fx.shake(0.55)
      fx.stop(6)
      fx.burst(W / 2, gy, col.main, {
        count: 46,
        speed: 1100,
        size: 16,
        life: 1.1,
        gravity: 0,
        drag: 2.2,
        spread: Math.PI,
        dir: e.side === 0 ? Math.PI / 2 : -Math.PI / 2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(W / 2, gy, col.light, 360)
      floatFor(fx, e.side, 'GOAL!')
      this.pulse[e.side].kick(14)
      const won = winner(w, this.target)
      if (won !== null) {
        this.s.end = { side: won, at: this.time }
        fx.confetti(won)
        this.finish(won, { score: [w.score[0], w.score[1]], delay: 2.4 })
      } else audio.play('whoosh', 0.8)
    } else if (e.kind === 'timeout') {
      // A pull left hanging when time ran out must not fire on that side's next turn.
      for (const aim of this.aims) aim.cancel()
      this.s.aim = null
      audio.play('buzz', 0.8)
      floatFor(fx, e.side, 'Time!')
    } else if (e.kind === 'turn') {
      audio.play('tick', 1.1)
      // A soft chime on the new shooter's side, so 2P players feel the hand-over.
      const y = e.side === 0 ? RINK.y1 - 120 : RINK.y0 + 120
      fx.ring(W / 2, y, SIDE[e.side].light, 160)
    }
  }

  private squashNearest(x: number, y: number, kick: number): void {
    let best = -1
    let bd = Infinity
    this.s.w.discs.forEach((d, i) => {
      const dd = Math.hypot(d.x - x, d.y - y)
      if (dd < bd) {
        bd = dd
        best = i
      }
    })
    this.squash[best]?.kick(kick)
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const ip = (a: Disc, b: Disc | undefined): Disc =>
      b ? { ...a, x: lerp(b.x, a.x, alpha), y: lerp(b.y, a.y, alpha) } : a
    const ball = ip(w.ball, prev?.ball)
    const sp = Math.hypot(w.ball.vx, w.ball.vy)
    if (sp > 600 && w.phase === 'roll') this.trail.push({ x: ball.x, y: ball.y })
    else this.trail.shift()
    while (this.trail.length > 7) this.trail.shift()
    if (w.phase === 'roll') this.spin += sp / 60 / BALL_R
    for (const s of this.squash) s.update(1 / 60)
    for (const p of this.pulse) p.update(1 / 60)
    const discs = w.discs.map((d, i) => ip(d, prev?.discs[i]))
    discs.forEach((d, i) => {
      const gh = (this.ghosts[i] ??= [])
      if (Math.hypot(d.vx, d.vy) > 900 && w.phase === 'roll') gh.push({ x: d.x, y: d.y })
      else gh.shift()
      while (gh.length > 5) gh.shift()
    })
    render(g, w, {
      ball,
      trail: this.trail,
      discs,
      ghosts: this.ghosts,
      clock: w.phase === 'aim' ? Math.max(0, shotClock(w) - w.t) : -1,
      squash: this.squash.map((s) => s.value),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      spin: this.spin,
      aim: this.s.aim,
      names: this.ctx.names,
      target: this.target,
      status: [this.status(0), this.status(1)],
      turnLabel: this.turnLabel(w.turn),
      end: this.s.end ? { side: this.s.end.side, t: this.time - this.s.end.at } : null,
    })
  }

  /** Text under a name pill: whose shot it is, and whether the computer is thinking. */
  private status(side: Side): string | undefined {
    const w = this.s.w
    if (this.over || w.phase !== 'aim' || w.turn !== side) return undefined
    return this.isBot(side) ? 'Thinking…' : 'Your shot'
  }

  private turnLabel(side: Side): string {
    const mine = this.ctx.mode === '2p' ? false : side === this.ctx.local && !this.isBot(side)
    return mine ? 'Your shot' : `${this.ctx.names[side]}'s shot`
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    if (this.squash.length !== this.s.w.discs.length)
      this.squash = this.s.w.discs.map(() => new Spring(1, 380, 12))
  }
}

export default () => new SoccerPool()
