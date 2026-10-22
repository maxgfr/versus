import { DragAim } from '../../core/controls.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
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
  validPlace,
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
  /** Ball in hand being dragged around by a finger, and whether it fits there. */
  hand: { x: number; y: number; ok: boolean } | null
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
  /** The computer's chosen stroke, shown drawing back while it "thinks". */
  private plan: Pick | null = null
  // Cosmetic only (not synced): previous positions for interpolation, ball roll
  // (phase and heading, accumulated from drawn motion), contact pops, tray pulses.
  private prev: Ball[] | null = null
  private roll = new Float64Array(16 * 4)
  private pop: Spring[] = Array.from({ length: 16 }, () => new Spring(1, 520, 16))
  private pulse: [Spring, Spring] = [new Spring(0, 240, 11), new Spring(0, 240, 11)]
  private trail: { x: number; y: number }[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    // Local 2P: whoever's turn it is may pull and tap from anywhere on the table.
    if (this.ctx.mode === '2p') this.ctx.input.assign = () => this.s.w.turn
    const breaker: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    return { w: newWorld(breaker, this.ctx.rng), aim: null, stroke: null, end: null, hand: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = w.balls.map((b) => ({ ...b }))
    for (const e of step(w, dt)) this.juice(e)
    if (w.phase === 'rack') {
      // The rules tick w.t while the rack stamp shows.
      if (w.t >= RACK_PAUSE) {
        const won = winner(w, this.target)
        if (won !== null) {
          if (!this.over) {
            this.s.end = { side: won, at: this.time }
            this.finish(won, { score: [w.wins[0], w.wins[1]], delay: 2 })
          }
          return
        }
        rerack(w, this.ctx.rng)
        this.ctx.audio.play('roll', 1.2)
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

  /** Strike, with the follow-through and the crack, all scaled by the stroke's power. */
  private strikeNow(dx: number, dy: number, power: number): void {
    const w = this.s.w
    const c = w.balls[0]
    if (!c || !strike(w, dx, dy, power)) return
    const { fx, audio } = this.ctx
    for (const a of this.aims) a.cancel()
    this.s.aim = null
    this.s.hand = null
    this.s.stroke = { x: c.x, y: c.y, dx, dy, power, at: this.time }
    audio.play('hit', 0.75 + power * 0.6)
    if (power > 0.45) audio.play('whoosh', 0.8 + power * 0.5)
    if (power > 0.6) {
      fx.shake(0.08 + (power - 0.6) * 0.5)
      audio.buzz(Math.round(6 + power * 12))
    }
    if (power > 0.9) fx.stop(2)
    // Chalk puff off the tip, more of it the harder the stroke.
    fx.puff(c.x - dx * BR, c.y - dy * BR, 'rgba(160,220,255,0.6)', Math.round(3 + power * 7))
    this.pop[0]?.kick(-2 - power * 5)
  }

  /**
   * A human: with the cue in hand a finger carries it (it follows the finger and
   * lands where the finger lifts; a plain tap works too); otherwise a pull from
   * anywhere strikes.
   */
  private humanTurn(): void {
    const w = this.s.w
    const side = w.turn
    const inp = this.ctx.input.player(side)
    if (w.phase === 'place') {
      this.s.aim = null
      const up = inp.ups[0]
      const held = inp.first()
      if (up) {
        this.s.hand = null
        if (placeCue(w, up.x, up.y)) {
          this.ctx.audio.play('place')
          this.ctx.fx.ring(up.x, up.y, C.white, 70)
          this.pop[0]?.kick(-5)
        } else this.ctx.audio.play('error')
      } else if (held) {
        const ok = validPlace(w, held.x, held.y)
        if (ok && this.s.hand && !this.s.hand.ok) this.ctx.audio.play('tick', 1.4)
        this.s.hand = { x: held.x, y: held.y, ok }
      }
      return
    }
    this.s.hand = null
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

  /** Number of the ball nearest a point, among those on the table. */
  private nearest(x: number, y: number, skip = -1): number {
    let best = -1
    let bd = Infinity
    for (const b of this.s.w.balls) {
      if (!b.on || b.n === skip) continue
      const d = (b.x - x) ** 2 + (b.y - y) ** 2
      if (d < bd) {
        bd = d
        best = b.n
      }
    }
    return best
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    if (e.kind === 'hit') {
      // k: 0 for a kiss, 1 for a full-blooded break.
      const k = Math.min(1, e.speed / 1900)
      audio.play('click', 0.85 + k * 0.75)
      if (e.speed > 450) fx.sparks(e.x, e.y, C.white, Math.round(3 + k * 10))
      if (e.speed > 1300) fx.shake(0.1 + k * 0.18)
      if (e.speed > 1700) {
        fx.stop(3)
        audio.buzz(14)
      } else if (e.speed > 900) audio.buzz(6)
      const a = this.nearest(e.x, e.y)
      const b = this.nearest(e.x, e.y, a)
      this.pop[a]?.kick(-1 - k * 4)
      this.pop[b]?.kick(-1 - k * 4)
    } else if (e.kind === 'cushion') {
      const k = Math.min(1, e.speed / 1800)
      audio.play('wall', 0.8 + k * 0.5)
      if (e.speed > 900) fx.puff(e.x, e.y, 'rgba(120,200,140,0.45)', Math.round(2 + k * 4))
    } else if (e.kind === 'pot') {
      const shooter = w.turn
      const own = w.groups[shooter]
      const good = e.n !== 0 && (own === null ? e.n !== 8 : groupOf(e.n) === own)
      audio.play(e.n === 0 ? 'error' : 'pop', e.n === 8 ? 0.8 : 1 + e.n / 30)
      audio.play('chomp', 0.9)
      const col = e.n === 0 ? C.white : good ? SIDE[shooter].light : C.yellow
      // The pocket coughs the burst back out onto the felt.
      fx.burst(e.x, e.y, col, {
        count: 16,
        speed: 360,
        size: 10,
        life: 0.6,
        gravity: 0,
        drag: 3,
        spread: Math.PI * 1.1,
        dir: Math.atan2(MID - e.y, W / 2 - e.x),
        colors: e.n === 0 ? [C.white] : [col, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(e.x, e.y, col, 110)
      fx.shake(e.n === 8 ? 0.35 : 0.12)
      audio.buzz(e.n === 8 ? 30 : 12)
      if (e.n === 8) fx.stop(5)
      if (good) {
        fx.float('+1', e.x, e.y + (e.y < MID ? 90 : -90), SIDE[shooter].light, 48, shooter)
        this.pulse[shooter].kick(12)
      }
    } else if (e.kind === 'foul') {
      audio.play('buzz')
      audio.buzz(20)
      fx.flash(C.red, 0.15)
      fx.shake(0.15)
    } else if (e.kind === 'turn') {
      audio.play('tick', 1.1)
      this.pulse[e.side].kick(6)
    } else if (e.kind === 'rack') {
      const col = SIDE[e.side]
      audio.play('score')
      audio.buzz(35)
      fx.flash(col.main, 0.3)
      fx.shake(0.4)
      fx.stop(6)
      fx.burst(W / 2, e.side === 0 ? H - 150 : 150, col.main, {
        count: 40,
        speed: 1000,
        size: 15,
        life: 1.1,
        gravity: 0,
        drag: 2.2,
        spread: Math.PI,
        dir: e.side === 0 ? -Math.PI / 2 : Math.PI / 2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.confetti(e.side)
      this.pulse[e.side].kick(16)
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const dt = 1 / 60
    const balls = w.balls.map((b, i): Ball => {
      const p = prev?.[i]
      if (!p || !b.on || !p.on) return b
      return { ...b, x: lerp(p.x, b.x, alpha), y: lerp(p.y, b.y, alpha) }
    })
    // Roll: each ball's printed spot turns over as far as the ball travelled on screen.
    const r = this.roll
    for (const b of balls) {
      const o = b.n * 4
      const mx = b.x - (r[o] ?? b.x)
      const my = b.y - (r[o + 1] ?? b.y)
      const d = Math.hypot(mx, my)
      if (d > 0.3 && d < 200) {
        r[o + 2] = (r[o + 2] ?? 0) + d / BR
        r[o + 3] = Math.atan2(my, mx)
      }
      r[o] = b.x
      r[o + 1] = b.y
    }
    // Trail behind a fast cue ball.
    const cue = balls[0]
    const cueSp = Math.hypot(w.balls[0]?.vx ?? 0, w.balls[0]?.vy ?? 0)
    if (cue && cue.on && w.phase === 'roll' && cueSp > 700) this.trail.push({ x: cue.x, y: cue.y })
    else this.trail.shift()
    while (this.trail.length > 6) this.trail.shift()
    for (const s of this.pop) s.update(dt)
    for (const p of this.pulse) p.update(dt)
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
      hand: this.s.hand,
      roll: r,
      pop: this.pop,
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      trail: this.trail,
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
    this.trail = []
  }
}

export default () => new Pool()
