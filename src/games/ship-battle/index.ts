import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { Spring } from '../../core/fx/ease.ts'
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
import { type Look, renderShips } from './render.ts'
import {
  type Drive,
  type Ev,
  HP,
  LAYOUTS,
  MAX_SPEED,
  newWorld,
  RELOAD,
  roundWinner,
  SEA,
  settle,
  stepWorld,
  WAKE_T,
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
  // Cosmetic only (never synced): last step's poses for interpolation, a heel
  // spring per ship (rolls away from a broadside, shudders on hits), the wake
  // trails sampled from rendered frames, and the frame clock.
  private prev: { x: number; y: number; a: number }[] = []
  private ballPrev = new Map<number, { x: number; y: number }>()
  private heel: Spring[] = [new Spring(0, 140, 5), new Spring(0, 140, 5)]
  private wakes: { x: number; y: number; t: number }[][] = [[], []]
  private lastT = -1
  private look: Look = {
    alpha: 1,
    prev: this.prev,
    ballPrev: this.ballPrev,
    heel: [0, 0],
    wakes: this.wakes,
  }

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
    this.remember()
    if (roundsStep(s.rounds, this.time, 2.4)) {
      // A fresh layout, never the same one twice in a row.
      s.layout = (s.layout + 1 + ctx.rng.int(0, LAYOUTS - 2)) % LAYOUTS
      s.w = newWorld(s.layout)
      this.prev.length = 0
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
    // Damaged hulls smoke, sinking ones bubble (cosmetic: Math.random, so the
    // seeded rng that picks the layouts is never disturbed).
    for (const sh of s.w.ships) {
      if (sh.alive && sh.hp < HP && Math.random() < 0.04 * (HP - sh.hp)) {
        ctx.fx.puff(sh.x, sh.y - 6, 'rgba(60,60,72,0.5)', 1)
      }
      if (!sh.alive && s.w.t - sh.sunkT < 2.4 && Math.random() < 0.2) {
        const jx = (Math.random() - 0.5) * 52
        const jy = (Math.random() - 0.5) * 52
        ctx.fx.burst(sh.x + jx, sh.y + jy, '#e8f6ff', {
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
    this.ev.length = 0
    settle(s.w, this.ev)
    for (const e of this.ev) this.feedback(e)
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      ctx.fx.confetti(w)
      ctx.fx.flash(SIDE[w].main, 0.3)
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.8 })
    } else {
      ctx.audio.play(w === 'draw' ? 'draw' : 'score')
      if (w !== 'draw') floatFor(ctx.fx, w, 'Round!')
    }
  }

  /** Last step's poses, for interpolation (cosmetic, outside the state). */
  private remember(): void {
    const w = this.s.w
    w.ships.forEach((sh, i) => {
      const p = this.prev[i]
      if (p) {
        p.x = sh.x
        p.y = sh.y
        p.a = sh.a
      } else this.prev[i] = { x: sh.x, y: sh.y, a: sh.a }
    })
    this.ballPrev.clear()
    for (const b of w.balls) this.ballPrev.set(b.id, { x: b.x, y: b.y })
  }

  protected override afterEnd(dt: number): void {
    // The sinking plays out and the winner coasts before the result screen.
    this.remember()
    this.ev.length = 0
    stepWorld(this.s.w, [], dt, this.ev)
    for (const e of this.ev) this.feedback(e)
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'fire': {
        // The ship heels away from its own broadside.
        const sh = this.s.w.ships.find((k) => k.side === e.side)
        if (sh) this.heel[sh.id]?.kick(-sh.fireSide * 1.6)
        audio.play('shoot', 0.95 + Math.random() * 0.1)
        fx.burst(e.x, e.y, '#ffffff', {
          count: 8,
          speed: 260,
          size: 8,
          life: 0.3,
          gravity: 0,
          spread: 0.7,
          dir: e.a,
        })
        fx.burst(e.x, e.y, C.yellow, {
          count: 5,
          speed: 380,
          size: 7,
          life: 0.16,
          gravity: 0,
          spread: 0.5,
          dir: e.a,
          kind: 'spark',
        })
        fx.puff(e.x, e.y, 'rgba(240,244,255,0.75)', 4)
        fx.shake(0.06)
        break
      }
      case 'splash':
        audio.play('splash', 0.95 + Math.random() * 0.2)
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
      case 'bump': {
        // Hulls knocking together: louder, longer and shakier the harder they meet.
        const k = Math.min(1, (e.speed - 60) / (MAX_SPEED * 1.4))
        audio.play('thud', 0.8 + k * 0.4)
        fx.burst(e.x, e.y, C.wood, {
          count: Math.round(4 + k * 8),
          speed: 220 + k * 200,
          size: 9,
          life: 0.5,
          gravity: 0,
          drag: 2,
          kind: 'square',
          colors: [C.wood, C.woodDark, '#ffffff'],
        })
        fx.shake(0.1 + k * 0.25)
        if (k > 0.5) {
          fx.stop(2)
          audio.buzz(20)
        }
        for (const sp of this.heel) sp.kick((Math.random() - 0.5) * (1 + k * 2))
        break
      }
      case 'hit': {
        // A point-blank broadside lands harder than one at the end of its reach.
        const k = e.close
        const dir = Math.atan2(e.vy, e.vx)
        const sh = this.s.w.ships.find((x) => x.side === e.side)
        if (sh) this.heel[sh.id]?.kick((Math.random() < 0.5 ? -1 : 1) * (1.5 + k * 1.5))
        audio.play('hit', 0.85 + k * 0.35)
        audio.buzz(20 + Math.round(k * 25))
        fx.burst(e.x, e.y, '#ffffff', {
          count: 16,
          speed: 320,
          size: 14,
          life: 0.45,
          gravity: 0,
          drag: 2.5,
        })
        fx.sparks(e.x, e.y, C.orange, Math.round(10 + k * 10))
        // Splinters fly on along the ball's path.
        fx.burst(e.x, e.y, C.wood, {
          count: Math.round(6 + k * 8),
          speed: 300 + k * 260,
          size: 10,
          life: 0.6,
          gravity: 0,
          drag: 2,
          spread: 1.6,
          dir,
          kind: 'square',
          colors: [C.wood, C.woodDark],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 100 + k * 50)
        if (e.left > 0) fx.float(`${e.left} left`, e.x, e.y - 70, C.yellow, 56, e.side)
        fx.shake(0.25 + k * 0.2)
        fx.stop(3 + Math.round(k * 2))
        break
      }
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
        fx.burst(e.x, e.y, C.wood, {
          count: 12,
          speed: 520,
          size: 13,
          life: 0.9,
          gravity: 0,
          drag: 2.2,
          spread: 1.5,
          dir: Math.atan2(e.vy, e.vx),
          kind: 'square',
          colors: [C.wood, C.woodDark, SIDE[e.side].main],
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

  override restore(snap: unknown): void {
    super.restore(snap)
    // The guest has no previous step to blend from.
    this.prev.length = 0
    this.ballPrev.clear()
  }

  /** Wake points sampled from what is drawn, so the trail needs nothing in the state. */
  private trackWakes(): void {
    const w = this.s.w
    for (const sh of w.ships) {
      const list = this.wakes[sh.id]
      if (!list) continue
      const last = list[list.length - 1]
      // A new round restarts the world clock: drop the old trail.
      if (last && last.t > w.t) list.length = 0
      while (list.length && w.t - (list[0]?.t ?? 0) > WAKE_T) list.shift()
      if (!sh.alive || sh.v <= 12) continue
      const tail = list[list.length - 1]
      if (tail && w.t - tail.t < 1 / 30) continue
      list.push({ x: sh.x - Math.cos(sh.a) * 34, y: sh.y - Math.sin(sh.a) * 34, t: w.t })
    }
  }

  render(g: Draw, alpha: number): void {
    const { ctx } = this
    const fdt = this.lastT < 0 ? 0 : Math.min(0.05, Math.max(0, g.t - this.lastT))
    this.lastT = g.t
    for (const h of this.heel) h.update(fdt)
    this.trackWakes()
    const look = this.look
    look.alpha = alpha
    look.heel[0] = this.heel[0]?.value ?? 0
    look.heel[1] = this.heel[1]?.value ?? 0
    // The broadside guide shows for the humans at this device (none in a bot-only demo).
    const guides = ([0, 1] as Side[]).map(
      (side) => !ctx.bots[side] && (ctx.mode !== 'online' || ctx.local === side),
    )
    renderShips(g, this.s, this.time, { names: ctx.names, over: this.over, guides }, look)
  }
}

export default () => new Ships()
