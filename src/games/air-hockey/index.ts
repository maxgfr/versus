import { BaseGame, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { type Disc, fingerTarget } from '../../engines/puck/index.ts'
import { type BotMemory, decide, newMemory, TUNING } from './bot.ts'
import { render } from './render.ts'
import { type Event, newWorld, RINK, step, type Target, winner, type World } from './rules.ts'

interface State {
  w: World
}

/** Humans move their mallet as fast as their finger; the rink is the limit. */
const HUMAN_SPEED = 5200

class AirHockey extends BaseGame<State> {
  private mem: BotMemory[] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): previous positions for interpolation, trail, springs.
  private prev: { puck: Disc; mallets: Disc[] } | null = null
  private trail: { x: number; y: number }[] = []
  private squash: Spring[] = []
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private servedAt = -10

  protected setup(): State {
    const server: Side = this.ctx.rng.chance(0.5) ? 0 : 1
    const w = newWorld(this.ctx.teams, server)
    this.squash = w.mallets.map(() => new Spring(1, 380, 12))
    return { w }
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = { puck: { ...w.puck }, mallets: w.mallets.map((m) => ({ ...m })) }
    const botTargets: Target[][] = [[], []]
    for (const side of [0, 1] as Side[]) {
      if (this.isBot(side))
        botTargets[side] = decide(
          w,
          side,
          this.ctx.difficulty,
          this.ctx.rng,
          this.mem[side] as BotMemory,
          dt,
        )
    }
    const targets = w.mallets.map((m, i): Target => {
      if (this.isBot(m.side)) return botTargets[m.side]?.[i] ?? null
      return fingerTarget(this.ctx.input.player(m.side), m.lane)
    })
    const speeds = w.mallets.map((m) =>
      this.isBot(m.side) ? TUNING[this.ctx.difficulty].speed : HUMAN_SPEED,
    )
    const events = step(w, dt, targets, speeds)
    for (const e of events) this.juice(e)
  }

  protected override afterEnd(dt: number): void {
    // Keep the mallets alive under the fingers while the ending plays.
    const w = this.s.w
    const targets = w.mallets.map((m) =>
      this.isBot(m.side) ? null : fingerTarget(this.ctx.input.player(m.side), m.lane),
    )
    if (w.phase === 'goal')
      step(
        w,
        dt,
        targets,
        w.mallets.map(() => HUMAN_SPEED),
      )
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    const w = this.s.w
    if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 2600)
      audio.play('hit', 0.8 + k * 0.6)
      if (e.speed > 700) fx.sparks(e.x, e.y, C.yellow, Math.round(6 + k * 14))
      if (e.speed > 1500) fx.shake(0.12 + k * 0.2)
      if (e.speed > 2300) fx.stop(2)
      // Squash the mallet that hit.
      let best = 0
      let bd = Infinity
      w.mallets.forEach((m, i) => {
        const d = Math.hypot(m.x - e.x, m.y - e.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      this.squash[best]?.kick(-3 - k * 4)
      if (e.speed > 1200) audio.buzz(10)
    } else if (e.kind === 'wall' || e.kind === 'post') {
      audio.play('wall', e.kind === 'post' ? 1.4 : 0.9 + Math.min(0.4, e.speed / 4000))
      if (e.speed > 900) fx.sparks(e.x, e.y, C.white, 6)
    } else if (e.kind === 'goal') {
      const side = e.side
      const col = SIDE[side]
      const gy = side === 0 ? RINK.y0 : RINK.y1
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
        dir: side === 0 ? Math.PI / 2 : -Math.PI / 2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(W / 2, gy, col.light, 360)
      floatFor(fx, side, 'GOAL!')
      this.pulse[side].kick(14)
      const won = winner(w)
      if (won !== null) this.finish(won, { score: [w.score[0], w.score[1]], delay: 1.6 })
    } else if (e.kind === 'serve') {
      this.servedAt = this.time
      audio.play('pop')
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const ip = (a: Disc, b: Disc | undefined): Disc =>
      b ? { ...a, x: lerp(b.x, a.x, alpha), y: lerp(b.y, a.y, alpha) } : a
    const puck = ip(w.puck, prev?.puck)
    // Trail: only when the puck moves fast enough to deserve one.
    const sp = Math.hypot(w.puck.vx, w.puck.vy)
    if (sp > 500 && w.phase === 'play') this.trail.push({ x: puck.x, y: puck.y })
    else this.trail.shift()
    while (this.trail.length > 6) this.trail.shift()
    const dt = 1 / 60
    for (const s of this.squash) s.update(dt)
    for (const p of this.pulse) p.update(dt)
    render(g, w, {
      puck,
      mallets: w.mallets.map((m, i) => ip(m, prev?.mallets[i])),
      trail: this.trail,
      squash: this.squash.map((s) => s.value),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      serve: Math.min(1, (this.time - this.servedAt) / 0.35),
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
    if (this.squash.length !== this.s.w.mallets.length)
      this.squash = this.s.w.mallets.map(() => new Spring(1, 380, 12))
  }
}

export default () => new AirHockey()
