import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { MID } from '../../core/stage.ts'
import { fingerTarget } from '../../engines/puck/index.ts'
import { type BotMemory, decide, newMemory, TUNING } from './bot.ts'
import { type Look, render } from './render.ts'
import {
  type Ball,
  type Crab,
  CRAB_R,
  type Event,
  landingOf,
  MAX_TOUCH,
  newWorld,
  SCUTTLE,
  step,
  winner,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** Set once the match is decided: the winner and when (this.time). */
  end: { side: Side; at: number } | null
}

/** Points to win, chosen by the players before the match. */
export const match: MatchSpec = { unit: 'points', default: 7, min: 3, max: 21 }

const SAND = 'rgba(241,211,148,0.85)'
/** A press this close to the crab (sideways) is a tap on it: it hops. */
const HOP_TAP = CRAB_R * 2

class CrabbyVolley extends BaseGame<State> {
  private mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): previous positions, squash and walk cycles, spin.
  private prev: { ball: Ball; crabs: Crab[] } | null = null
  private squash: Spring[] = []
  private walk: number[] = []
  private bumpAt: number[] = []
  private spin = 0
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  /** Ball squash (1 = round), kicked by bumps and landings. */
  private ballSquash = new Spring(1, 300, 11)
  private trail: { x: number; y: number; z: number }[] = []
  /** The net sags and springs back when the ball hits it. */
  private net = new Spring(0, 160, 6)

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const server: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    const w = newWorld(this.ctx.teams, server, this.ctx.rng)
    this.squash = w.crabs.map(() => new Spring(1, 360, 12))
    this.walk = w.crabs.map(() => 0)
    this.bumpAt = w.crabs.map(() => -10)
    return { w, end: null }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { ball: { ...w.ball }, crabs: w.crabs.map((c) => ({ ...c })) }
    const botPlans: ReturnType<typeof decide>[] = []
    for (const side of [0, 1] as Side[]) {
      botPlans[side] = this.isBot(side)
        ? decide(w, side, this.ctx.difficulty, this.ctx.rng, this.mem[side], dt)
        : { x: [], hop: [] }
    }
    const targetX: (number | null)[] = []
    const hopReq: boolean[] = []
    const speeds: number[] = []
    w.crabs.forEach((c, i) => {
      if (this.isBot(c.side)) {
        targetX.push(botPlans[c.side]?.x[i] ?? null)
        hopReq.push(botPlans[c.side]?.hop[i] ?? false)
        speeds.push(TUNING[this.ctx.difficulty].speed)
        return
      }
      // Humans: the crab scuttles under the finger; tapping on the crab itself hops it.
      // A press anywhere else only moves it, or every step into place would be a
      // 0.6 s hop that covers a fraction of the band and arrives too late.
      const inp = this.ctx.input.player(c.side)
      const f = fingerTarget(inp, c.lane)
      targetX.push(f ? f.x : null)
      const pressed = inp.downs.find(
        (p) =>
          (c.side === 0 ? p.y > MID : p.y < MID) &&
          (c.lane === undefined || p.lane === c.lane) &&
          Math.abs(p.x - c.x) < HOP_TAP,
      )
      hopReq.push(pressed !== undefined)
      speeds.push(SCUTTLE)
    })
    for (const e of step(w, dt, targetX, hopReq, this.ctx.rng, speeds)) this.juice(e)
    // A crab coming down from a hop squashes and kicks up sand.
    w.crabs.forEach((c, i) => {
      const was = this.prev?.crabs[i]
      if (was && was.hop >= 0 && c.hop < 0) {
        this.squash[i]?.kick(-5)
        this.ctx.fx.puff(c.x, c.y + 20, SAND, 4)
        this.ctx.audio.play('thud', 1.3)
      }
    })
    const won = winner(w, this.target)
    if (won !== null && !this.over) {
      this.s.end = { side: won, at: this.time }
      this.ctx.fx.confetti(won)
      this.finish(won, { score: [w.score[0], w.score[1]], delay: 2.4 })
    }
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    if (e.kind === 'hop') {
      audio.play('boing', 1.35)
      this.ctx.fx.puff(e.x, e.y + 20, SAND, 5)
      // Stretch on take-off.
      const i = this.crabIndex(e.side, e.x)
      if (i >= 0) this.squash[i]?.kick(4)
    } else if (e.kind === 'bump') {
      // Intensity: a spike (struck high in a hop) hits hardest.
      const p = e.power
      const k = Math.min(1, e.speed / 1100)
      audio.play('boing', 0.85 + Math.min(0.5, e.count * 0.12) + k * 0.15)
      fx.puff(e.x, e.y, SAND, 6 + Math.round(p * 5))
      fx.ring(e.x, e.y, p > 0.5 ? C.yellow : SIDE[e.side].light, 110 + p * 100)
      fx.burst(e.x, e.y, p > 0.5 ? C.yellow : C.white, {
        count: Math.round(8 + p * 14),
        speed: 520 + p * 600,
        size: 6,
        life: 0.3,
        gravity: 0,
        spread: Math.PI * (2 - p),
        dir: e.side === 0 ? -Math.PI / 2 : Math.PI / 2,
        kind: 'spark',
      })
      audio.play('slap', 1.5 - p * 0.4)
      if (p > 0.4) fx.shake(0.08 + p * 0.22)
      if (p > 0.6) {
        fx.stop(2 + Math.round(p * 3))
        fx.float('SPIKE!', e.x, e.y + (e.side === 0 ? -170 : 170), C.yellow, 56, e.side)
      }
      if (p > 0.3) audio.buzz(Math.round(8 + p * 20))
      if (e.count === MAX_TOUCH) audio.play('tick', 1.4)
      this.ballSquash.kick(-5 - p * 7)
      this.trail.length = 0
      const i = this.crabIndex(e.side, e.x)
      if (i >= 0) {
        this.squash[i]?.kick(-4 - p * 3)
        this.bumpAt[i] = this.time
      }
    } else if (e.kind === 'net') {
      audio.play('slap', 1.2)
      fx.puff(e.x, MID, SAND, 14)
      fx.shake(0.18)
      this.net.kick(30)
    } else if (e.kind === 'land') {
      const sp = Math.hypot(w.ball.vx, w.ball.vy, w.ball.vz)
      const k = Math.min(1, sp / 1800)
      audio.play('thud', 0.7 + k * 0.3)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.7)', 8 + Math.round(k * 8))
      fx.burst(e.x, e.y, SAND, {
        count: Math.round(10 + k * 14),
        speed: 380 + k * 480,
        size: 9,
        life: 0.6,
        gravity: 900,
        drag: 1.4,
        colors: [SAND, C.sand, '#ffffff'],
      })
      fx.ring(e.x, e.y, 'rgba(255,255,255,0.7)', 90 + k * 70)
      fx.shake(0.18 + k * 0.15)
      this.ballSquash.kick(-8)
    } else if (e.kind === 'point') {
      const col = SIDE[e.side]
      audio.play('score')
      audio.buzz(25)
      fx.flash(col.main, 0.2)
      fx.stop(4)
      this.pulse[e.side].kick(14)
      fx.burst(w.ball.x, w.ball.y, col.main, {
        count: 22,
        speed: 420,
        size: 12,
        life: 0.8,
        gravity: 500,
        drag: 1.6,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
    } else if (e.kind === 'serve') {
      audio.play('pop', 1.1)
    }
  }

  /** Index of the crab of `side` nearest `x` (-1 if none). */
  private crabIndex(side: Side, x: number): number {
    let best = -1
    let bd = Infinity
    this.s.w.crabs.forEach((c, i) => {
      if (c.side !== side) return
      const d = Math.abs(c.x - x)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    for (const s of this.squash) s.update(1 / 60)
    for (const p of this.pulse) p.update(1 / 60)
    this.ballSquash.update(1 / 60)
    this.net.update(1 / 60)
    const sp = Math.hypot(w.ball.vx, w.ball.vy)
    if (w.phase === 'rally') this.spin += (sp / 60 / 60) * (w.ball.vx >= 0 ? 1 : -1)
    const bp = prev?.ball
    const ball: Ball = bp
      ? {
          ...w.ball,
          x: lerp(bp.x, w.ball.x, alpha),
          y: lerp(bp.y, w.ball.y, alpha),
          z: lerp(bp.z, w.ball.z, alpha),
        }
      : w.ball
    // A trail only behind a fast ball (a spike).
    if (w.phase === 'rally' && sp > 780) this.trail.push({ x: ball.x, y: ball.y, z: ball.z })
    else this.trail.shift()
    while (this.trail.length > 6) this.trail.shift()
    const crabs: Crab[] = w.crabs.map((c, i) => {
      const p = prev?.crabs[i]
      if (!p) return c
      return { ...c, x: lerp(p.x, c.x, alpha), z: lerp(p.z, c.z, alpha) }
    })
    // Walk cycles advance with the distance a crab covers on the sand.
    w.crabs.forEach((c, i) => {
      const p = prev?.crabs[i]
      if (p) this.walk[i] = (this.walk[i] ?? 0) + Math.abs(c.x - p.x) * 0.05
    })
    const look: Look = {
      w,
      ball,
      trail: this.trail,
      ballSquash: this.ballSquash.value,
      net: this.net.value,
      landing: w.phase === 'rally' ? landingOf(w.ball) : null,
      teams: this.ctx.teams,
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      end: this.s.end ? { side: this.s.end.side, t: this.time - this.s.end.at } : null,
      crabs,
      crabSides: w.crabs.map((c) => c.side),
      walk: this.walk,
      squash: this.squash.map((s) => s.value),
      wow: this.bumpAt.map((t) => Math.max(0, 1 - (this.time - t) / 0.3)),
      spin: this.spin,
      names: this.ctx.names,
      target: this.target,
      score: [w.score[0], w.score[1]],
      status: [this.status(0, g.viewer), this.status(1, g.viewer)],
      active: [this.mine(0), this.mine(1)],
    }
    render(g, look)
  }

  /** Is the ball coming down on `side`'s sand? Then that side has to play it. */
  private mine(side: Side): boolean {
    const w = this.s.w
    if (w.phase !== 'rally') return false
    const land = landingOf(w.ball)
    return land !== null && (side === 0 ? land.y > MID : land.y < MID)
  }

  /** Text under a name pill: touches left for the side that has the ball, or a hint to hop. */
  private status(side: Side, viewer: Side | null): string | undefined {
    const w = this.s.w
    if (w.phase !== 'rally') return undefined
    if (w.last === side) {
      const left = MAX_TOUCH - w.count
      return left > 0 ? `${left} touch${left === 1 ? '' : 'es'} left` : 'Over the net!'
    }
    // Online, each phone shows only its own player's prompt.
    const own = viewer === null || viewer === side
    return this.mine(side) && !this.isBot(side) && own ? 'Tap your crab to hop!' : undefined
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    if (this.squash.length !== this.s.w.crabs.length) {
      this.squash = this.s.w.crabs.map(() => new Spring(1, 360, 12))
      this.walk = this.s.w.crabs.map(() => 0)
      this.bumpAt = this.s.w.crabs.map(() => -10)
    }
  }
}

export default () => new CrabbyVolley()
