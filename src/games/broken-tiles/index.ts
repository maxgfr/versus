import { Joystick } from '../../core/controls.ts'
import { BaseGame, type MatchSpec, type Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { roundEnd, roundsNew, roundsStep, type Rounds } from '../../engines/reflex/index.ts'
import { TileBot } from './bot.ts'
import { renderBroken, type StickLook } from './render.ts'
import {
  type Board,
  dash,
  type Ev,
  newBoard,
  quakeDelay,
  SPEED,
  stepBoard,
  tileCentre,
} from './rules.ts'

export interface State {
  b: Board
  rounds: Rounds
  /** Stick visuals, so the online guest can draw them. */
  ctl: StickLook[]
}

/** Round wins to take the match (best of three by default). */
export const match: MatchSpec = { unit: 'wins', default: 2, min: 1, max: 5 }

/** Seconds between rounds, while the loser falls and the banner shows. */
const PAUSE = 2
/** Joystick radius (world units). */
const STICK_R = 120
/** Extra seconds before standing still starts to crack a tile at a round's start. */
const GRACE = 1
/** Finger speed (world units / s) above which a drag becomes a dash flick… */
const FLICK = 2000
/** …and the speed of a full-force flick. */
const FLICK_MAX = 5200

/** Keeps a floating label of half-width `half` inside the stage (x, world units). */
const keepInside = (x: number, half: number): number => Math.min(W - half, Math.max(half, x))

class BrokenTiles extends BaseGame<State> {
  private sticks: Joystick[] = []
  private bots: (TileBot | null)[] = []
  private ev: Ev[] = []
  // Cosmetic only (not synced): last step's positions for interpolation, the
  // finger's last knob position for flick speed, squash springs.
  private prev: [number, number, number, number] | null = null
  private knob: [number, number, number, number] = [0, 0, 0, 0]
  private held: [boolean, boolean] = [false, false]
  private squash: [Spring, Spring] = [new Spring(1, 360, 11), new Spring(1, 360, 11)]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    // Human touches: each half in local 2P; the whole table otherwise (1P, online).
    this.sticks = ([0, 1] as const).map((side) => {
      const zone =
        ctx.mode === '2p'
          ? { x: 0, y: side === 0 ? MID : 0, w: W, h: MID }
          : { x: 0, y: 0, w: W, h: H }
      return new Joystick(side, zone, STICK_R, W / 2, side === 0 ? MID + 420 : MID - 420)
    })
    this.bots = ([0, 1] as const).map((side) =>
      ctx.bots[side] ? TileBot.of(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      b: newBoard(this.time + GRACE, quakeDelay([0, 0], this.target)),
      rounds: roundsNew(this.target),
      ctl: this.looks(),
    }
  }

  private looks(): StickLook[] {
    return this.sticks.map((k, i) => ({
      side: i === 0 ? 0 : 1,
      on: k.active && !this.bots[i],
      bx: k.baseX,
      by: k.baseY,
      kx: k.knobX,
      ky: k.knobY,
      r: k.radius,
    }))
  }

  private keepPrev(): void {
    const [a, b] = this.s.b.p
    this.prev = [a.x, a.y, b.x, b.y]
  }

  protected step(dt: number): void {
    const s = this.s
    const { ctx } = this
    this.keepPrev()
    this.ev.length = 0
    if (roundsStep(s.rounds, this.time, PAUSE)) {
      // The ramp: later rounds (and match point) crumble sooner.
      s.b = newBoard(this.time + GRACE, quakeDelay(s.rounds.wins, this.target))
      this.prev = null
      ctx.audio.play('go')
      return
    }
    const playing = s.rounds.phase === 'play'
    const dirs: [number, number][] = [
      [0, 0],
      [0, 0],
    ]
    for (const side of [0, 1] as const) {
      const stick = this.sticks[side]
      if (!stick) continue
      const bot = this.bots[side]
      if (bot) {
        const d = playing ? bot.drive(s.b, side, this.time) : { x: 0, y: 0, dash: 0 }
        stick.set(d.x, d.y)
        if (d.dash > 0) dash(s.b, side, d.dash, this.time, this.ev)
      } else {
        stick.update(ctx.input.player(side))
        // The finger's speed is the dash: a quick flick bursts the body forward.
        const k = side * 2
        if (playing && stick.active && this.held[side]) {
          const v =
            Math.hypot(
              stick.knobX - (this.knob[k] as number),
              stick.knobY - (this.knob[k + 1] as number),
            ) / dt
          if (v > FLICK && stick.mag > 0.5)
            dash(s.b, side, (v - FLICK) / (FLICK_MAX - FLICK), this.time, this.ev)
        }
        this.held[side] = stick.active
        this.knob[k] = stick.knobX
        this.knob[k + 1] = stick.knobY
      }
      if (playing) dirs[side] = [stick.x, stick.y]
    }
    const winner = stepBoard(s.b, dirs, dt, this.time, this.ev, playing)
    for (const e of this.ev) this.juice(e)
    s.ctl = this.looks()
    if (!playing || winner === null) return
    this.roundOver(winner)
  }

  /** Someone fell: the survivor's moment, and the match's if it is decided. */
  private roundOver(winner: Side | 'draw'): void {
    const s = this.s
    const { fx, audio, names } = this.ctx
    const decided = roundEnd(s.rounds, winner, this.time, names)
    if (winner === 'draw') {
      audio.play('draw')
      return
    }
    const p = s.b.p[winner]
    const col = SIDE[winner]
    audio.play('score')
    floatFor(fx, winner, 'Still standing!', keepInside(p.x, 230), p.y - 120)
    fx.ring(p.x, p.y, col.light, 220)
    fx.burst(p.x, p.y, col.main, {
      count: 22,
      speed: 620,
      size: 12,
      life: 0.8,
      gravity: 0,
      drag: 2.6,
      colors: [col.main, col.light, C.yellow, C.white],
      kind: 'square',
    })
    this.squash[winner].kick(6)
    if (!decided) return
    fx.confetti(winner)
    fx.flash(col.main, 0.3)
    fx.ring(p.x, p.y, C.yellow, 360)
    fx.shake(0.3)
    this.finish(winner, { score: [s.rounds.wins[0], s.rounds.wins[1]], delay: 2.2 })
  }

  protected override afterEnd(dt: number): void {
    // The board keeps crumbling under the ending; the winner is safe.
    this.keepPrev()
    this.ev.length = 0
    stepBoard(this.s.b, [], dt, this.time, this.ev, false)
    for (const e of this.ev) if (e.k === 'drop') this.juice(e)
  }

  /** Every rules event becomes feedback here, scaled by how hard it happened. */
  private juice(e: Ev): void {
    const { fx, audio } = this.ctx
    const b = this.s.b
    switch (e.k) {
      case 'enter': {
        // Faster arrivals land harder: higher tap, more dust, a bigger squash.
        const p = b.p[e.side]
        const k = Math.min(1, Math.hypot(p.vx, p.vy) / (SPEED * 1.9))
        const c = tileCentre(e.i)
        audio.play('tap', 0.85 + k * 0.5 + Math.random() * 0.1)
        fx.burst(c.x, c.y + 30, SIDE[e.side].light, {
          count: 3 + Math.round(k * 6),
          speed: 140 + k * 200,
          size: 8,
          life: 0.35,
          gravity: 0,
          drag: 4,
        })
        this.squash[e.side].kick(-2 - k * 4)
        break
      }
      case 'dash': {
        const k = e.force
        const col = SIDE[e.side]
        const p = b.p[e.side]
        audio.play('whoosh', 0.9 + k * 0.6)
        // Dust kicked out behind the body (opposite the stick it is pushing).
        const st = this.sticks[e.side]
        const back = st && st.mag > 0.1 ? Math.atan2(-st.y, -st.x) : Math.PI / 2
        fx.burst(p.x, p.y + 20, 'rgba(255,255,255,0.7)', {
          count: 5 + Math.round(k * 9),
          speed: 220 + k * 320,
          size: 18,
          life: 0.45,
          gravity: 0,
          drag: 3.2,
          spread: 1.2,
          dir: back,
          colors: ['rgba(255,255,255,0.75)', col.light],
        })
        if (k > 0.6) {
          fx.sparks(p.x, p.y, col.light, Math.round(4 + k * 8))
          audio.buzz(Math.round(8 + k * 10))
        }
        if (k > 0.8) fx.shake(0.06 + k * 0.08)
        this.squash[e.side].kick(5 + k * 6)
        break
      }
      case 'crack': {
        const c = tileCentre(e.i)
        audio.play(e.stand ? 'tick' : 'click', 0.8 + Math.random() * 0.4)
        fx.burst(c.x, c.y, '#f6e6da', {
          count: e.stand ? 8 : 4,
          speed: 200,
          size: 7,
          life: 0.4,
          gravity: 0,
          drag: 3,
          kind: 'square',
          colors: ['#f6e6da', '#e7b48f', C.white],
        })
        if (e.stand) fx.ring(c.x, c.y, C.yellow, 90)
        if (e.edge) {
          // The quake: a low rumble that grows as it speeds up.
          const k = Math.min(1, b.quakes / 20)
          audio.play('thud', 0.45 + k * 0.2)
          fx.shake(0.04 + k * 0.08)
          fx.ring(c.x, c.y, C.orange, 110)
          if (b.quakes === 1)
            for (const side of [0, 1] as const)
              fx.float(
                'The edges crumble!',
                W / 2,
                side === 0 ? MID + 300 : MID - 300,
                C.orange,
                54,
                side,
              )
        }
        break
      }
      case 'drop': {
        const c = tileCentre(e.i)
        // A tile dropping right beside someone is a scare: shake by proximity.
        let near = Infinity
        for (const p of b.p) if (p.alive) near = Math.min(near, Math.hypot(p.x - c.x, p.y - c.y))
        const k = near < 300 ? 1 - near / 300 : 0
        audio.play('thud', 0.65 + Math.random() * 0.15 + k * 0.15)
        // Chips falling with the tile: no gravity on a top-down void, they just scatter and fade.
        fx.burst(c.x, c.y, '#e7b48f', {
          count: 8 + Math.round(k * 8),
          speed: 200 + k * 160,
          size: 12,
          life: 0.55,
          gravity: 0,
          drag: 3.5,
          kind: 'square',
          colors: ['#f2d2bb', '#c98a6a', '#8c6a7a'],
        })
        fx.shake(0.05 + k * 0.12)
        break
      }
      case 'fall': {
        const col = SIDE[e.side]
        const p = b.p[e.side]
        // A body that ran off falls harder than one whose tile dropped away.
        const k = Math.min(1, Math.hypot(p.vx, p.vy) / (SPEED * 1.9))
        audio.play('whoosh', 0.7 + k * 0.3)
        audio.play('thud', 0.5)
        audio.buzz(60 + Math.round(k * 40))
        fx.burst(e.x, e.y, col.main, {
          count: 24 + Math.round(k * 14),
          speed: 420 + k * 300,
          size: 14,
          life: 0.75,
          gravity: 0,
          drag: 2.5,
          colors: [col.main, col.light, C.white],
        })
        fx.ring(e.x, e.y, col.light, 200 + k * 80)
        fx.flash(col.main, 0.22)
        fx.float('Fell!', keepInside(e.x, 110), e.y - 100, col.light, 68, e.side)
        fx.shake(0.45 + k * 0.2)
        fx.stop(8)
        break
      }
    }
  }

  render(g: Draw, alpha: number): void {
    const s = this.s
    const pv = this.prev
    const pos = s.b.p.map((p, i) => ({
      x: pv ? lerp(pv[i * 2] as number, p.x, alpha) : p.x,
      y: pv ? lerp(pv[i * 2 + 1] as number, p.y, alpha) : p.y,
    }))
    for (const sp of this.squash) sp.update(1 / 60)
    const humans: [boolean, boolean] = [!this.ctx.bots[0], !this.ctx.bots[1]]
    renderBroken(g, s, this.time, this.ctx.names, this.over, humans, {
      pos,
      squash: [this.squash[0].value, this.squash[1].value],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new BrokenTiles()
