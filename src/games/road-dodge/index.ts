import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { DodgeBot } from './bot.ts'
import { renderRoad } from './render.ts'
import { CAR_Y, type Ev, newWorld, roundOver, stepWorld, type World } from './rules.ts'

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

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new DodgeBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return { ...newWorld(ctx.rng.int(1, 0x7fffffff)), rounds: roundsNew(this.target), bumps: [] }
  }

  protected step(dt: number): void {
    const { ctx } = this
    if (roundsStep(this.s.rounds, this.time, 2.4)) {
      // New round: fresh roads with new traffic (the same for both drivers).
      this.s = { ...newWorld(ctx.rng.int(1, 0x7fffffff)), rounds: this.s.rounds, bumps: [] }
      ctx.audio.play('go')
      return
    }
    const s = this.s
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
    stepWorld(s, dt, steer, this.ev)
    for (const e of this.ev) this.feedback(e)

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
    stepWorld(this.s, dt, [null, null], this.ev, false)
    this.smoke()
  }

  /** Wrecks smoke; knocked cars leave the road after a moment. */
  private smoke(): void {
    const { fx, rng } = this.ctx
    const s = this.s
    s.bumps = s.bumps.filter((b) => this.time - b.at < 1)
    for (const side of [0, 1] as Side[]) {
      const d = s.drivers[side]
      if (!d.out || !rng.chance(0.12)) continue
      const at = frame(side, d.x + rng.range(-20, 20), CAR_Y - 20)
      fx.puff(at.x, at.y, 'rgba(70,64,84,0.6)', 1)
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const at = frame(e.side, e.x, e.y)
    switch (e.k) {
      case 'near': {
        audio.play('swish', 1 + (rng.next() - 0.5) * 0.2)
        fx.sparks(at.x, at.y, C.white, 8)
        const up = frame(e.side, e.x, e.y - 200)
        fx.float('Close!', up.x, up.y, C.yellow, 50, e.side)
        break
      }
      case 'hit':
        this.s.bumps.push({
          side: e.side,
          x: e.ox,
          y: e.oy,
          dir: e.ox > e.x || (e.ox === e.x && rng.chance(0.5)) ? 1 : -1,
          id: e.id,
          at: this.time,
        })
        audio.play('hit', 0.95 + rng.next() * 0.1)
        audio.play('thud', 1.1)
        audio.buzz(30)
        fx.burst(at.x, at.y, C.orange, {
          count: 22,
          speed: 520,
          size: 14,
          life: 0.55,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, C.white],
        })
        fx.ring(at.x, at.y, SIDE[e.side].light, 150)
        fx.shake(0.4)
        fx.stop(4)
        {
          const up = frame(e.side, e.x, e.y - 210)
          fx.float('Crash!', up.x, up.y, C.orange, 58, e.side)
        }
        break
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

  render(g: Draw): void {
    renderRoad(g, this.s, this.ctx.names, this.time, this.over, g.t)
  }
}

export default () => new RoadDodge()
