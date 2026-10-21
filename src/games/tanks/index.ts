import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import {
  type ControlLook,
  firePressed,
  type Grid,
  parseMap,
  type SideControl,
  sideControls,
  snapControl,
} from '../../engines/arena/index.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { TankBot } from './bot.ts'
import { renderTanks } from './render.ts'
import {
  type Drive,
  type Ev,
  MAPS,
  newWorld,
  RELOAD,
  roundWinner,
  stepWorld,
  TARGET,
  type World,
} from './rules.ts'

export interface State {
  /** Index into MAPS; the grid itself is rebuilt from it (never snapshotted). */
  map: number
  w: World
  rounds: Rounds
  /** Control visuals, so the online guest can draw sticks and buttons. */
  ctl: ControlLook[]
}

/** Round wins needed to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: TARGET, min: 1, max: 9 }

class Tanks extends BaseGame<State> {
  private grid!: Grid
  private gridFor = -1
  private controls: SideControl[] = []
  private bots: (TankBot | null)[] = []
  private ev: Ev[] = []

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    const map = ctx.rng.int(0, MAPS.length - 1)
    const grid = this.gridOf(map)
    this.controls = [
      ...sideControls(ctx.stage, 0, ctx.teams),
      ...sideControls(ctx.stage, 1, ctx.teams),
    ]
    const w = newWorld(grid, ctx.teams)
    this.bots = w.tanks.map((t) =>
      ctx.bots[t.side] ? new TankBot(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      map,
      w,
      rounds: roundsNew(this.target),
      ctl: this.controls.map((c) => snapControl(c, 1)),
    }
  }

  private gridOf(map: number): Grid {
    if (map !== this.gridFor) {
      this.grid = parseMap(MAPS[map] as string[])
      this.gridFor = map
    }
    return this.grid
  }

  private controlFor(t: { side: Side; lane: 0 | 1 }): SideControl | undefined {
    return (
      this.controls.find((c) => c.side === t.side && c.lane === t.lane) ??
      this.controls.find((c) => c.side === t.side)
    )
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    const grid = this.gridOf(s.map)
    if (roundsStep(s.rounds, this.time, 2.4)) {
      s.map = (s.map + 1) % MAPS.length
      s.w = newWorld(this.gridOf(s.map), ctx.teams)
      ctx.audio.play('go')
      return
    }
    for (const c of this.controls) {
      c.stick.update(ctx.input.player(c.side))
      c.fire.update(ctx.input.player(c.side))
    }
    const playing = s.rounds.phase === 'play'
    const drives: (Drive | undefined)[] = s.w.tanks.map((t, i) => {
      const c = this.controlFor(t)
      const bot = this.bots[i]
      if (bot) {
        const d = bot.decide(s.w, grid, t, dt)
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
    stepWorld(s.w, grid, drives, dt, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.controls.map((c) => {
      const t = s.w.tanks.find((k) => k.side === c.side && (k.lane === c.lane || !ctx.teams))
      return snapControl(c, t ? 1 - t.cd / RELOAD : 1)
    })
    // Wrecks smoke.
    for (const t of s.w.tanks)
      if (!t.alive && ctx.rng.chance(0.06)) ctx.fx.puff(t.x, t.y - 10, 'rgba(60,56,70,0.55)', 1)
    if (!playing) return
    const w = roundWinner(s.w)
    if (w === null) return
    ctx.audio.play('score')
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2 })
    }
  }

  protected override afterEnd(dt: number): void {
    // Shells still in flight keep bouncing during the ending.
    this.ev.length = 0
    stepWorld(this.s.w, this.gridOf(this.s.map), [], dt, this.ev)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    switch (e.k) {
      case 'shot':
        audio.play('shoot', 0.95 + rng.next() * 0.1)
        fx.burst(e.x, e.y, C.yellow, {
          count: 6,
          speed: 300,
          size: 9,
          life: 0.2,
          gravity: 0,
          spread: 0.8,
          dir: e.a,
        })
        fx.puff(e.x, e.y, 'rgba(230,230,240,0.6)', 2)
        break
      case 'bounce':
        audio.play('wall', 1.2)
        fx.sparks(e.x, e.y, C.white, 5)
        break
      case 'fizz':
        fx.puff(e.x, e.y, 'rgba(200,200,215,0.6)', 3)
        break
      case 'clash':
        audio.play('zap')
        fx.sparks(e.x, e.y, C.yellow, 14)
        fx.ring(e.x, e.y, C.yellow, 90)
        break
      case 'hit':
        audio.play('hit')
        audio.buzz(30)
        fx.sparks(e.x, e.y, C.orange, 16)
        fx.ring(e.x, e.y, SIDE[e.side].light, 110)
        fx.shake(0.28)
        fx.stop(3)
        break
      case 'kill':
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
        fx.ring(e.x, e.y, C.yellow, 220)
        fx.flash(C.orange, 0.35)
        fx.shake(0.7)
        fx.stop(7)
        break
    }
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.gridOf(this.s.map)
  }

  render(g: Draw): void {
    renderTanks(g, this.s, this.gridOf(this.s.map), this.time, this.ctx.names, this.over)
  }
}

export default () => new Tanks()
