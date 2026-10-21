import { Joystick } from '../../core/controls.ts'
import { BaseGame, type MatchSpec } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { RaceBot } from './bot.ts'
import { renderRace, type StickLook } from './render.ts'
import {
  buildTrack,
  type Car,
  controlPoints,
  type Drive,
  type Ev,
  gridCar,
  type Pt,
  stepRace,
  type Track,
  winnerOf,
} from './rules.ts'

export interface State {
  /** Control points of the track (the track itself is rebuilt from them). */
  pts: Pt[]
  /** Red then blue. */
  cars: [Car, Car]
  /** Race start: the countdown ends here (s). */
  go: number
  /** Laps to finish, copied from the match length so the guest can draw the counter. */
  laps: number
  /** Stick visuals, so the online guest can draw them. */
  ctl: StickLook[]
}

/** Laps to win (3 by default, the match length in laps). */
export const match: MatchSpec = { unit: 'rounds', default: 3, min: 1, max: 9 }

/** Stick radius (world units). */
const STICK_R = 120
/** Sideways distance of each car from the start line's centre (units). */
const GRID_OFF = 46
/** Seconds the finishing banner stays before the result. */
const DELAY = 1.6

/** Keeps a floating label of half-width `half` inside the stage (x, world units). */
const keepInside = (x: number, half: number): number => Math.min(W - half, Math.max(half, x))

class RacingCars extends BaseGame<State> {
  private sticks: Joystick[] = []
  private bots: (RaceBot | null)[] = []
  private ev: Ev[] = []
  private trk: Track | null = null
  private went = false

  private get target(): number {
    return this.ctx.target || match.default
  }

  /** The circuit, rebuilt from the control points in the state (cached). */
  private get track(): Track {
    if (!this.trk) this.trk = buildTrack(this.s.pts)
    return this.trk
  }

  protected setup(): State {
    const { ctx } = this
    const pts = controlPoints(ctx.rng)
    this.trk = buildTrack(pts)
    this.sticks = ([0, 1] as const).map((side) => {
      const zone =
        ctx.mode === '2p'
          ? { x: 0, y: side === 0 ? MID : 0, w: W, h: MID }
          : { x: 0, y: 0, w: W, h: H }
      return new Joystick(side, zone, STICK_R, W / 2, side === 0 ? MID + 420 : MID - 420)
    })
    this.bots = ([0, 1] as const).map((side) =>
      ctx.bots[side] ? RaceBot.of(ctx.rng.fork(), ctx.difficulty) : null,
    )
    return {
      pts,
      cars: [gridCar(this.trk, 0, GRID_OFF), gridCar(this.trk, 1, GRID_OFF)],
      // The shell has just counted down: the race starts at once.
      go: 0,
      laps: this.target,
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

  /** The guest gets the host's control points, so the circuit must be rebuilt from them. */
  override restore(snap: unknown): void {
    super.restore(snap)
    this.trk = null
  }

  protected step(dt: number): void {
    const s = this.s
    this.drive(dt)
    if (this.time < s.go) return
    const w = winnerOf(s.cars)
    if (w) {
      const other = w.side === 0 ? s.cars[1] : s.cars[0]
      const note =
        other.finishT >= 0
          ? `Won by ${(other.finishT - w.finishT).toFixed(2)} s`
          : 'Across the line first'
      const { fx } = this.ctx
      fx.confetti(w.side)
      fx.flash(C.white, 0.35)
      fx.ring(w.x, w.y, C.yellow, 280)
      fx.burst(w.x, w.y, C.white, {
        count: 30,
        speed: 620,
        size: 16,
        life: 0.9,
        gravity: 300,
        kind: 'square',
        colors: [C.white, C.ink, C.yellow],
      })
      fx.shake(0.35)
      fx.stop(6)
      floatFor(fx, w.side, 'Winner!', keepInside(w.x, 150), w.y + (w.side === 0 ? -110 : 110))
      this.finish(w.side, { note, delay: DELAY })
    }
  }

  /** Read sticks (or bots) and move the cars. Also runs during the ending, so the loser keeps racing. */
  private drive(dt: number): void {
    const s = this.s
    const { ctx } = this
    const tr = this.track
    if (this.time >= s.go && !this.went) {
      this.went = true
      if (s.go > 0) ctx.audio.play('go')
    }
    const drives: Drive[] = ([0, 1] as const).map((side) => {
      const car = s.cars[side]
      const stick = this.sticks[side]
      const bot = this.bots[side]
      if (bot && stick) {
        const d = bot.drive(car, tr, Math.hypot(car.vx, car.vy), dt)
        stick.set(d.jx, d.jy)
        return d
      }
      if (!stick) return { jx: 0, jy: 0, m: 0, mul: 1 }
      stick.update(ctx.input.player(side))
      return { jx: stick.x, jy: stick.y, m: stick.mag, mul: 1 }
    })
    this.ev.length = 0
    stepRace(s.cars, tr, drives, dt, this.time, s.go, s.laps * tr.len, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.looks()
    // Exhaust puffs and grass dust, a few times a second.
    if (Math.floor(this.time * 12) !== Math.floor((this.time - dt) * 12))
      for (const c of s.cars) {
        const v = Math.hypot(c.vx, c.vy)
        if (v < 80) continue
        const bx = c.x - Math.cos(c.h) * 50
        const by = c.y - Math.sin(c.h) * 50
        if (!c.onTrack) ctx.fx.puff(bx, by, 'rgba(150,120,80,0.5)', 2)
        else if (c.finishT < 0) ctx.fx.puff(bx, by, 'rgba(230,230,240,0.28)', 1)
      }
  }

  protected override afterEnd(dt: number): void {
    this.drive(dt)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const laps = this.s.laps
    switch (e.k) {
      case 'lap': {
        if (e.lap >= laps) {
          audio.play('powerup')
          break
        }
        const last = e.lap === laps - 1
        audio.play(last ? 'powerup' : 'coin', 1 + e.lap * 0.05)
        fx.float(
          last ? 'Final lap!' : `Lap ${e.lap + 1}/${laps}`,
          keepInside(e.x, 170),
          e.y + (e.side === 0 ? -90 : 90),
          last ? C.yellow : SIDE[e.side].light,
          56,
          e.side,
        )
        fx.ring(e.x, e.y, SIDE[e.side].light, 130)
        fx.burst(e.x, e.y, C.yellow, { count: 12, speed: 260, size: 9, life: 0.5, gravity: 200 })
        break
      }
      case 'grass':
        audio.play('thud', 1.3 + rng.next() * 0.2)
        audio.buzz(15)
        fx.puff(e.x, e.y, 'rgba(160,220,140,0.55)', 5)
        fx.burst(e.x, e.y, C.grass, {
          count: 8,
          speed: 260,
          size: 8,
          life: 0.5,
          gravity: 0,
          drag: 3,
        })
        break
      case 'drift':
        audio.play('slide', 1 + rng.next() * 0.2)
        fx.puff(e.x, e.y, 'rgba(235,235,245,0.4)', 2)
        break
      case 'bump':
        audio.play('hit', 1.2)
        audio.buzz(30)
        fx.sparks(e.x, e.y, C.yellow, 14)
        fx.ring(e.x, e.y, C.white, 90)
        fx.shake(0.25)
        fx.stop(2)
        break
    }
  }

  render(g: Draw): void {
    const s = this.s
    const humans: [boolean, boolean] = [!this.ctx.bots[0], !this.ctx.bots[1]]
    renderRace(g, s, this.track, this.time, this.ctx.names, this.over, humans)
  }
}

export default () => new RacingCars()
