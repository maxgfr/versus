import { Joystick } from '../../core/controls.ts'
import { frame } from '../../core/frame.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { BaseGame, STEP, type MatchSpec, type Side } from '../../core/game.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { roundEnd, type Rounds, roundsNew, roundsStep } from '../../engines/reflex/index.ts'
import { StampedeBot } from './bot.ts'
import { renderStampede } from './render.ts'
import {
  type Drive,
  type Ev,
  herdSpeed,
  newWorld,
  roundOver,
  stepWorld,
  type World,
} from './rules.ts'

/** Knob travel (world units) in one step that reads as a flick: a sprint. */
const FLICK = 46

/** Round wins needed to take the match (first to N; each round is last blob standing). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 9 }

/** A joystick's look, copied into the state so the online guest can draw it. */
export interface PadLook {
  bx: number
  by: number
  kx: number
  ky: number
  on: boolean
}

export interface State extends World {
  rounds: Rounds
  pads: [PadLook, PadLook]
}

class Stampede extends BaseGame<State> {
  private pads!: [Joystick, Joystick]
  private bots: (StampedeBot | null)[] = [null, null]
  private ev: Ev[] = []
  private knob: [number, number][] = [
    [0, 0],
    [0, 0],
  ]
  // Cosmetic only (not synced): interpolation and squash.
  private prev: [number, number][] = [
    [500, 1400],
    [500, 400],
  ]
  private squash: [Spring, Spring] = [new Spring(1, 360, 11), new Spring(1, 360, 11)]
  private seenDash: [number, number] = [-9, -9]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    // Each half steers its own blob; the zone covers the half, the stick floats under the thumb.
    this.pads = ([0, 1] as Side[]).map((side) => {
      const home = frame(side, 250, 1540)
      const zone = side === 0 ? { x: 0, y: 900, w: 1000, h: 900 } : { x: 0, y: 0, w: 1000, h: 900 }
      return new Joystick(side, zone, 110, home.x, home.y)
    }) as [Joystick, Joystick]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new StampedeBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return { ...newWorld(), rounds: roundsNew(this.target), pads: this.looks() }
  }

  private looks(): [PadLook, PadLook] {
    return this.pads.map((p) => ({
      bx: p.baseX,
      by: p.baseY,
      kx: p.knobX,
      ky: p.knobY,
      on: p.active,
    })) as [PadLook, PadLook]
  }

  protected step(dt: number): void {
    const { ctx } = this
    if (roundsStep(this.s.rounds, this.time, 2.4)) {
      // A new round: the herds start over and both blobs go back to their spots.
      this.s = { ...newWorld(), rounds: this.s.rounds, pads: this.s.pads }
      ctx.audio.play('go')
      return
    }
    const s = this.s
    this.prev = s.drivers.map((d) => [d.x, d.y])
    if (s.rounds.phase !== 'play') return

    const drives: [Drive, Drive] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]
    for (const side of [0, 1] as Side[]) {
      const pad = this.pads[side]
      const bot = this.bots[side]
      if (bot) {
        const v = bot.drive(s, side, dt)
        pad.set(v.x, v.y)
        drives[side] = { x: pad.x, y: pad.y, dash: v.dash }
      } else {
        pad.update(ctx.input.player(side))
        // A flick of the stick (the knob snapping across in one step) is a sprint.
        const [kx, ky] = this.knob[side] as [number, number]
        const flick = pad.active && Math.hypot(pad.knobX - kx, pad.knobY - ky) > FLICK
        this.knob[side] = [pad.knobX, pad.knobY]
        drives[side] = { x: pad.x, y: pad.y, dash: flick }
      }
    }

    this.ev.length = 0
    stepWorld(s, dt, drives, ctx.rng, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.pads = this.looks()

    const w = roundOver(s)
    if (w === null) return
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2 })
    }
  }

  /** Herds keep stampeding through the ending. */
  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    this.prev = this.s.drivers.map((d) => [d.x, d.y])
    stepWorld(this.s, dt, [null, null], this.ctx.rng, this.ev, false)
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    // Later herds run faster: their thunder and hits land harder.
    const k = Math.min(1, (herdSpeed(this.s.rt) - 340) / 260)
    switch (e.k) {
      case 'warn':
        audio.play('count', 0.7 + k * 0.2)
        break
      case 'enter':
        audio.play('thud', 0.75 + Math.random() * 0.15)
        fx.shake(0.1 + k * 0.12)
        if (k > 0.5) audio.buzz(10)
        break
      case 'dash':
        audio.play('whoosh', 1.2)
        audio.buzz(8)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 8,
          speed: 320,
          size: 9,
          life: 0.35,
          gravity: 0,
          spread: 0.9,
          dir: Math.atan2(-e.dy, -e.dx),
        })
        fx.puff(e.x - e.dx * 30, e.y - e.dy * 30, 'rgba(201,168,120,0.6)', 4)
        break
      // Dust is drawn by the renderer as a trail behind each animal (fx puffs piled up on top of the herd).
      case 'bump': {
        // A sprint into the rival is a real shove.
        const s = Math.min(1, e.speed / 1600)
        audio.play('boing', 1.05 + Math.random() * 0.15 - s * 0.3)
        fx.ring(e.x, e.y, C.white, 70 + s * 80)
        fx.sparks(e.x, e.y, s > 0 ? C.yellow : C.white, 6 + Math.round(s * 12))
        if (s > 0) {
          audio.play('slap', 1)
          audio.buzz(25)
          fx.shake(0.25 + s * 0.2)
          fx.stop(3)
          for (const sq of this.squash) sq.kick(-6)
        }
        break
      }
      case 'hit': {
        audio.play('hit', 1 - k * 0.15 + Math.random() * 0.1)
        audio.play('thud', 1.05)
        audio.buzz(25 + Math.round(k * 25))
        fx.burst(e.x, e.y, C.orange, {
          count: 16 + Math.round(k * 14),
          speed: 440 + k * 220,
          size: 14,
          life: 0.55,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, C.white],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 130 + k * 60)
        fx.shake(0.3 + k * 0.2)
        fx.stop(3 + Math.round(k * 3))
        fx.burst(e.x, e.y, C.white, {
          count: 4,
          speed: 300,
          size: 40,
          life: 0.7,
          gravity: 300,
          kind: 'emoji',
          glyph: '💫',
        })
        fx.float('Ouch!', e.x, e.y + (e.side === 0 ? -80 : 80), C.orange, 60, e.side)
        break
      }
      case 'out':
        audio.play('explode')
        audio.buzz(80)
        fx.burst(e.x, e.y, C.orange, {
          count: 34,
          speed: 640,
          size: 18,
          life: 0.7,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, '#ffffff'],
        })
        fx.burst(e.x, e.y, '#55506a', {
          count: 14,
          speed: 260,
          size: 30,
          life: 1.1,
          gravity: -80,
          drag: 2.5,
        })
        fx.flash(C.orange, 0.3)
        fx.shake(0.7)
        fx.stop(7)
        fx.burst(e.x, e.y, C.white, {
          count: 8,
          speed: 420,
          size: 44,
          life: 0.9,
          gravity: 400,
          kind: 'emoji',
          glyph: '🐾',
        })
        floatFor(fx, e.side, 'Trampled!', e.x, e.y + (e.side === 0 ? -110 : 110))
        break
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      // A sprint (seen through the synced sprint time) stretches the blob.
      const dt = s.drivers[side].dashT
      if (dt !== this.seenDash[side]) {
        if (dt > this.seenDash[side] && dt >= 0) this.squash[side].kick(5)
        this.seenDash[side] = dt
      }
      this.squash[side].update(1 / 60)
    }
    const at = s.drivers.map((d, i): [number, number] => {
      const q = this.prev[i] ?? [d.x, d.y]
      if (Math.abs(q[0] - d.x) + Math.abs(q[1] - d.y) > 200) return [d.x, d.y]
      return [lerp(q[0], d.x, alpha), lerp(q[1], d.y, alpha)]
    })
    // Herds run on the round clock: draw them where they are between steps.
    const moving = s.rounds.phase === 'play' || this.over
    renderStampede(g, s, this.ctx.names, this.time, this.over, g.t, {
      at,
      squash: [this.squash[0].value, this.squash[1].value],
      rt: moving ? s.rt - (1 - alpha) * STEP : s.rt,
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = this.s.drivers.map((d) => [d.x, d.y])
  }
}

export default () => new Stampede()
