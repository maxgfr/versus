import { DragAim } from '../../core/controls.ts'
import { lerp } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { choose, type Pick, TUNING } from './bot.ts'
import { type Aim, type Look, render } from './render.ts'
import {
  BR,
  type Ball,
  type Event,
  groupOf,
  HEAD,
  newWorld,
  placeCue,
  rerack,
  step,
  strike,
  winner,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** The stroke being lined up (for the guide), null when nobody is pulling. */
  aim: Aim | null
  /** The last stroke, for the cue-stick follow-through (at = this.time). */
  stroke: { x: number; y: number; dx: number; dy: number; power: number; at: number } | null
  /** Set once the match is decided: the winner and when (this.time). */
  end: { side: Side; at: number } | null
}

/** Racks to win (each rack is one 8-ball game), chosen by the players before the match. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** The whole table is the drag zone: the player to shoot may pull from anywhere. */
const ZONE = { x: -600, y: -600, w: 2200, h: 3000 }
const MAX_PULL = 380
/** Seconds a finished rack stays on screen before the next one is racked. */
const RACK_PAUSE = 2.4

class Pool extends BaseGame<State> {
  private aims: [DragAim, DragAim] = [
    new DragAim(0, ZONE, MAX_PULL),
    new DragAim(1, ZONE, MAX_PULL),
  ]
  private thinking = 0
  private thinkFor = 0
  private rackT = 0
  /** The computer's chosen stroke, shown drawing back while it "thinks". */
  private plan: Pick | null = null
  // Cosmetic only (not synced): previous positions for interpolation.
  private prev: Ball[] | null = null

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // Local 2P: whoever's turn it is may pull and tap from anywhere on the table.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.w.turn
    const breaker: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return { w: newWorld(breaker, this.ctx.rng), aim: null, stroke: null, end: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = w.balls.map((b) => ({ ...b }))
    for (const e of step(w, dt)) this.juice(e)
    if (w.phase === 'rack') {
      this.rackT += dt
      if (this.rackT >= RACK_PAUSE) {
        const won = winner(w, this.target)
        if (won !== null) {
          if (!this.over) {
            this.s.end = { side: won, at: this.time }
            this.finish(won, { score: [w.wins[0], w.wins[1]], delay: 2 })
          }
          return
        }
        this.rackT = 0
        rerack(w, this.ctx.rng)
      }
      return
    }
    if (w.phase === 'roll') {
      this.thinking = 0
      this.s.aim = null
      return
    }
    if (this.isBot(w.turn)) {
      if (this.thinking === 0) {
        this.thinkFor = TUNING[this.ctx.difficulty].think + this.ctx.rng.range(0, 0.3)
        this.plan = null
      }
      this.thinking += dt
      // Half way through its think, the computer picks its stroke and lines up the cue.
      if (!this.plan && this.thinking >= this.thinkFor * 0.4) {
        this.plan = choose(w, w.turn, this.ctx.difficulty, this.ctx.rng)
        if (w.phase === 'place' && this.plan.place) {
          placeCue(w, this.plan.place.x, this.plan.place.y)
          this.ctx.audio.play('place')
        }
      }
      const p = this.plan
      if (p && w.phase === 'aim') {
        const k = Math.min(1, (this.thinking - this.thinkFor * 0.4) / (this.thinkFor * 0.6))
        const c = w.balls[0]
        const cx = c?.x ?? 0
        const cy = c?.y ?? 0
        this.s.aim = {
          ox: cx,
          oy: cy,
          fx: cx,
          fy: cy,
          dx: p.dx,
          dy: p.dy,
          power: p.power * k,
          bot: true,
        }
      }
      if (this.thinking >= this.thinkFor) {
        this.thinking = 0
        this.botTurn()
      }
      return
    }
    this.thinking = 0
    this.humanTurn()
  }

  /** The computer: put the cue down if it must, then strike. */
  private botTurn(): void {
    const w = this.s.w
    const p = this.plan ?? choose(w, w.turn, this.ctx.difficulty, this.ctx.rng)
    this.plan = null
    if (w.phase === 'place' && p.place) placeCue(w, p.place.x, p.place.y)
    if (w.phase === 'place') placeCue(w, HEAD.x, HEAD.y)
    this.s.aim = null
    if (w.phase === 'aim') this.strikeNow(p.dx, p.dy, p.power)
  }

  /** Strike, with the follow-through and the crack. */
  private strikeNow(dx: number, dy: number, power: number): void {
    const w = this.s.w
    const c = w.balls[0]
    if (!c || !strike(w, dx, dy, power)) return
    for (const a of this.aims) a.cancel()
    this.s.aim = null
    this.s.stroke = { x: c.x, y: c.y, dx, dy, power, at: this.time }
    this.ctx.audio.play('hit', 0.8 + power * 0.5)
    if (power > 0.75) {
      this.ctx.fx.shake(0.12 + (power - 0.75))
      this.ctx.audio.buzz(12)
    }
    this.ctx.fx.puff(c.x - dx * BR, c.y - dy * BR, 'rgba(160,220,255,0.6)', 4)
  }

  /** A human: a tap places the cue when it is in hand; a pull from anywhere strikes. */
  private humanTurn(): void {
    const w = this.s.w
    const side = w.turn
    const inp = this.ctx.input.player(side)
    if (w.phase === 'place') {
      this.s.aim = null
      const tap = inp.downs[0]
      if (tap) {
        if (placeCue(w, tap.x, tap.y)) {
          this.ctx.audio.play('place')
          this.ctx.fx.ring(tap.x, tap.y, C.white, 70)
        } else this.ctx.audio.play('error')
      }
      return
    }
    const a = this.aims[side]
    const origin = a.origin
    a.update(inp)
    if (a.shot) {
      this.strikeNow(a.shot.dx, a.shot.dy, a.shot.power)
      return
    }
    const f = a.finger
    this.s.aim =
      a.aim && origin && f
        ? {
            ox: origin.x,
            oy: origin.y,
            fx: f.x,
            fy: f.y,
            dx: a.aim.dx,
            dy: a.aim.dy,
            power: a.aim.power,
          }
        : null
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'hit') {
      audio.play('click', 0.9 + Math.min(0.7, e.speed / 1300))
      if (e.speed > 500) fx.sparks(e.x, e.y, C.white, 4)
    } else if (e.kind === 'cushion') {
      audio.play('wall', 0.9 + Math.min(0.4, e.speed / 2000))
    } else if (e.kind === 'pot') {
      const w = this.s.w
      const shooter = w.turn
      const own = w.groups[shooter]
      const good = e.n !== 0 && (own === null ? e.n !== 8 : groupOf(e.n) === own)
      audio.play(e.n === 0 ? 'error' : 'pop', e.n === 8 ? 0.8 : 1 + e.n / 30)
      audio.play('chomp', 0.9)
      const col = e.n === 0 ? C.white : good ? SIDE[shooter].light : C.yellow
      fx.burst(e.x, e.y, col, {
        count: 16,
        speed: 320,
        size: 10,
        life: 0.6,
        gravity: 0,
        drag: 3,
        colors: e.n === 0 ? [C.white] : [col, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(e.x, e.y, col, 110)
      fx.shake(e.n === 8 ? 0.35 : 0.12)
      if (e.n === 8) fx.stop(4)
      if (good) fx.float('+1', e.x, e.y + (e.y < 900 ? 90 : -90), SIDE[shooter].light, 48, shooter)
    } else if (e.kind === 'foul') {
      audio.play('buzz')
      fx.flash(C.red, 0.15)
    } else if (e.kind === 'turn') {
      audio.play('tick', 1.1)
    } else if (e.kind === 'rack') {
      audio.play('score')
      fx.confetti(e.side)
      fx.flash(SIDE[e.side].main, 0.25)
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const balls = w.balls.map((b, i): Ball => {
      const p = prev?.[i]
      if (!p || !b.on || !p.on) return b
      return { ...b, x: lerp(p.x, b.x, alpha), y: lerp(p.y, b.y, alpha) }
    })
    const look: Look = {
      w,
      balls,
      aim: this.s.aim,
      stroke: this.s.stroke ? { ...this.s.stroke, t: this.time - this.s.stroke.at } : null,
      end: this.s.end ? { side: this.s.end.side, t: this.time - this.s.end.at } : null,
      names: this.ctx.names,
      target: this.target,
      status: [this.status(0), this.status(1)],
      active: [this.turnOf(0), this.turnOf(1)],
    }
    render(g, look, [!this.isBot(0), !this.isBot(1)])
  }

  private turnOf(side: Side): boolean {
    const w = this.s.w
    return w.turn === side && (w.phase === 'aim' || w.phase === 'place')
  }

  /** Text in a name pill: whose move it is (the tray shows the group). */
  private status(side: Side): string | undefined {
    const w = this.s.w
    if (w.phase === 'rack' || this.over || w.turn !== side || w.phase === 'roll') return undefined
    if (this.isBot(side)) return 'Thinking…'
    if (w.phase === 'place') return 'Ball in hand'
    const mine = this.ctx.mode === '2p' || side === this.ctx.local
    return mine ? 'Your shot' : undefined
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new Pool()
