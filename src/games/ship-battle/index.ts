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
import { ShipBot } from './bot.ts'
import { renderShips } from './render.ts'
import {
  type Drive,
  type Ev,
  HP,
  LAYOUTS,
  newWorld,
  RELOAD,
  roundWinner,
  SEA,
  stepWorld,
  type World,
} from './rules.ts'

export interface State {
  /** Index into the layouts; the islands are rebuilt from it. */
  layout: number
  w: World
  rounds: Rounds
  /** Control visuals, so an online guest can draw sticks and buttons. */
  ctl: ControlLook[]
}

/** Round wins needed to take the match (first to three sinkings by default). */
export const match: MatchSpec = { unit: 'wins', default: 3, min: 1, max: 7 }

class Ships extends BaseGame<State> {
  private controls: SideControl[] = []
  private bots: (ShipBot | null)[] = []
  private ev: Ev[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    const layout = ctx.rng.int(0, LAYOUTS - 1)
    this.controls = [
      ...sideControls(ctx.stage, 0, false, SEA.bottom),
      ...sideControls(ctx.stage, 1, false, SEA.bottom),
    ]
    this.bots = ([0, 1] as Side[]).map((side) =>
      ctx.bots[side] ? new ShipBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    const w = newWorld(layout)
    return {
      layout,
      w,
      rounds: roundsNew(this.target),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    if (roundsStep(s.rounds, this.time, 2.4)) {
      s.layout = ctx.rng.int(0, LAYOUTS - 1)
      s.w = newWorld(s.layout)
      ctx.audio.play('go')
      return
    }
    for (const c of this.controls) {
      c.stick.update(ctx.input.player(c.side))
      c.fire.update(ctx.input.player(c.side))
    }
    const playing = s.rounds.phase === 'play'
    const drives: (Drive | undefined)[] = s.w.ships.map((sh) => {
      const c = this.controls.find((k) => k.side === sh.side)
      const bot = this.bots[sh.side]
      if (bot) {
        const d = bot.decide(s.w, sh, dt)
        if (c) {
          c.stick.set(d.jx, d.jy)
          if (d.fire) c.fire.press(4)
        }
        return playing ? d : undefined
      }
      if (!c || !playing) return undefined
      return { jx: c.stick.x, jy: c.stick.y, fire: firePressed(c, ctx.input.player(c.side)) }
    })
    this.ev.length = 0
    stepWorld(s.w, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.controls.map((c) => {
      const sh = s.w.ships.find((k) => k.side === c.side)
      return snapControl(c, sh ? 1 - sh.cd / RELOAD : 1)
    })
    // Damaged hulls smoke, sinking ones bubble.
    for (const sh of s.w.ships) {
      if (sh.alive && sh.hp < HP && ctx.rng.chance(0.08)) {
        ctx.fx.puff(sh.x, sh.y - 6, 'rgba(60,60,72,0.5)', 1)
      }
      if (!sh.alive && this.time - sh.sunkT < 2.4 && ctx.rng.chance(0.2)) {
        ctx.fx.burst(sh.x + ctx.rng.range(-26, 26), sh.y + ctx.rng.range(-26, 26), '#e8f6ff', {
          count: 1,
          speed: 40,
          size: 9,
          life: 0.9,
          gravity: -60,
          drag: 1,
        })
      }
    }
    if (!playing) return
    const w = roundWinner(s.w)
    if (w === null) return
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.8 })
    } else ctx.audio.play(w === 'draw' ? 'draw' : 'score')
  }

  protected override afterEnd(dt: number): void {
    // The sinking and the last shells play out before the result screen.
    this.ev.length = 0
    stepWorld(this.s.w, [], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'fire':
        audio.play('shoot', 0.95 + rng.next() * 0.1)
        fx.burst(e.x, e.y, '#ffffff', {
          count: 8,
          speed: 260,
          size: 8,
          life: 0.3,
          gravity: 0,
          spread: 0.7,
          dir: e.a,
        })
        fx.puff(e.x, e.y, 'rgba(240,244,255,0.75)', 4)
        fx.shake(0.06)
        break
      case 'splash':
        audio.play('splash', 0.95 + rng.next() * 0.2)
        fx.burst(e.x, e.y, '#e6f7ff', {
          count: 10,
          speed: 170,
          size: 12,
          life: 0.5,
          gravity: 0,
          drag: 3,
        })
        fx.ring(e.x, e.y, '#ffffff', 46)
        break
      case 'rock':
        audio.play('thud', 1.15)
        fx.sparks(e.x, e.y, '#f7e2a8', 8)
        fx.puff(e.x, e.y, 'rgba(255,240,200,0.6)', 3)
        break
      case 'hit':
        audio.play('hit')
        audio.buzz(30)
        fx.burst(e.x, e.y, '#ffffff', {
          count: 16,
          speed: 320,
          size: 14,
          life: 0.45,
          gravity: 0,
          drag: 2.5,
        })
        fx.sparks(e.x, e.y, C.orange, 14)
        fx.burst(e.x, e.y, C.wood, {
          count: 8,
          speed: 300,
          size: 10,
          life: 0.6,
          gravity: 0,
          drag: 2,
          kind: 'square',
          colors: [C.wood, C.woodDark],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 120)
        if (e.left > 0) fx.float(`${e.left} left`, e.x, e.y - 70, C.yellow, 56, e.side)
        fx.shake(0.35)
        fx.stop(4)
        break
      case 'sink':
        audio.play('explode')
        audio.buzz(80)
        fx.burst(e.x, e.y, '#ffffff', {
          count: 30,
          speed: 420,
          size: 16,
          life: 0.9,
          gravity: 0,
          colors: ['#ffffff', C.yellow, C.orange, '#9fd8ff'],
        })
        fx.puff(e.x, e.y, 'rgba(70,64,80,0.7)', 10)
        fx.ring(e.x, e.y, C.yellow, 220)
        fx.ring(e.x, e.y, '#ffffff', 320)
        fx.float('Sunk!', e.x, e.y - 80, C.yellow, 72, e.side)
        audio.play('splash', 0.6)
        fx.flash(C.orange, 0.35)
        fx.shake(0.75)
        fx.stop(9)
        break
    }
  }

  render(g: Draw): void {
    const { ctx } = this
    // The broadside guide shows for the humans at this device (none in a bot-only demo).
    const guides = ([0, 1] as Side[]).map(
      (side) => !ctx.bots[side] && (ctx.mode !== 'online' || ctx.local === side),
    )
    renderShips(g, this.s, this.time, { names: ctx.names, over: this.over, guides })
  }
}

export default () => new Ships()
