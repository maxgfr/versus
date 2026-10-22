import type { Side } from './game.ts'
import type { PlayerInput, Ptr } from './input.ts'
import type { Draw } from './render/draw.ts'
import { SIDE, alpha, shade } from './render/palette.ts'
import type { Rect } from './stage.ts'

/**
 * On-canvas controls. Each widget reads one side's PlayerInput every step and
 * exposes a plain value (vector, pressed, shot). Bots skip the fingers and set
 * the value directly through the same widget, so game code never cares who is
 * playing.
 */

const inRect = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

/** Online, each phone only shows its own player's controls. */
const rivals = (g: Draw, side: Side) => g.viewer !== null && g.viewer !== side

/** Floating joystick: the base appears where the finger lands inside `zone`. */
export class Joystick {
  x = 0
  y = 0
  /** Magnitude 0..1. */
  get mag(): number {
    return Math.min(1, Math.hypot(this.x, this.y))
  }
  active = false
  baseX: number
  baseY: number
  knobX: number
  knobY: number
  private ptr: number | null = null
  private botDriven = false

  constructor(
    readonly side: Side,
    public zone: Rect,
    public radius = 110,
    /** Where the idle stick is drawn. */
    public homeX = zone.x + zone.w / 2,
    public homeY = zone.y + zone.h / 2,
    public lane?: 0 | 1,
  ) {
    this.baseX = this.knobX = homeX
    this.baseY = this.knobY = homeY
  }

  /** Bot control: a world-space vector, magnitude ≤ 1. */
  set(x: number, y: number): void {
    this.botDriven = true
    const m = Math.hypot(x, y)
    const k = m > 1 ? 1 / m : 1
    this.x = x * k
    this.y = y * k
    this.active = m > 0.05
    this.baseX = this.homeX
    this.baseY = this.homeY
    this.knobX = this.homeX + this.x * this.radius
    this.knobY = this.homeY + this.y * this.radius
  }

  update(input: PlayerInput): void {
    if (this.botDriven) return
    if (this.ptr !== null && !input.held.has(this.ptr)) this.ptr = null
    if (this.ptr === null) {
      const p = input.downs.find(
        (d) => inRect(d, this.zone) && (this.lane === undefined || d.lane === this.lane),
      )
      if (p) {
        this.ptr = p.id
        this.baseX = p.x
        this.baseY = p.y
      }
    }
    const p = this.ptr === null ? undefined : input.held.get(this.ptr)
    if (!p) {
      this.active = false
      this.x = this.y = 0
      this.baseX = this.knobX = this.homeX
      this.baseY = this.knobY = this.homeY
      return
    }
    const dx = p.x - this.baseX
    const dy = p.y - this.baseY
    const m = Math.hypot(dx, dy)
    // Drag the base along when the finger outruns it: no dead stick at the rim.
    if (m > this.radius) {
      this.baseX += (dx / m) * (m - this.radius)
      this.baseY += (dy / m) * (m - this.radius)
    }
    this.active = true
    this.x = (p.x - this.baseX) / this.radius
    this.y = (p.y - this.baseY) / this.radius
    this.knobX = p.x
    this.knobY = p.y
  }

  render(g: Draw): void {
    if (rivals(g, this.side)) return
    const col = SIDE[this.side]
    g.alpha(this.active ? 0.9 : 0.4, () => {
      g.circle(this.baseX, this.baseY, this.radius, alpha(col.dark, 0.35), alpha(col.light, 0.5), 5)
      g.ball(this.knobX, this.knobY, this.radius * 0.45, col.main, 0.6)
    })
  }
}

/** Round push button for one side. `pressed` while held, `hit` on the step it went down. */
export class Button {
  pressed = false
  hit = false
  private was = false
  private botPress = 0

  constructor(
    readonly side: Side,
    public x: number,
    public y: number,
    public r = 90,
    public glyph = '',
    public color: string = SIDE[side].main,
  ) {}

  /** Bot control: hold for `steps` fixed steps (1 = a tap). */
  press(steps = 1): void {
    this.botPress = Math.max(this.botPress, steps)
  }

  update(input: PlayerInput): void {
    let on = this.botPress > 0
    if (this.botPress > 0) this.botPress--
    if (!on) {
      const rr = (this.r * 1.25) ** 2
      // A quick tap can go down and up between two steps: count presses too.
      for (const p of input.downs) {
        if ((p.x - this.x) ** 2 + (p.y - this.y) ** 2 <= rr) {
          on = true
          break
        }
      }
    }
    if (!on) {
      const rr = (this.r * 1.25) ** 2
      for (const p of input.held.values()) {
        if ((p.x - this.x) ** 2 + (p.y - this.y) ** 2 <= rr) {
          on = true
          break
        }
      }
    }
    this.hit = on && !this.was
    this.pressed = on
    this.was = on
  }

  render(g: Draw): void {
    if (rivals(g, this.side)) return
    const depth = this.r * 0.16
    const press = this.pressed ? 1 : 0
    g.circle(this.x, this.y + depth, this.r, shade(this.color, -0.4))
    g.circle(
      this.x,
      this.y + depth * press,
      this.r,
      g.rad(
        this.x,
        this.y,
        this.r * 0.1,
        this.r,
        [
          [0, shade(this.color, 0.3)],
          [1, this.color],
        ],
        this.x - this.r * 0.3,
        this.y - this.r * 0.4,
      ),
    )
    if (this.glyph) {
      g.forSide(this.side, this.x, this.y + depth * press, () => {
        if (/\p{Extended_Pictographic}/u.test(this.glyph)) g.emoji(this.glyph, 0, 0, this.r * 0.95)
        else
          g.text(this.glyph, 0, 0, {
            size: this.r * 0.7,
            weight: 700,
            color: '#fff',
            drop: alpha('#000000', 0.3),
          })
      })
    }
  }
}

export interface Shot {
  /** Unit direction of the shot (opposite to the pull, like a slingshot). */
  dx: number
  dy: number
  /** 0..1 */
  power: number
}

/**
 * Slingshot aim: press inside `zone`, pull back, release to fire. While aiming,
 * `aim` holds the would-be shot so the game can draw a trajectory preview.
 */
export class DragAim {
  aim: Shot | null = null
  /** Set for exactly one step when released with enough pull. */
  shot: Shot | null = null
  private ptr: Ptr | null = null
  private botShot: Shot | null = null

  constructor(
    readonly side: Side,
    public zone: Rect,
    public maxPull = 320,
    public minPower = 0.12,
  ) {}

  /** Bot control: fire this shot on the next update. */
  fire(dx: number, dy: number, power: number): void {
    const m = Math.hypot(dx, dy) || 1
    this.botShot = { dx: dx / m, dy: dy / m, power: Math.max(0, Math.min(1, power)) }
  }

  get origin(): { x: number; y: number } | null {
    return this.ptr ? { x: this.ptr.x0, y: this.ptr.y0 } : null
  }

  get finger(): { x: number; y: number } | null {
    return this.ptr ? { x: this.ptr.x, y: this.ptr.y } : null
  }

  update(input: PlayerInput): void {
    this.shot = null
    if (this.botShot) {
      this.shot = this.botShot
      this.botShot = null
      this.aim = null
      return
    }
    if (!this.ptr) {
      const p = input.downs.find((d) => inRect(d, this.zone))
      if (p) this.ptr = p
    }
    if (!this.ptr) {
      this.aim = null
      return
    }
    const p = this.ptr
    const dx = p.x0 - p.x
    const dy = p.y0 - p.y
    const m = Math.hypot(dx, dy)
    const s: Shot | null =
      m < 1 ? null : { dx: dx / m, dy: dy / m, power: Math.min(1, m / this.maxPull) }
    if (!input.held.has(p.id)) {
      this.ptr = null
      this.aim = null
      if (s && s.power >= this.minPower) this.shot = s
      return
    }
    this.aim = s
  }

  cancel(): void {
    this.ptr = null
    this.aim = null
  }

  /** Default rubber-band visual from the press point to the finger. */
  render(g: Draw): void {
    if (rivals(g, this.side)) return
    const o = this.origin
    const f = this.finger
    if (!o || !f) return
    const col = SIDE[this.side]
    g.line(o.x, o.y, f.x, f.y, alpha(col.light, 0.6), 8)
    g.circle(o.x, o.y, 16, col.light)
    g.circle(f.x, f.y, 26, alpha(col.main, 0.8))
  }
}

/** Counts presses landing inside a rect (mash games, tap targets). */
export class TapZone {
  taps = 0
  hit = false
  private botTaps = 0

  constructor(
    readonly side: Side,
    public rect: Rect,
  ) {}

  tap(n = 1): void {
    this.botTaps += n
  }

  update(input: PlayerInput): void {
    let n = this.botTaps
    this.botTaps = 0
    for (const p of input.downs) if (inRect(p, this.rect)) n++
    this.hit = n > 0
    this.taps += n
  }
}
