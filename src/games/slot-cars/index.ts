import { Button } from '../../core/controls.ts'
import { frame } from '../../core/frame.ts'
import { BaseGame, type MatchSpec } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { floatFor } from '../../core/fx/fx.ts'
import { lerp, Spring } from '../../core/fx/ease.ts'
import { toLocal } from '../../core/frame.ts'
import { W } from '../../core/stage.ts'
import { C, SIDE } from '../../core/render/palette.ts'
import { SlotBot } from './bot.ts'
import { danger, renderSlot, type ThrottleLook } from './render.ts'
import { type Car, type Ev, newCar, stepCars, winnerOf } from './rules.ts'

export interface State {
  /** Red then blue, one lane each. */
  cars: [Car, Car]
  /** Race start (s): the countdown ends here. */
  go: number
  /** Laps to finish, copied from the match length. */
  laps: number
  /** Throttle buttons, so the online guest can draw them. */
  ctl: ThrottleLook[]
}

/** Laps to win (five by default, the match length in laps). */
export const match: MatchSpec = { unit: 'rounds', default: 5, min: 1, max: 10 }

/** Seconds the finishing banner stays before the result. */
const DELAY = 1.6
/** Throttle button radius and spot in red's frame (bottom-right corner, clear of the pills). */
const THROTTLE_R = 80
/** Low enough to sit under the thumb, high enough that the power ring never runs off the screen edge. */
const THROTTLE_AT = { x: 810, y: 1688 }

/** A plain press squeezes the trigger this far; sliding the thumb up (toward the table) opens it fully. */
const PRESS_LEVEL = 0.7
/** Thumb travel (units) from no throttle to full. */
const TRAVEL = 200

/** Keeps a floating label of half-width `half` inside the stage (x, world units). */
const keepInside = (x: number, half: number): number => Math.min(W - half, Math.max(half, x))

class SlotCars extends BaseGame<State> {
  private throttles: Button[] = []
  private bots: (SlotBot | null)[] = []
  private ev: Ev[] = []
  private went = false
  /** The finger on each trigger: its pointer and where it pressed (side's own frame). */
  private grip: ({ id: number; y0: number } | null)[] = [null, null]
  // Cosmetic only (not synced): last step's poses, landing squash, lap pulses.
  private prev: { x: number; y: number; h: number }[] | null = null
  private squash: [Spring, Spring] = [new Spring(1, 420, 12), new Spring(1, 420, 12)]
  private pulse: [Spring, Spring] = [new Spring(0, 220, 10), new Spring(0, 220, 10)]
  private level: [number, number] = [0, 0]

  private get target(): number {
    return this.ctx.target || match.default
  }

  protected setup(): State {
    const { ctx } = this
    this.throttles = ([0, 1] as const).map((side) => {
      const p = frame(side, THROTTLE_AT.x, THROTTLE_AT.y)
      return new Button(side, p.x, p.y, THROTTLE_R, '⚡')
    })
    this.bots = ([0, 1] as const).map((side) =>
      ctx.bots[side] ? SlotBot.of(ctx.difficulty) : null,
    )
    return {
      cars: [newCar(0), newCar(1)],
      // The shell has just counted down: the race starts at once.
      go: 0,
      laps: this.target,
      ctl: this.looks(),
    }
  }

  private looks(): ThrottleLook[] {
    return this.throttles.map((b, i) => ({
      side: i === 0 ? 0 : 1,
      x: b.x,
      y: b.y,
      r: b.r,
      on: b.pressed || (this.level[i] ?? 0) > 0,
      level: this.level[i] ?? 0,
    }))
  }

  protected step(dt: number): void {
    const s = this.s
    this.drive(dt)
    if (this.time < s.go) return
    const w = winnerOf(s.cars)
    if (w !== null) {
      const other = w === 0 ? s.cars[1] : s.cars[0]
      const winner = s.cars[w]
      const note =
        other.finishT >= 0
          ? `Won by ${(other.finishT - winner.finishT).toFixed(2)} s`
          : 'Across the line first'
      const { fx } = this.ctx
      fx.confetti(w)
      fx.flash(C.white, 0.35)
      fx.ring(winner.x, winner.y, C.yellow, 260)
      fx.burst(winner.x, winner.y, C.white, {
        count: 28,
        speed: 600,
        size: 15,
        life: 0.9,
        gravity: 300,
        kind: 'square',
        colors: [C.white, C.ink, C.yellow],
      })
      fx.shake(0.3)
      fx.stop(6)
      floatFor(fx, w, 'Winner!', keepInside(winner.x, 150), winner.y + (w === 0 ? -110 : 110))
      this.finish(w, { note, delay: DELAY })
    }
  }

  /** Throttles (or bots) and car physics. Also runs during the ending, so the loser keeps racing. */
  private drive(dt: number): void {
    const s = this.s
    const { ctx } = this
    const racing = this.time >= s.go
    if (racing && !this.went) {
      this.went = true
      if (s.go > 0) ctx.audio.play('go')
    }
    const throttle: number[] = [0, 0]
    for (const side of [0, 1] as const) {
      const bot = this.bots[side]
      const btn = this.throttles[side]
      if (bot) {
        throttle[side] = racing && bot.throttle(s.cars[side]) ? 1 : 0
        if (btn && throttle[side]) btn.press(1)
        btn?.update(ctx.input.player(side))
      } else {
        if (!btn) continue
        const inp = ctx.input.player(side)
        btn.update(inp)
        // The grip holds while the finger stays down, even when the thumb slides off the button.
        throttle[side] = this.squeeze(side, btn.x, btn.y, btn.r)
      }
      this.level[side] = throttle[side] ?? 0
    }
    this.ev.length = 0
    this.prev = s.cars.map((c) => ({ x: c.x, y: c.y, h: c.h }))
    stepCars(s.cars, throttle, dt, this.time, s.go, s.laps, this.ev)
    for (const e of this.ev) this.feedback(e)
    s.ctl = this.looks()
    // Sparks from the guide pin when a car is close to flying off.
    if (Math.floor(this.time * 20) !== Math.floor((this.time - dt) * 20))
      for (const c of s.cars) {
        const d = danger(c)
        if (d < 0.8) continue
        ctx.fx.sparks(c.x, c.y, d > 0.92 ? C.orange : C.yellow, d > 0.92 ? 5 : 2)
        if (d > 0.92) ctx.audio.play('tick', 1.4)
      }
  }

  /**
   * How hard a human squeezes the trigger: a press is PRESS_LEVEL; sliding the
   * thumb up toward the table opens it to full, down toward the edge eases off.
   */
  private squeeze(side: 0 | 1, bx: number, by: number, r: number): number {
    const inp = this.ctx.input.player(side)
    let g = this.grip[side]
    if (g && !inp.held.has(g.id)) g = this.grip[side] = null
    if (!g) {
      for (const p of inp.held.values()) {
        if ((p.x - bx) ** 2 + (p.y - by) ** 2 > (r * 1.25) ** 2) continue
        g = this.grip[side] = { id: p.id, y0: toLocal(side, p.x, p.y).y }
        break
      }
    }
    const p = g ? inp.held.get(g.id) : undefined
    if (!g || !p) return 0
    const up = g.y0 - toLocal(side, p.x, p.y).y
    return Math.max(0, Math.min(1, PRESS_LEVEL + up / TRAVEL))
  }

  protected override afterEnd(dt: number): void {
    this.drive(dt)
  }

  private feedback(e: Ev): void {
    const { fx, audio, rng } = this.ctx
    const laps = this.s.laps
    const col = SIDE[e.side]
    const up = e.side === 0 ? -90 : 90
    switch (e.k) {
      case 'lap': {
        if (e.lap >= laps) {
          audio.play('powerup')
          break
        }
        const last = e.lap === laps - 1
        audio.play(last ? 'powerup' : 'coin', 1 + e.lap * 0.04)
        // The line crosses the middle of the table: each lap call lands in its owner's half.
        fx.float(
          last ? 'Final lap!' : `Lap ${e.lap + 1}/${laps}`,
          keepInside(e.x, 170),
          e.y - up * 1.4,
          last ? C.yellow : col.light,
          54,
          e.side,
        )
        fx.ring(e.x, e.y, col.light, 120)
        fx.burst(e.x, e.y, C.yellow, { count: 12, speed: 260, size: 9, life: 0.5, gravity: 200 })
        this.pulse[e.side].kick(14)
        break
      }
      case 'crash': {
        // How hard it came off: the faster, the bigger the bang.
        const k = Math.min(1, e.speed / 560)
        audio.play('explode', 0.7 + k * 0.3 + rng.next() * 0.1)
        audio.play('whoosh', 1.2)
        audio.buzz(Math.round(30 + k * 40))
        fx.sparks(e.x, e.y, C.yellow, Math.round(12 + k * 16))
        fx.burst(e.x, e.y, col.main, {
          count: 14,
          speed: 380,
          size: 11,
          life: 0.6,
          gravity: 0,
          drag: 2.5,
          kind: 'square',
          colors: [col.main, col.light, C.white, C.ink],
        })
        fx.puff(e.x, e.y, 'rgba(235,235,245,0.6)', 6)
        fx.ring(e.x, e.y, C.orange, 150)
        fx.flash(col.main, 0.18)
        fx.float('Crash!', keepInside(e.x, 120), e.y + up, C.orange, 60, e.side)
        fx.shake(0.25 + k * 0.3)
        fx.stop(Math.round(3 + k * 4))
        break
      }
      case 'land':
        audio.play('boing', 1.1 + rng.next() * 0.2)
        fx.puff(e.x, e.y, 'rgba(230,230,240,0.5)', 5)
        fx.ring(e.x, e.y, col.light, 90)
        this.squash[e.side].kick(-6)
        audio.buzz(10)
        break
    }
  }

  render(g: Draw, alpha: number): void {
    const humans: [boolean, boolean] = [!this.ctx.bots[0], !this.ctx.bots[1]]
    for (const sp of this.squash) sp.update(1 / 60)
    for (const sp of this.pulse) sp.update(1 / 60)
    const prev = this.prev
    const cars = this.s.cars.map((c, i): Car => {
      const p = prev?.[i]
      if (!p || Math.hypot(p.x - c.x, p.y - c.y) > 120) return c
      let dh = c.h - p.h
      while (dh > Math.PI) dh -= Math.PI * 2
      while (dh < -Math.PI) dh += Math.PI * 2
      return { ...c, x: lerp(p.x, c.x, alpha), y: lerp(p.y, c.y, alpha), h: p.h + dh * alpha }
    })
    renderSlot(g, this.s, this.time, this.ctx.names, this.over, humans, {
      cars,
      squash: [this.squash[0].value, this.squash[1].value],
      pulse: [Math.max(0, this.pulse[0].value / 14), Math.max(0, this.pulse[1].value / 14)],
    })
  }

  override restore(snap: unknown): void {
    super.restore(snap)
    this.prev = null
  }
}

export default () => new SlotCars()
