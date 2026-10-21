import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import {
  type ControlLook,
  firePressed,
  type SideControl,
  sideControls,
  snapControl,
} from '../../engines/arena/index.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { RobotBot } from './bot.ts'
import { renderRobots } from './render.ts'
import {
  ARENA_BOTTOM,
  type Drive,
  type Ev,
  newWorld,
  roundWinner,
  stepWorld,
  ZAP_CD,
  type World,
} from './rules.ts'

export interface State {
  w: World
  rounds: Rounds
  /** Control visuals, so an online guest can draw sticks and buttons. */
  ctl: ControlLook[]
}

/** Round wins needed to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 9 }

class Robots extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (RobotBot | null)[] = []
  private ev: Ev[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.controls = [
      ...sideControls(ctx.stage, 0, false, ARENA_BOTTOM),
      ...sideControls(ctx.stage, 1, false, ARENA_BOTTOM),
    ]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new RobotBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    const w = newWorld()
    return {
      w,
      rounds: roundsNew(this.target),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, 2.4)) {
      s.w = newWorld()
      ctx.audio.play('go')
      return
    }
    for (const c of this.controls) {
      c.stick.update(ctx.input.player(c.side))
      c.fire.update(ctx.input.player(c.side))
    }
    const playing = s.rounds.phase === 'play'
    const drives: (Drive | undefined)[] = s.w.robots.map((r) => {
      const c = this.controls.find((k) => k.side === r.side)
      const bot = this.bots[r.side]
      if (bot) {
        const d = bot.decide(s.w, r, dt)
        if (c) {
          c.stick.set(d.jx, d.jy)
          if (d.zap) c.fire.press(4)
        }
        return playing ? d : undefined
      }
      if (!c || !playing) return undefined
      return { jx: c.stick.x, jy: c.stick.y, zap: firePressed(c, ctx.input.player(c.side)) }
    })
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    this.smoke()
    s.ctl = this.controls.map((c) => {
      const r = s.w.robots.find((k) => k.side === c.side)
      return snapControl(c, r ? 1 - r.cd / ZAP_CD : 1)
    })
    if (!playing) return
    const w = roundWinner(s.w)
    if (w === null) return
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.6 })
    } else ctx.audio.play(w === 'draw' ? 'draw' : 'score')
  }

  protected override afterEnd(dt: number): void {
    this.ev.length = 0
    stepWorld(this.s.w, [], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    this.smoke()
  }

  /** Wrecks smoke, and a badly damaged robot trails sparks. */
  private smoke(): void {
    const { fx, rng } = this.ctx
    for (const r of this.s.w.robots) {
      if (!r.alive && !r.fell && rng.chance(0.08)) fx.puff(r.x, r.y - 10, 'rgba(60,56,70,0.55)', 1)
      if (r.alive && r.hp < 35 && rng.chance(0.05))
        fx.burst(r.x, r.y, C.orange, { count: 2, speed: 200, size: 5, life: 0.3, kind: 'spark' })
    }
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'zap':
        audio.play('zap', 0.9 + rng.next() * 0.2)
        fx.burst(e.x + Math.cos(e.a) * 50, e.y + Math.sin(e.a) * 50, C.yellow, {
          count: 12,
          speed: 420,
          size: 8,
          life: 0.22,
          gravity: 0,
          spread: 1.4,
          dir: e.a,
          kind: 'spark',
        })
        fx.shake(0.08)
        break
      case 'hit':
        // The saw's steady grind reports through 'saw'; only real blows get the full hit.
        if (e.dmg < 2) break
        audio.play('hit', 1 + (e.dmg / 40) * 0.2)
        audio.buzz(18)
        fx.sparks(e.x, e.y, C.yellow, 16)
        fx.burst(e.x, e.y, SIDE[e.side].light, {
          count: 8,
          speed: 300,
          size: 9,
          life: 0.35,
          gravity: 0,
          kind: 'square',
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 90)
        fx.float(`-${Math.round(e.dmg)}`, e.x, e.y - 60, C.yellow, 52, e.side)
        fx.shake(Math.min(0.45, 0.12 + e.dmg * 0.01))
        fx.stop(e.dmg >= 15 ? 4 : 2)
        break
      case 'ram':
        audio.play('slap', 0.9 + rng.next() * 0.2)
        audio.buzz(25)
        fx.burst(e.x, e.y, '#ffffff', {
          count: 14,
          speed: 360,
          size: 12,
          life: 0.35,
          gravity: 0,
          drag: 3,
        })
        fx.sparks(e.x, e.y, C.yellow, 14)
        fx.shake(0.35)
        fx.stop(3)
        break
      case 'saw':
        audio.play('chomp', 1.3)
        fx.sparks(e.x, e.y, C.orange, 6)
        break
      case 'wall':
        audio.play('wall', 0.9 + Math.min(0.6, e.v / 600))
        fx.sparks(e.x, e.y, '#ffffff', 5)
        fx.shake(0.12)
        break
      case 'fall':
        audio.play('whoosh', 0.7)
        audio.play('thud', 0.7)
        audio.buzz(60)
        fx.puff(e.x, e.y, 'rgba(40,36,56,0.7)', 12)
        fx.ring(e.x, e.y, C.orange, 150)
        fx.float('Down the pit!', e.x, e.y - 80, C.yellow, 52, e.side)
        fx.shake(0.5)
        fx.stop(7)
        break
      case 'ko':
        audio.play('explode')
        audio.buzz(80)
        fx.burst(e.x, e.y, C.orange, {
          count: 34,
          speed: 620,
          size: 18,
          life: 0.7,
          gravity: 0,
          colors: [C.orange, C.yellow, C.red, '#ffffff'],
        })
        fx.burst(e.x, e.y, '#55506a', { count: 14, speed: 240, size: 28, life: 1, gravity: -60 })
        fx.ring(e.x, e.y, C.yellow, 230)
        fx.float('K.O.!', e.x, e.y - 80, C.yellow, 72, e.side)
        fx.flash(C.orange, 0.35)
        fx.shake(0.75)
        fx.stop(9)
        break
    }
  }

  render(g: Draw): void {
    renderRobots(g, this.s, this.time, { names: this.ctx.names, over: this.over })
  }
}

export default () => new Robots()
