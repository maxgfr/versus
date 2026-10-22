import { BaseGame, type MatchSpec, other, type Side } from '../../core/game.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { Spring } from '../../core/fx/ease.ts'
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
import { type Look, renderTanks } from './render.ts'
import {
  type Drive,
  type Ev,
  MAPS,
  newWorld,
  RELOAD,
  roundWinner,
  SHELL_SPEED,
  SPEED,
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
  // Cosmetic only (never synced): last step's positions for interpolation,
  // per-tank squash springs and the frame clock.
  private prev = new Map<number, { x: number; y: number; a: number }>()
  private squash: Spring[] = []
  private lastT = -1
  private look: Look = { alpha: 1, prev: this.prev, squash: [] }

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
    this.remember()
    if (roundsStep(s.rounds, this.time, 2.4)) {
      s.map = (s.map + 1) % MAPS.length
      s.w = newWorld(this.gridOf(s.map), ctx.teams)
      this.prev.clear()
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
    // Wrecks smoke, a tank on its last life trails smoke, a fast one kicks up dust.
    // Cosmetic: Math.random keeps the seeded play rng untouched.
    for (const t of s.w.tanks) {
      if (!t.alive) {
        if (Math.random() < 0.06) ctx.fx.puff(t.x, t.y - 10, 'rgba(60,56,70,0.55)', 1)
        continue
      }
      if (t.hp === 1 && Math.random() < 0.05) ctx.fx.puff(t.x, t.y - 16, 'rgba(70,66,80,0.5)', 1)
      const sp = Math.hypot(t.vx, t.vy)
      if (sp > SPEED * 0.7 && Math.random() < 0.08)
        ctx.fx.puff(t.x - Math.cos(t.a) * 40, t.y - Math.sin(t.a) * 40, 'rgba(200,190,170,0.35)', 1)
    }
    if (!playing) return
    const w = roundWinner(s.w)
    if (w === null) return
    // The round is decided: shells still flying fizzle so a stray one can't
    // wreck the survivor under the banner (or during the match's ending).
    for (const sh of s.w.shells) ctx.fx.puff(sh.x, sh.y, 'rgba(200,200,215,0.6)', 3)
    s.w.shells.length = 0
    if (roundEnd(s.rounds, w, this.time, ctx.names) && w !== 'draw') {
      this.finish(w, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2 })
      ctx.fx.confetti(w)
      ctx.fx.flash(SIDE[w].main, 0.3)
    } else if (w !== 'draw') {
      ctx.audio.play('score')
      floatFor(ctx.fx, w, 'Round!')
    } else ctx.audio.play('thud')
  }

  /** Last step's poses, for interpolation (cosmetic, outside the state). */
  private remember(): void {
    const w = this.s.w
    for (const t of w.tanks) this.keep(t.id, t.x, t.y, t.a)
    // Shells get ids far above the tanks' (ids start at 1, tanks at 0..3).
    for (const sh of w.shells) this.keep(1000 + sh.id, sh.x, sh.y, 0)
    if (this.prev.size > 64) this.prev.clear()
  }

  private keep(id: number, x: number, y: number, a: number): void {
    const p = this.prev.get(id)
    if (p) {
      p.x = x
      p.y = y
      p.a = a
    } else this.prev.set(id, { x, y, a })
  }

  private spring(id: number): Spring {
    let sp = this.squash[id]
    if (!sp) sp = this.squash[id] = new Spring(1, 360, 11)
    return sp
  }

  protected override afterEnd(dt: number): void {
    // The tanks roll to a stop during the ending.
    this.remember()
    this.ev.length = 0
    stepWorld(this.s.w, this.gridOf(this.s.map), [], dt, this.ev)
  }

  private feedback(e: Ev): void {
    const { fx, audio } = this.ctx
    switch (e.k) {
      case 'shot': {
        this.spring(e.id).kick(-2.4)
        audio.play('shoot', 0.95 + Math.random() * 0.1)
        fx.burst(e.x, e.y, C.yellow, {
          count: 7,
          speed: 340,
          size: 10,
          life: 0.2,
          gravity: 0,
          spread: 0.8,
          dir: e.a,
          colors: [C.yellow, C.orange, C.white],
        })
        fx.puff(e.x, e.y, 'rgba(230,230,240,0.6)', 2)
        break
      }
      case 'bounce': {
        const k = Math.min(1, e.sp / (SHELL_SPEED * 1.2))
        audio.play('wall', 1.05 + k * 0.3)
        fx.sparks(e.x, e.y, C.white, Math.round(3 + k * 5))
        break
      }
      case 'fizz':
        fx.puff(e.x, e.y, 'rgba(200,200,215,0.6)', 3)
        break
      case 'clash':
        audio.play('zap')
        fx.sparks(e.x, e.y, C.yellow, 14)
        fx.ring(e.x, e.y, C.yellow, 90)
        fx.stop(2)
        break
      case 'hit': {
        // Faster shells and trick shots land harder.
        const sp = Math.hypot(e.vx, e.vy)
        const k = Math.min(1, (sp - SHELL_SPEED * 0.9) / (SHELL_SPEED * 0.4) + e.bounces * 0.35)
        const dir = Math.atan2(e.vy, e.vx)
        audio.play('hit', 0.85 + k * 0.4)
        audio.buzz(25 + Math.round(k * 25))
        fx.burst(e.x, e.y, C.orange, {
          count: Math.round(12 + k * 10),
          speed: 520 + k * 300,
          size: 7,
          life: 0.35,
          gravity: 0,
          spread: 1.6,
          dir,
          kind: 'spark',
          colors: [C.orange, C.yellow, C.white],
        })
        fx.ring(e.x, e.y, SIDE[e.side].light, 100 + k * 40)
        fx.shake(0.22 + k * 0.18)
        fx.stop(3 + Math.round(k * 2))
        this.spring(e.id).kick(-4 - k * 4)
        if (e.bounces > 0) fx.float('Bank shot!', e.x, e.y - 70, C.yellow, 44, other(e.side))
        break
      }
      case 'kill': {
        const dir = Math.atan2(e.vy, e.vx)
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
        // Debris flies on with the shell that did it.
        fx.burst(e.x, e.y, SIDE[e.side].main, {
          count: 14,
          speed: 760,
          size: 14,
          life: 0.8,
          gravity: 0,
          drag: 2.4,
          spread: 1.4,
          dir,
          kind: 'square',
          colors: [SIDE[e.side].main, SIDE[e.side].dark, '#2b2733'],
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
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.gridOf(this.s.map)
    // The guest has no previous step to blend from.
    this.prev.clear()
  }

  render(g: Draw, alpha: number): void {
    const fdt = this.lastT < 0 ? 0 : Math.min(0.05, Math.max(0, g.t - this.lastT))
    this.lastT = g.t
    for (const sp of this.squash) sp?.update(fdt)
    const look = this.look
    look.alpha = alpha
    look.squash.length = 0
    for (const t of this.s.w.tanks) look.squash[t.id] = this.squash[t.id]?.value ?? 1
    renderTanks(g, this.s, this.gridOf(this.s.map), this.time, this.ctx.names, this.over, look)
  }
}

export default () => new Tanks()
