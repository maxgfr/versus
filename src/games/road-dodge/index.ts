import { frame } from '../../core/frame.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { BaseGame, STEP, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { botLateral, DodgeBot } from './bot.ts'
import { renderRoad } from './render.ts'
import {
  CAR_Y,
  type Ev,
  HUMAN_LATERAL,
  newWorld,
  roundOver,
  speedAt,
  stepWorld,
  tempoOf,
  type World,
} from './rules.ts'

/** Round wins needed to take the match (first to N, each round is a last-driver-standing race). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 9 }

/** An oncoming car knocked aside by a crash (a timed tween, so the online guest sees it). */
export interface Bump {
  side: Side
  /** Local position on its road when hit, and the way it is knocked. */
  x: number
  y: number
  dir: 1 | -1
  id: number
  at: number
}

export interface State extends World {
  rounds: Rounds
  bumps: Bump[]
}

class RoadDodge extends BaseGame<State> {
  private bots: (DodgeBot | null)[] = [null, null]
  private ev: Ev[] = []
  private lateral: [number, number] = [HUMAN_LATERAL, HUMAN_LATERAL]
  // Cosmetic only (not synced): previous x for interpolation, crash squash, swerve spray.
  private prevX: [number, number] = [500, 500]
  private squash: [Spring, Spring] = [new Spring(1, 380, 11), new Spring(1, 380, 11)]
  private hits: [number, number] = [-9, -9]
  private sprayAt: [number, number] = [-9, -9]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new DodgeBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    // A human's car follows the finger nearly at its speed; a bot's swerves at its skill.
    this.lateral = [0, 1].map((side) =>
      ctx.bots[side as Side] ? botLateral(ctx.difficulty) : HUMAN_LATERAL,
    ) as [number, number]
    const tempo = tempoOf(ctx.difficulty, ctx.bots)
    return {
      ...newWorld(ctx.rng.int(1, 0x7fffffff), tempo),
      rounds: roundsNew(this.target),
      bumps: [],
    }
  }

  protected step(dt: number): void {
    const { ctx } = this
    if (roundsStep(this.s.rounds, this.time, 2.4)) {
      // New round: fresh roads with new traffic (the same for both drivers).
      this.s = {
        ...newWorld(ctx.rng.int(1, 0x7fffffff), this.s.tempo),
        rounds: this.s.rounds,
        bumps: [],
      }
      ctx.audio.play('go')
      return
    }
    const s = this.s
    this.prevX = [s.drivers[0].x, s.drivers[1].x]
    this.smoke()
    if (s.rounds.phase !== 'play') return

    const steer: [number | null, number | null] = [null, null]
    for (const side of [0, 1] as Side[]) {
      const bot = this.bots[side]
      if (bot) {
        steer[side] = bot.decide(s, side, dt)
        continue
      }
      // Drag anywhere in your half: the car follows your finger across the road.
      const p = ctx.input.player(side).first()
      if (p) steer[side] = frame(side, p.x, p.y).x
    }

    this.ev.length = 0
    stepWorld(s, dt, steer, this.ev, true, this.lateral)
    for (const e of this.ev) this.feedback(e)
    // A hard swerve squeals: sparks off the tyres, scaled by the flick.
    for (const side of [0, 1] as Side[]) {
      const d = s.drivers[side]
      const vx = Math.abs(d.x - (this.prevX[side] ?? d.x)) / dt
      if (d.out || vx < 1400 || this.time - this.sprayAt[side] < 0.09) continue
      this.sprayAt[side] = this.time
      const k = Math.min(1, (vx - 1400) / 1200)
      const dir = d.x > (this.prevX[side] ?? d.x) ? -1 : 1
      const at = frame(side, d.x + dir * 50, CAR_Y + 60)
      ctx.fx.burst(at.x, at.y, C.yellow, {
        count: 2 + Math.round(k * 4),
        speed: 260 + k * 260,
        size: 6,
        life: 0.25,
        gravity: 0,
        kind: 'spark',
      })
      if (k > 0.4) ctx.audio.play('slide', 1.2 + k * 0.3)
    }

    const w = roundOver(s)
    if (w === null) return
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2 })
    }
  }

  /** Traffic keeps coming during the ending so the last crash still reads. */
  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    this.prevX = [this.s.drivers[0].x, this.s.drivers[1].x]
    stepWorld(this.s, dt, [null, null], this.ev, false, this.lateral)
    this.smoke()
  }

  /** Wrecks smoke; knocked cars leave the road after a moment. */
  private smoke(): void {
    const { fx } = this.ctx
    const s = this.s
    if (s.bumps.length) s.bumps = s.bumps.filter((b) => this.time - b.at < 1)
    for (const side of [0, 1] as Side[]) {
      const d = s.drivers[side]
      if (!d.out || Math.random() > 0.12) continue
      const at = frame(side, d.x + (Math.random() - 0.5) * 40, CAR_Y - 20)
      fx.puff(at.x, at.y, 'rgba(70,64,84,0.6)', 1)
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const at = frame(e.side, e.x, e.y)
    switch (e.k) {
      case 'near': {
        // The closer the shave, the louder it reads.
        const k = 1 - Math.min(1, e.gap / 44)
        audio.play('swish', 0.95 + k * 0.35)
        if (k > 0.6) audio.buzz(8)
        fx.sparks(at.x, at.y, k > 0.6 ? C.yellow : C.white, 5 + Math.round(k * 10))
        const up = frame(e.side, e.x, e.y - 200)
        fx.float(k > 0.75 ? 'Whew!' : 'Close!', up.x, up.y, C.yellow, 46 + k * 14, e.side)
        break
      }
      case 'hit': {
        // A faster road hits harder.
        const k = Math.min(1, (speedAt(this.s.rt, this.s.tempo) - 470) / 600)
        this.s.bumps.push({
          side: e.side,
          x: e.ox,
          y: e.oy,
          dir: e.ox > e.x || (e.ox === e.x && rng.chance(0.5)) ? 1 : -1,
          id: e.id,
          at: this.time,
        })
        audio.play('hit', 1.05 - k * 0.2 + Math.random() * 0.1)
        audio.play('thud', 1.1 - k * 0.2)
        audio.buzz(25 + Math.round(k * 25))
        fx.burst(at.x, at.y, C.orange, {
          count: 16 + Math.round(k * 14),
          speed: 440 + k * 260,
          size: 14,
          life: 0.55,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, C.white],
        })
        fx.ring(at.x, at.y, SIDE[e.side].light, 130 + k * 60)
        fx.shake(0.3 + k * 0.25)
        fx.stop(3 + Math.round(k * 3))
        const up = frame(e.side, e.x, e.y - 210)
        fx.float('Crash!', up.x, up.y, C.orange, 58, e.side)
        break
      }
      case 'out':
        audio.play('explode')
        audio.buzz(80)
        fx.burst(at.x, at.y, C.orange, {
          count: 34,
          speed: 640,
          size: 18,
          life: 0.7,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, '#ffffff'],
        })
        fx.burst(at.x, at.y, '#55506a', {
          count: 14,
          speed: 260,
          size: 30,
          life: 1.1,
          gravity: -80,
          drag: 2.5,
        })
        fx.burst(at.x, at.y, C.orange, {
          count: 8,
          speed: 300,
          size: 40,
          life: 0.8,
          gravity: -200,
          kind: 'emoji',
          glyph: '🔥',
        })
        fx.ring(at.x, at.y, C.yellow, 260)
        fx.flash(C.orange, 0.3)
        fx.shake(0.7)
        fx.stop(8)
        break
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    for (const side of [0, 1] as Side[]) {
      // A crash (seen through the synced crash time) jolts the car.
      const hit = s.drivers[side].hitT
      if (hit !== this.hits[side]) {
        if (hit > this.hits[side] && hit >= 0) this.squash[side].kick(-5)
        this.hits[side] = hit
      }
      this.squash[side].update(1 / 60)
    }
    renderRoad(g, s, this.ctx.names, this.time, this.over, g.t, {
      x: [lerp(this.prevX[0], s.drivers[0].x, alpha), lerp(this.prevX[1], s.drivers[1].x, alpha)],
      // Oncoming traffic moves at the road speed: draw it where it is between steps.
      back:
        s.rounds.phase === 'play' || this.over ? speedAt(s.rt, s.tempo) * (1 - alpha) * STEP : 0,
      squash: [this.squash[0].value, this.squash[1].value],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prevX = [this.s.drivers[0].x, this.s.drivers[1].x]
  }
}

export default () => new RoadDodge()
