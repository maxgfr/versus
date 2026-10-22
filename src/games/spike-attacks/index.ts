import { Joystick } from '../../core/controls.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { type Rounds, roundEnd, roundsNew, roundsStep } from '../../engines/reflex/index.ts'
import { MID, type Stage, W } from '../../core/stage.ts'
import { SpikeBot } from './bot.ts'
import { type StickLook, renderSpikes } from './render.ts'
import {
  type Drive,
  type Ev,
  type Floor,
  levelAt,
  newFloor,
  roundWinner,
  stepFloor,
} from './rules.ts'

export interface State {
  f: Floor
  rounds: Rounds
  /** Stick looks, so the online guest can draw them. */
  sticks: StickLook[]
}

/** Rounds to win. A round is last blob standing: one round by default. */
export const match: MatchSpec = { unit: 'wins', default: 1, min: 1, max: 5 }

/** Pause between rounds, seconds. */
const BETWEEN = 2.2

/** Knob travel (world units) in one step that reads as a flick: a dash. */
const FLICK = 42

/** Where each blob starts: red near the bottom, blue near the top. */
const SPAWN_X: [number, number] = [500, 500]
const SPAWN_Y: [number, number] = [1350, 450]

/** A stick under each player's thumb, in their strip (same layout as the arena's). */
function stickFor(stage: Stage, side: Side): Joystick {
  const left = stage.view.x
  const home = side === 0 ? { x: 250, y: 1608 } : { x: W - 250, y: 192 }
  const z = { x: left, y: 1510, w: 650 - left, h: 420 }
  const zone = side === 0 ? z : { x: W - (z.x + z.w), y: 1800 - (z.y + z.h), w: z.w, h: z.h }
  return new Joystick(side, zone, 100, home.x, home.y)
}

function lookOf(j: Joystick): StickLook {
  return {
    side: j.side,
    bx: j.baseX,
    by: j.baseY,
    kx: j.knobX,
    ky: j.knobY,
    r: j.radius,
    on: j.active,
  }
}

class SpikeAttacks extends BaseGame<State> {
  private sticks: Joystick[] = []
  private bots: (SpikeBot | null)[] = []
  private ev: Ev[] = []
  /** Each human stick's knob at the last step, to catch flicks. */
  private knob: [number, number][] = [
    [0, 0],
    [0, 0],
  ]
  // Cosmetic only (not synced): interpolation and squash.
  private prev: [number, number][] = [
    [500, 1350],
    [500, 450],
  ]
  private squash: [Spring, Spring] = [new Spring(1, 360, 11), new Spring(1, 360, 11)]
  private seenDash: [number, number] = [-9, -9]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.sticks = [stickFor(ctx.stage, 0), stickFor(ctx.stage, 1)]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new SpikeBot(ctx.difficulty) : null,
    )
    return {
      f: newFloor(SPAWN_X, SPAWN_Y),
      rounds: roundsNew(this.target),
      sticks: this.sticks.map(lookOf),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, BETWEEN)) {
      s.f = newFloor(SPAWN_X, SPAWN_Y)
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    this.prev = s.f.fighters.map((p) => [p.x, p.y])
    const drives: Drive[] = ([0, 1] as Side[]).map((side) => {
      const stick = this.sticks[side] as Joystick
      const bot = this.bots[side]
      if (bot) {
        const d = bot.decide(s.f, side, dt)
        stick.set(d.jx, d.jy)
        return d
      }
      stick.update(ctx.input.player(side))
      // A flick of the stick (the knob snapping across in one step) is a dash.
      const [kx, ky] = this.knob[side] as [number, number]
      const flick = stick.active && Math.hypot(stick.knobX - kx, stick.knobY - ky) > FLICK
      this.knob[side] = [stick.knobX, stick.knobY]
      return { jx: stick.x, jy: stick.y, dash: flick }
    })
    s.sticks = this.sticks.map(lookOf)
    if (!playing) {
      // Between rounds the blobs' death animation plays on; the floor is still.
      s.f.t += dt
      return
    }
    this.ev.length = 0
    const lv = levelAt(s.f.t)
    stepFloor(s.f, ctx.rng, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    if (levelAt(s.f.t) > lv) {
      // The floor speeds up: a cue for both players.
      ctx.audio.play('powerup', 0.9 + lv * 0.05)
      ctx.fx.float('Faster!', W / 2, MID + 130, C.yellow, 64, 0)
      ctx.fx.float('Faster!', W / 2, MID - 130, C.yellow, 64, 1)
      ctx.fx.shake(0.15)
    }
    const w = roundWinner(s.f)
    if (w === null) return
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.6 })
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'warn':
        audio.play('tick', 0.8 + Math.random() * 0.2)
        break
      case 'dash':
        audio.play('whoosh', 1.2)
        audio.buzz(8)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 8,
          speed: 300,
          size: 9,
          life: 0.35,
          gravity: 0,
          spread: 0.9,
          dir: Math.atan2(-e.dy, -e.dx),
        })
        fx.puff(e.x - e.dx * 30, e.y - e.dy * 30, 'rgba(255,255,255,0.4)', 3)
        break
      case 'fire':
        audio.play('pop', 0.6 + Math.min(0.5, e.n / 30))
        if (e.n >= 8) {
          audio.play('thud', 0.9)
          fx.shake(0.25)
        }
        break
      case 'bump': {
        // The harder the shove, the bigger the boing.
        const k = Math.min(1, e.speed / 900)
        audio.play('boing', 0.8 + k * 0.6)
        if (k > 0.4) audio.buzz(10 + Math.round(k * 20))
        fx.puff(e.x, e.y, 'rgba(255,255,255,0.45)', 3 + Math.round(k * 4))
        fx.ring(e.x, e.y, C.white, 60 + k * 70)
        if (k > 0.5) fx.sparks(e.x, e.y, C.yellow, Math.round(6 + k * 10))
        fx.shake(0.08 + k * 0.25)
        if (k > 0.6) fx.stop(2 + Math.round(k * 2))
        for (const sq of this.squash) sq.kick(-2 - k * 5)
        break
      }
      case 'hit':
        audio.play('hit', 1.05)
        audio.play('slap', 1.2)
        audio.buzz(35)
        fx.sparks(e.x, e.y, C.red, 16)
        fx.burst(e.x, e.y, SIDE[e.side].main, {
          count: 10,
          speed: 380,
          size: 10,
          life: 0.45,
          gravity: 600,
          colors: [SIDE[e.side].main, SIDE[e.side].light],
        })
        fx.flash(C.red, 0.15)
        fx.shake(0.4)
        fx.stop(5)
        fx.float('-1', e.x, e.y - 80, SIDE[e.side].light, 60, e.side)
        break
      case 'dead':
        audio.play('explode', 0.9)
        audio.buzz(80)
        fx.burst(e.x, e.y, SIDE[e.side].main, {
          count: 34,
          speed: 600,
          size: 16,
          life: 0.7,
          gravity: 300,
          colors: [SIDE[e.side].main, SIDE[e.side].light, C.yellow, C.white],
        })
        fx.ring(e.x, e.y, C.yellow, 220)
        fx.flash(SIDE[e.side === 0 ? 1 : 0].light, 0.35)
        fx.shake(0.8)
        fx.stop(12)
        break
    }
  }

  render(g: Draw, alpha: number): void {
    const f = this.s.f
    for (const side of [0, 1] as Side[]) {
      // A dash (seen through the synced dash time) stretches the blob.
      const dt = f.fighters[side].dashT
      if (dt !== this.seenDash[side]) {
        if (dt > this.seenDash[side] && dt >= 0) this.squash[side].kick(4)
        this.seenDash[side] = dt
      }
      this.squash[side].update(1 / 60)
    }
    const at = f.fighters.map((p, i): [number, number] => {
      const q = this.prev[i] ?? [p.x, p.y]
      // A jump (new round) is not tweened.
      if (Math.abs(q[0] - p.x) + Math.abs(q[1] - p.y) > 200) return [p.x, p.y]
      return [lerp(q[0], p.x, alpha), lerp(q[1], p.y, alpha)]
    })
    renderSpikes(g, this.s, this.time, this.ctx.names, this.over, {
      at,
      squash: [this.squash[0].value, this.squash[1].value],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = this.s.f.fighters.map((p) => [p.x, p.y])
  }
}

export default () => new SpikeAttacks()
