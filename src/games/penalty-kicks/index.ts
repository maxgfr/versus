import { Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { fingerTarget } from '../../engines/puck/index.ts'
import { decideKeeper, decideShot, type KeeperMemory, newKeeperMemory, TUNING } from './bot.ts'
import { type Outcome, render } from './render.ts'
import {
  type Ball,
  type Cmd,
  type Event,
  KEEPER_HOME,
  keeperOf,
  newWorld,
  outcome,
  type Shot,
  type World,
  step,
  trace,
} from './rules.ts'

interface State {
  w: World
  /** Each side's kicks so far, for the shootout tracker. */
  log: [Outcome[], Outcome[]]
  /** Game time of the current kick, -1 before it. */
  kickAt: number
  /** Game time the shootout was decided, -1 while it is on. */
  endAt: number
  winner: Side | null
}

/** Kicks each side takes before sudden death. */
export const match: MatchSpec = { unit: 'rounds', default: 5, min: 1, max: 10 }

/** A finger swipe from the shooter's half: where it went, and how many fixed steps it took. */
interface Swipe {
  id: number
  pts: { x: number; y: number }[]
  steps: number
}

/** Swipe → shot. Direction is the swipe, power is its speed, curl is how much the stroke bends sideways. */
function shotFromSwipe(pts: readonly { x: number; y: number }[], steps: number): Shot | null {
  const a = pts[0]
  const b = pts[pts.length - 1]
  if (!a || !b) return null
  const vx = b.x - a.x
  const vy = b.y - a.y
  const dist = Math.hypot(vx, vy)
  if (dist < 60) return null
  const secs = Math.max(1, steps) / 60
  const power = Math.max(0.2, Math.min(1, dist / secs / 2000))
  const mid = pts[Math.floor(pts.length / 2)] ?? a
  const curl = Math.max(-1, Math.min(1, (b.x - mid.x - (mid.x - a.x)) / 120))
  return { dx: vx / dist, dy: vy / dist, power, curl }
}

/** A keeper's finger flicking sideways fast enough to be a dive. */
const FLICK = 26

class Penalties extends BaseGame<State> {
  private mem: [KeeperMemory, KeeperMemory] = [newKeeperMemory(), newKeeperMemory()]
  private swipe: Swipe | null = null
  /** Seconds spent in the 'aim' phase (the bot shooter waits before kicking). */
  private aimT = 0
  // Cosmetic only (not synced): ball trail, squash, pulses, net ripple time.
  private prev: Ball | null = null
  private squash: [Spring, Spring] = [new Spring(1, 340, 12), new Spring(1, 340, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]

  private get rounds(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    return { w: newWorld(), log: [[], []], kickAt: -1, endAt: -1, winner: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { ...w.ball }
    const shooter = w.shooter
    const keeper = keeperOf(shooter)
    const cmd: Cmd = { keepX: [KEEPER_HOME, KEEPER_HOME], dive: [0, 0], shot: null }

    // The shooter: the bot waits a beat, a human swipes from anywhere in their half.
    if (w.phase === 'aim') {
      this.aimT += dt
      if (this.isBot(shooter)) {
        if (this.aimT >= TUNING[this.ctx.difficulty].wait) {
          cmd.shot = decideShot(w, this.ctx.difficulty, this.ctx.rng)
          this.aimT = 0
        }
      } else {
        cmd.shot = this.readSwipe(shooter)
        w.aim = this.swipe ? this.previewShot() : null
      }
    } else {
      this.aimT = 0
      this.swipe = null
      w.aim = null
    }

    // The keeper: a bot reads the ball, a human drags along the line and flicks to dive.
    if (this.isBot(keeper)) {
      const d = decideKeeper(w, keeper, this.ctx.difficulty, this.ctx.rng, this.mem[keeper], dt)
      cmd.keepX[keeper] = d.x
      cmd.dive[keeper] = d.dive
    } else {
      const p = this.ctx.input.player(keeper)
      const f = fingerTarget(p)
      cmd.keepX[keeper] = f ? f.x : null
      const finger = p.first()
      if (finger && w.phase === 'shot') {
        const vx = finger.x - finger.px
        const vy = finger.y - finger.py
        if (Math.abs(vx) > FLICK && Math.abs(vx) > 2 * Math.abs(vy))
          cmd.dive[keeper] = Math.sign(vx)
      }
    }

    const events = step(w, dt, cmd, this.rounds)
    for (const e of events) this.juice(e)
    if (w.phase === 'intro') this.s.kickAt = -1
    if (w.phase === 'over' && !this.over) {
      const winner = outcome(w.score, w.done, this.rounds)
      if (winner !== null) {
        this.s.endAt = this.time
        this.s.winner = winner
        this.ctx.fx.confetti(winner)
        this.ctx.fx.flash(SIDE[winner].main, 0.3)
        this.ctx.audio.play('coin', 1.2)
        this.finish(winner, { score: [w.score[0], w.score[1]], delay: 2 })
      }
    }
  }

  /** The swipe in progress, read from the shooter's pointer; returns the shot when released. */
  private readSwipe(side: Side): Shot | null {
    const p = this.ctx.input.player(side)
    const sw = this.swipe
    if (!sw) {
      const d = p.downs.find((q) => (side === 0 ? q.y > MID : q.y < MID))
      if (d) this.swipe = { id: d.id, pts: [{ x: d.x, y: d.y }], steps: 0 }
      return null
    }
    const cur = p.held.get(sw.id)
    if (cur) {
      sw.steps++
      const last = sw.pts[sw.pts.length - 1]
      if (!last || Math.hypot(cur.x - last.x, cur.y - last.y) > 4)
        sw.pts.push({ x: cur.x, y: cur.y })
      return null
    }
    this.swipe = null
    const up = p.ups.find((q) => q.id === sw.id)
    if (!up) return null
    sw.pts.push({ x: up.x, y: up.y })
    return shotFromSwipe(sw.pts, sw.steps)
  }

  private previewShot(): Shot | null {
    const sw = this.swipe
    return sw ? shotFromSwipe(sw.pts, Math.max(1, sw.steps)) : null
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const s = this.s
    if (e.kind === 'intro') {
      audio.play('go', 1.1)
    } else if (e.kind === 'kick') {
      s.kickAt = this.time
      audio.play('shoot', 0.9 + e.power * 0.3)
      audio.play('thud', 0.9)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.7)', 8)
      fx.burst(e.x, e.y, 'rgba(120,200,110,0.9)', {
        count: 10,
        speed: 420,
        size: 9,
        life: 0.5,
        gravity: 0,
        drag: 3,
      })
      fx.shake(0.1 + e.power * 0.12)
      if (e.power > 0.85) fx.stop(3)
      this.squash[e.side].kick(-3)
    } else if (e.kind === 'dive') {
      audio.play('whoosh', 1.1)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.6)', 8)
      this.squash[e.side].kick(-2)
    } else if (e.kind === 'goal') {
      const col = SIDE[e.side]
      s.log[e.side].push('goal')
      audio.play('score')
      audio.play('swish', 0.8)
      audio.buzz(30)
      fx.flash(col.main, 0.3)
      fx.shake(0.45)
      fx.stop(6)
      fx.confetti(e.side)
      fx.burst(e.x, e.y, col.main, {
        count: 34,
        speed: 760,
        size: 14,
        life: 0.9,
        gravity: 0,
        drag: 2.4,
        spread: Math.PI,
        dir: e.y > MID ? Math.PI / 2 : -Math.PI / 2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(e.x, e.y, col.light, 240)
      this.pulse[e.side].kick(14)
    } else if (e.kind === 'save') {
      const keeper = e.side
      s.log[other(keeper)].push('save')
      audio.play('slap', 1.1)
      audio.play('thud', 0.7)
      audio.buzz(20)
      fx.shake(0.35)
      fx.stop(5)
      fx.flash(SIDE[keeper].main, 0.2)
      fx.ring(e.x, e.y, C.yellow, 160)
      fx.burst(e.x, e.y, C.white, {
        count: 12,
        speed: 520,
        size: 30,
        life: 0.8,
        gravity: 260,
        drag: 1.6,
        spread: Math.PI * 2,
        kind: 'emoji',
        glyph: '🧤',
      })
      fx.sparks(e.x, e.y, C.yellow, 16)
      this.pulse[keeper].kick(8)
    } else if (e.kind === 'miss') {
      s.log[e.side].push('miss')
      audio.play('whoosh', 0.7)
      audio.play('error', 0.9)
      fx.shake(0.12)
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const ball = prev
      ? {
          ...w.ball,
          x: prev.x + (w.ball.x - prev.x) * alpha,
          y: prev.y + (w.ball.y - prev.y) * alpha,
        }
      : w.ball
    const dt = 1 / 60
    for (const s of this.squash) s.update(dt)
    for (const p of this.pulse) p.update(dt)
    render(g, w, {
      ball,
      squash: this.squash.map((s) => s.value),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      names: this.ctx.names,
      bots: this.ctx.bots,
      rounds: this.rounds,
      log: this.s.log,
      trail: w.phase === 'aim' && w.aim ? trace(w.aim, w.shooter) : null,
      kicked: this.s.kickAt >= 0 ? this.time - this.s.kickAt : -1,
      ended: this.s.endAt >= 0 ? this.time - this.s.endAt : -1,
      winner: this.s.winner,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new Penalties()
