import { DragAim } from '../../core/controls.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, SIDE } from '../../core/render/palette.ts'
import type { Rect } from '../../core/stage.ts'
import { MID, W } from '../../core/stage.ts'
import { type Disc } from '../../engines/puck/index.ts'
import { type BotMemory, decide, newMemory } from './bot.ts'
import { render } from './render.ts'
import {
  type Cmd,
  type Event,
  newWorld,
  nearestDisc,
  PLAYER_R,
  RINK,
  step,
  type World,
} from './rules.ts'

interface State {
  w: World
  /** The last goal: where it went in, whose net, and when (net ripple, banner). */
  goal: { x: number; side: Side; t: number } | null
  /** Game time the match was decided, -1 while it is on. */
  endAt: number
}

/** Match length in seconds of play (the clock stops for goals). */
export const match: MatchSpec = { unit: 'seconds', default: 90, min: 30, max: 300, step: 30 }

/** A press further than this from every disc picks nothing. */
const MAX_PICK = 260

class MiniSoccer extends BaseGame<State> {
  /** One drag widget per side per lane (two lanes in 2 vs 2, one otherwise). */
  private aims: DragAim[][] = []
  /** The disc each drag is aiming at, per side and lane (-1 = none). */
  private sel: [number[], number[]] = [
    [-1, -1],
    [-1, -1],
  ]
  private mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  // Cosmetic only (not synced): previous positions for interpolation, trail, springs.
  private prev: { ball: Disc; players: Disc[] } | null = null
  private trail: { x: number; y: number }[] = []
  private pop: Spring[] = [0, 1, 2, 3].map(() => new Spring(1, 380, 12))
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private lastTick = -1

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const teams = this.ctx.teams
    // A drag may start anywhere on the pitch (a disc can be deep in the rival half);
    // in 2 vs 2 each lane keeps its own half of the width.
    const zone = (lane: number): Rect => ({
      x: teams ? lane * (W / 2) : 0,
      y: RINK.y0 - 120,
      w: teams ? W / 2 : W,
      h: RINK.y1 - RINK.y0 + 240,
    })
    this.aims = ([0, 1] as Side[]).map((side) =>
      (teams ? [0, 1] : [0]).map((lane) => new DragAim(side, zone(lane), 300)),
    )
    // Local 2P: a press right on a disc belongs to that disc's team, wherever it is.
    this.ctx.input.assign = (x, y) => {
      const w = this.s?.w
      if (w) {
        const i = nearestDisc(w, x, y, [0, 1, 2, 3])
        const p = i === null ? undefined : w.players[i]
        if (i !== null && p && Math.hypot(p.x - x, p.y - y) < PLAYER_R * 1.5)
          return (i >> 1) as Side
      }
      return y >= MID ? 0 : 1
    }
    return { w: newWorld(this.target), goal: null, endAt: -1 }
  }

  private aimOf(side: Side, lane: number): DragAim | undefined {
    return this.aims[side]?.[lane]
  }

  /** The disc a drag starting at `o` is for: the lane's own disc in 2 vs 2, the nearest one otherwise. */
  private pick(side: Side, lane: number, o: { x: number; y: number }): number {
    if (this.ctx.teams) return side * 2 + lane
    const w = this.s.w
    const i = nearestDisc(w, o.x, o.y, [side * 2, side * 2 + 1])
    if (i === null) return -1
    const p = w.players[i]
    if (!p) return -1
    return Math.hypot(p.x - o.x, p.y - o.y) <= MAX_PICK ? i : -1
  }

  protected step(dt: number): void {
    const w = this.s.w
    this.prev = {
      ball: { ...w.ball },
      players: w.players.map((p) => ({ ...p })),
    }
    const cmd: Cmd = { flicks: [] }
    const previews: ({ dx: number; dy: number; power: number } | null)[] = [null, null, null, null]
    for (const side of [0, 1] as Side[]) {
      const lanes = this.ctx.teams ? [0, 1] : [0]
      if (this.isBot(side)) {
        const plan = decide(
          w,
          side,
          [side * 2, side * 2 + 1],
          this.ctx.difficulty,
          this.ctx.rng,
          this.mem[side],
          dt,
        )
        if (plan) {
          const lane = this.ctx.teams ? plan.index & 1 : 0
          this.sel[side][lane] = plan.index
          this.aimOf(side, lane)?.fire(plan.dx, plan.dy, plan.power)
        }
      }
      for (const lane of lanes) {
        const a = this.aimOf(side, lane)
        if (!a) continue
        a.update(this.ctx.input.player(side))
        // Capture the disc under the finger as the drag starts, before the release.
        if (a.origin && (this.sel[side][lane] ?? -1) < 0)
          this.sel[side][lane] = this.pick(side, lane, a.origin)
        const idx = this.sel[side][lane] ?? -1
        const ready = idx >= 0 && (w.cool[idx] ?? 0) <= 0
        if (a.shot) {
          if (ready)
            cmd.flicks.push({ index: idx, dx: a.shot.dx, dy: a.shot.dy, power: a.shot.power })
          this.sel[side][lane] = -1
        } else if (a.aim && ready) {
          previews[idx] = { dx: a.aim.dx, dy: a.aim.dy, power: a.aim.power }
        }
      }
    }
    w.aims = previews
    const events = step(w, dt, cmd)
    for (const e of events) this.juice(e)
    if (w.phase === 'end' && w.winner !== null && !this.over) {
      this.s.endAt = this.time
      this.ctx.audio.play('buzz', 0.7)
      this.ctx.fx.confetti(w.winner)
      this.finish(w.winner, { score: [w.score[0], w.score[1]], delay: 2.6 })
    }
    const sec = Math.ceil(w.left)
    if (w.phase === 'play' && !w.golden && sec <= 10 && sec !== this.lastTick) {
      this.lastTick = sec
      if (sec > 0) this.ctx.audio.play('tick', sec <= 3 ? 1.3 : 1)
    }
  }

  private juice(e: Event): void {
    const { fx, audio } = this.ctx
    if (e.kind === 'flick') {
      const side = (e.index >> 1) as Side
      audio.play('thud', 1.1 + e.power * 0.3)
      audio.play('whoosh', 0.9 + e.power * 0.4)
      fx.puff(e.x, e.y, 'rgba(255,255,255,0.55)', 6)
      fx.ring(e.x, e.y, alpha(SIDE[side].light, 0.6), 80)
      this.pop[e.index]?.kick(-2.5)
    } else if (e.kind === 'hit') {
      const k = Math.min(1, e.speed / 2600)
      audio.play('hit', 0.8 + k * 0.6)
      if (e.speed > 600) fx.sparks(e.x, e.y, C.yellow, Math.round(6 + k * 14))
      if (e.speed > 1400) fx.ring(e.x, e.y, C.white, 90 + k * 60)
      if (e.speed > 1500) fx.shake(0.1 + k * 0.18)
      if (e.speed > 2200) fx.stop(3)
      if (e.speed > 1200) audio.buzz(10)
      this.pop[e.index]?.kick(-2 - k * 3)
    } else if (e.kind === 'wall') {
      audio.play('wall', 0.9 + Math.min(0.4, e.speed / 4000))
      if (e.speed > 900) fx.sparks(e.x, e.y, C.white, 6)
    } else if (e.kind === 'goal') {
      const col = SIDE[e.side]
      const net = other(e.side)
      this.s.goal = { x: e.x, side: net, t: this.time }
      audio.play('score')
      audio.play('swish', 0.8)
      audio.buzz(30)
      fx.flash(col.main, 0.35)
      fx.shake(0.55)
      fx.stop(7)
      fx.confetti(e.side)
      fx.burst(e.x, e.y, col.main, {
        count: 40,
        speed: 1000,
        size: 15,
        life: 1,
        gravity: 0,
        drag: 2.2,
        spread: Math.PI,
        dir: e.y > MID ? -Math.PI / 2 : Math.PI / 2,
        colors: [col.main, col.light, C.yellow, C.white],
        kind: 'square',
      })
      fx.ring(e.x, e.y, col.light, 360)
      this.pulse[e.side].kick(14)
    } else if (e.kind === 'golden') {
      audio.play('powerup')
      audio.buzz(20)
      fx.flash(C.yellow, 0.25)
      fx.shake(0.2)
    }
  }

  render(g: Draw, alpha: number): void {
    const w = this.s.w
    const prev = this.prev
    const ip = (a: Disc, b: Disc | undefined): Disc =>
      b ? { ...a, x: lerp(b.x, a.x, alpha), y: lerp(b.y, a.y, alpha) } : a
    const ball = ip(w.ball, prev?.ball)
    if (Math.hypot(w.ball.vx, w.ball.vy) > 900 && w.phase === 'play')
      this.trail.push({ x: ball.x, y: ball.y })
    else this.trail.shift()
    while (this.trail.length > 6) this.trail.shift()
    const dt = 1 / 60
    for (const s of this.pop) s.update(dt)
    for (const p of this.pulse) p.update(dt)
    render(g, w, {
      ball,
      players: w.players.map((p, i) => ip(p, prev?.players[i])),
      trail: this.trail,
      // A kicked spring dips below 1: turn it into a short punch outward.
      pop: this.pop.map((s) => 1 + Math.max(-0.08, Math.min(0.16, (1 - s.value) * 0.7))),
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
      names: this.ctx.names,
      bots: this.ctx.bots,
      goal: this.s.goal ? { ...this.s.goal, e: this.time - this.s.goal.t } : null,
      ended: this.s.endAt >= 0 ? this.time - this.s.endAt : -1,
      winner: w.winner,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new MiniSoccer()
