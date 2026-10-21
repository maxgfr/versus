import type { Side } from '../game.ts'
import { H, MID, W, type Stage } from '../stage.ts'
import { C, FONT, SIDE, alpha, shade } from './palette.ts'
import { emojiSprite } from './sprites.ts'

export type Fill = string | CanvasGradient | CanvasPattern

export interface TextOpts {
  size?: number
  color?: Fill
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  weight?: number
  /** Rotation in radians around (x, y). */
  angle?: number
  /** Outline colour and width (drawn under the fill). */
  stroke?: string
  strokeWidth?: number
  /** Drop shadow under the glyphs: a toy look without blur cost. */
  drop?: string
  maxWidth?: number
}

export type Mood = 'happy' | 'sad' | 'angry' | 'wow' | 'dizzy' | 'sleep' | 'grin'

export interface BlobOpts {
  mood?: Mood
  /** Where the pupils look, unit-ish vector. */
  look?: [number, number]
  /** Horizontal / vertical scale for squash & stretch. */
  sx?: number
  sy?: number
  angle?: number
  /** Eye spacing / size tweak. */
  eyes?: number
  cheeks?: boolean
  outline?: boolean
}

/**
 * The draw kit: thin, allocation-light helpers over Canvas 2D that give every
 * game the same chunky, glossy toy look. Everything is in world units (the
 * stage transform is applied before a game renders).
 */
export class Draw {
  readonly ctx: CanvasRenderingContext2D
  /** True in local 2P: blue's text and widgets are drawn upside down. */
  flipTop: boolean
  /** Elapsed real time (s), for idle animations that should run even when paused. */
  t = 0

  constructor(
    readonly stage: Stage,
    flipTop: boolean,
  ) {
    this.ctx = stage.ctx
    this.flipTop = flipTop
  }

  /** Rotation that makes text upright for the player on `side` (or for the viewer if omitted). */
  orient(side?: Side): number {
    if (side !== undefined && this.flipTop) return side === 1 ? Math.PI : 0
    return this.stage.rot
  }

  // ---------- primitives ----------

  /** Fill the whole visible area (letterbox included). */
  fillView(fill: Fill): void {
    const v = this.stage.view
    this.ctx.fillStyle = fill
    this.ctx.fillRect(v.x - 2, v.y - 2, v.w + 4, v.h + 4)
  }

  rect(x: number, y: number, w: number, h: number, fill: Fill): void {
    this.ctx.fillStyle = fill
    this.ctx.fillRect(x, y, w, h)
  }

  path(fn: (c: CanvasRenderingContext2D) => void, fill?: Fill, stroke?: Fill, lw = 4): void {
    const c = this.ctx
    c.beginPath()
    fn(c)
    if (fill) {
      c.fillStyle = fill
      c.fill()
    }
    if (stroke) {
      c.strokeStyle = stroke
      c.lineWidth = lw
      c.stroke()
    }
  }

  rrect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill?: Fill,
    stroke?: Fill,
    lw = 4,
  ): void {
    this.path((c) => c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)), fill, stroke, lw)
  }

  circle(x: number, y: number, r: number, fill?: Fill, stroke?: Fill, lw = 4): void {
    this.path((c) => c.arc(x, y, Math.max(0, r), 0, Math.PI * 2), fill, stroke, lw)
  }

  ellipse(x: number, y: number, rx: number, ry: number, fill?: Fill, angle = 0): void {
    this.path((c) => c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), angle, 0, Math.PI * 2), fill)
  }

  ring(x: number, y: number, r: number, stroke: Fill, lw = 6): void {
    this.circle(x, y, r, undefined, stroke, lw)
  }

  arc(x: number, y: number, r: number, a0: number, a1: number, stroke: Fill, lw = 6): void {
    const c = this.ctx
    c.beginPath()
    c.arc(x, y, r, a0, a1)
    c.strokeStyle = stroke
    c.lineWidth = lw
    c.lineCap = 'round'
    c.stroke()
  }

  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    stroke: Fill,
    lw = 4,
    cap: CanvasLineCap = 'round',
  ): void {
    const c = this.ctx
    c.beginPath()
    c.moveTo(x0, y0)
    c.lineTo(x1, y1)
    c.strokeStyle = stroke
    c.lineWidth = lw
    c.lineCap = cap
    c.stroke()
  }

  dashed(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    stroke: Fill,
    lw = 4,
    dash = [16, 14],
  ): void {
    this.ctx.setLineDash(dash)
    this.line(x0, y0, x1, y1, stroke, lw, 'butt')
    this.ctx.setLineDash([])
  }

  poly(pts: readonly number[], fill?: Fill, stroke?: Fill, lw = 4): void {
    this.path(
      (c) => {
        c.moveTo(pts[0] ?? 0, pts[1] ?? 0)
        for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0)
        c.closePath()
      },
      fill,
      stroke,
      lw,
    )
  }

  star(
    x: number,
    y: number,
    r: number,
    fill: Fill,
    points = 5,
    inner = 0.5,
    angle = -Math.PI / 2,
  ): void {
    const pts: number[] = []
    for (let i = 0; i < points * 2; i++) {
      const rr = i % 2 === 0 ? r : r * inner
      const a = angle + (i * Math.PI) / points
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    this.poly(pts, fill)
  }

  lin(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    stops: readonly (readonly [number, string])[],
  ): CanvasGradient {
    const g = this.ctx.createLinearGradient(x0, y0, x1, y1)
    for (const [o, col] of stops) g.addColorStop(o, col)
    return g
  }

  rad(
    x: number,
    y: number,
    r0: number,
    r1: number,
    stops: readonly (readonly [number, string])[],
    fx = x,
    fy = y,
  ): CanvasGradient {
    const g = this.ctx.createRadialGradient(fx, fy, r0, x, y, r1)
    for (const [o, col] of stops) g.addColorStop(o, col)
    return g
  }

  // ---------- transforms ----------

  save(): void {
    this.ctx.save()
  }

  restore(): void {
    this.ctx.restore()
  }

  /** Run `fn` with the origin moved to (x, y) and rotated / scaled. */
  at(x: number, y: number, angle: number, fn: () => void, sx = 1, sy = sx): void {
    const c = this.ctx
    c.save()
    c.translate(x, y)
    if (angle) c.rotate(angle)
    if (sx !== 1 || sy !== 1) c.scale(sx, sy)
    fn()
    c.restore()
  }

  /** Run `fn` in a frame where up is "up" for that player (rotated 180° about (x, y) for blue in local 2P). */
  forSide(side: Side | undefined, x: number, y: number, fn: () => void): void {
    this.at(x, y, this.orient(side), fn)
  }

  alpha(a: number, fn: () => void): void {
    const c = this.ctx
    const prev = c.globalAlpha
    c.globalAlpha = prev * Math.max(0, Math.min(1, a))
    fn()
    c.globalAlpha = prev
  }

  clip(x: number, y: number, w: number, h: number, r: number, fn: () => void): void {
    const c = this.ctx
    c.save()
    c.beginPath()
    c.roundRect(x, y, w, h, r)
    c.clip()
    fn()
    c.restore()
  }

  // ---------- text ----------

  font(size: number, weight = 600): string {
    return `${weight} ${size}px ${FONT}`
  }

  text(s: string | number, x: number, y: number, o: TextOpts = {}): void {
    const c = this.ctx
    const str = String(s)
    c.save()
    c.translate(x, y)
    if (o.angle) c.rotate(o.angle)
    c.font = this.font(o.size ?? 48, o.weight ?? 600)
    c.textAlign = o.align ?? 'center'
    c.textBaseline = o.baseline ?? 'middle'
    const size = o.size ?? 48
    if (o.drop) {
      c.fillStyle = o.drop
      c.fillText(str, 0, size * 0.08, o.maxWidth)
    }
    if (o.stroke) {
      c.lineJoin = 'round'
      c.strokeStyle = o.stroke
      c.lineWidth = o.strokeWidth ?? size * 0.18
      c.strokeText(str, 0, 0, o.maxWidth)
    }
    c.fillStyle = o.color ?? C.white
    c.fillText(str, 0, 0, o.maxWidth)
    c.restore()
  }

  /** Text upright for `side`'s player. */
  sideText(side: Side, s: string | number, x: number, y: number, o: TextOpts = {}): void {
    this.text(s, x, y, { ...o, angle: (o.angle ?? 0) + this.orient(side) })
  }

  /**
   * The same message for both players: red reads it below the midline, blue
   * (upside down in local 2P) above. Outside local 2P it is shown once, centred.
   */
  both(s: string | number, o: TextOpts & { gap?: number } = {}, cy = MID): void {
    if (!this.flipTop) {
      this.text(s, W / 2, cy, { ...o, angle: this.stage.rot })
      return
    }
    const gap = o.gap ?? 120
    this.text(s, W / 2, cy + gap, o)
    this.text(s, W / 2, cy - gap, { ...o, angle: Math.PI })
  }

  measure(s: string, size: number, weight = 600): number {
    this.ctx.font = this.font(size, weight)
    return this.ctx.measureText(s).width
  }

  // ---------- sprites ----------

  /** Colour emoji, cached as a bitmap. (x, y) is the centre. */
  emoji(ch: string, x: number, y: number, size: number, angle = 0, sx = 1, sy = sx): void {
    const devicePx = size * this.stage.scale * this.stage.dpr * Math.max(Math.abs(sx), Math.abs(sy))
    const img = emojiSprite(ch, devicePx)
    // The sprite has padding of 15% of the bucket on each side.
    const full = size * 1.3
    const c = this.ctx
    if (angle || sx !== 1 || sy !== 1) {
      c.save()
      c.translate(x, y)
      c.rotate(angle)
      c.scale(sx, sy)
      c.drawImage(img, -full / 2, -full / 2, full, full)
      c.restore()
    } else {
      c.drawImage(img, x - full / 2, y - full / 2, full, full)
    }
  }

  image(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    this.ctx.drawImage(img, x, y, w, h)
  }

  // ---------- the toy look ----------

  /** Soft contact shadow under an object resting on the ground. */
  shadow(x: number, y: number, rx: number, ry = rx * 0.35, a = 0.35): void {
    this.ellipse(x, y, rx, ry, `rgba(0,0,0,${a})`)
  }

  private relit = false

  /**
   * Light comes from the top of the viewer's screen. On the rotated online
   * guest, re-draw the shape rotated about its centre so lips and gloss still
   * face the right way. Returns true when it handled the draw.
   */
  private lit(cx: number, cy: number, draw: () => void): boolean {
    if (this.stage.rot === 0 || this.relit) return false
    this.relit = true
    this.at(cx, cy, Math.PI, () => {
      this.ctx.translate(-cx, -cy)
      draw()
    })
    this.relit = false
    return true
  }

  /**
   * A chunky raised tile: darker lip below, face on top, glossy top highlight.
   * `depth` is the lip height. Used for buttons, cards, cells, blocks.
   */
  tile(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    color: string,
    depth = 10,
    pressed = 0,
  ): void {
    if (this.lit(x + w / 2, y + h / 2, () => this.tile(x, y, w, h, r, color, depth, pressed)))
      return
    const d = depth * (1 - pressed)
    const yy = y + (depth - d)
    this.rrect(x, yy + d, w, h - depth, r, shade(color, -0.35))
    this.rrect(x, yy, w, h - depth, r, color)
    const hl = this.lin(0, yy, 0, yy + (h - depth) * 0.55, [
      [0, 'rgba(255,255,255,0.32)'],
      [1, 'rgba(255,255,255,0)'],
    ])
    this.rrect(x + 4, yy + 3, w - 8, (h - depth) * 0.5, Math.max(0, r - 4), hl)
  }

  /** Glossy sphere with contact shadow off (call `shadow` separately when it sits on a floor). */
  ball(x: number, y: number, r: number, color: string, shine = 1): void {
    if (this.lit(x, y, () => this.ball(x, y, r, color, shine))) return
    const g = this.rad(
      x,
      y,
      r * 0.1,
      r,
      [
        [0, shade(color, 0.45)],
        [0.55, color],
        [1, shade(color, -0.4)],
      ],
      x - r * 0.35,
      y - r * 0.4,
    )
    this.circle(x, y, r, g)
    if (shine > 0) {
      this.alpha(0.7 * shine, () =>
        this.ellipse(x - r * 0.33, y - r * 0.42, r * 0.32, r * 0.2, '#fff', -0.6),
      )
    }
  }

  /** Flat disc with a bevel (tokens, checkers, coins, pucks). */
  disc(x: number, y: number, r: number, color: string, depth = r * 0.18): void {
    if (this.lit(x, y, () => this.disc(x, y, r, color, depth))) return
    this.circle(x, y + depth, r, shade(color, -0.4))
    this.circle(
      x,
      y,
      r,
      this.rad(
        x,
        y,
        0,
        r,
        [
          [0, shade(color, 0.2)],
          [0.85, color],
          [1, shade(color, -0.15)],
        ],
        x - r * 0.3,
        y - r * 0.3,
      ),
    )
    this.ring(x, y, r * 0.72, alpha('#000000', 0.12), r * 0.08)
  }

  /**
   * A blob mascot: the cast of the whole arcade. A soft body in the side's (or
   * any) colour with big eyes, an expression, and squash & stretch.
   */
  blob(x: number, y: number, r: number, color: string, o: BlobOpts = {}): void {
    const c = this.ctx
    c.save()
    c.translate(x, y)
    if (o.angle) c.rotate(o.angle)
    c.scale(o.sx ?? 1, o.sy ?? 1)
    // Body
    const body = this.rad(
      0,
      0,
      r * 0.1,
      r * 1.05,
      [
        [0, shade(color, 0.35)],
        [0.6, color],
        [1, shade(color, -0.3)],
      ],
      -r * 0.3,
      -r * 0.45,
    )
    this.path(
      (p) => {
        // Slightly pear shaped: wider at the bottom, reads as a character, not a ball.
        p.moveTo(0, -r)
        p.bezierCurveTo(r * 0.75, -r, r * 1.02, -r * 0.35, r * 1.02, r * 0.25)
        p.bezierCurveTo(r * 1.02, r * 0.8, r * 0.6, r * 0.98, 0, r * 0.98)
        p.bezierCurveTo(-r * 0.6, r * 0.98, -r * 1.02, r * 0.8, -r * 1.02, r * 0.25)
        p.bezierCurveTo(-r * 1.02, -r * 0.35, -r * 0.75, -r, 0, -r)
      },
      body,
      o.outline ? shade(color, -0.5) : undefined,
      r * 0.08,
    )
    this.alpha(0.55, () => this.ellipse(-r * 0.38, -r * 0.55, r * 0.28, r * 0.16, '#fff', -0.5))
    // Face
    const mood = o.mood ?? 'happy'
    const [lx, ly] = o.look ?? [0, 0.15]
    const es = o.eyes ?? 1
    const ex = r * 0.36 * es
    const ey = -r * 0.12
    const er = r * 0.24 * es
    for (const sx of [-1, 1]) {
      if (mood === 'sleep') {
        this.arc(sx * ex, ey, er * 0.7, 0.2, Math.PI - 0.2, C.ink, r * 0.07)
        continue
      }
      if (mood === 'dizzy') {
        const k = er * 0.6
        this.line(sx * ex - k, ey - k, sx * ex + k, ey + k, C.ink, r * 0.08)
        this.line(sx * ex - k, ey + k, sx * ex + k, ey - k, C.ink, r * 0.08)
        continue
      }
      this.circle(sx * ex, ey, er, '#fff')
      const pr = er * (mood === 'wow' ? 0.4 : 0.55)
      this.circle(sx * ex + lx * er * 0.4, ey + ly * er * 0.4, pr, C.ink)
      this.circle(
        sx * ex + lx * er * 0.4 - pr * 0.35,
        ey + ly * er * 0.4 - pr * 0.35,
        pr * 0.32,
        '#fff',
      )
      if (mood === 'angry') {
        this.line(
          sx * ex - sx * er,
          ey - er * 1.25,
          sx * ex + sx * er * 0.6,
          ey - er * 0.7,
          C.ink,
          r * 0.09,
        )
      }
    }
    if (o.cheeks ?? true) {
      this.alpha(0.35, () => {
        this.ellipse(-r * 0.62, r * 0.18, r * 0.14, r * 0.09, C.pink)
        this.ellipse(r * 0.62, r * 0.18, r * 0.14, r * 0.09, C.pink)
      })
    }
    const my = r * 0.3
    if (mood === 'happy' || mood === 'grin') {
      this.path(
        (p) => {
          p.moveTo(-r * 0.22, my - r * 0.04)
          p.quadraticCurveTo(0, my + r * (mood === 'grin' ? 0.34 : 0.22), r * 0.22, my - r * 0.04)
          if (mood === 'grin') p.closePath()
        },
        mood === 'grin' ? C.ink : undefined,
        mood === 'happy' ? C.ink : undefined,
        r * 0.07,
      )
    } else if (mood === 'sad') {
      this.arc(0, my + r * 0.16, r * 0.17, Math.PI + 0.5, -0.5, C.ink, r * 0.07)
    } else if (mood === 'angry') {
      this.line(-r * 0.16, my + r * 0.04, r * 0.16, my + r * 0.04, C.ink, r * 0.08)
    } else if (mood === 'wow') {
      this.ellipse(0, my + r * 0.05, r * 0.11, r * 0.14, C.ink)
    } else if (mood === 'dizzy') {
      this.path(
        (p) => {
          p.moveTo(-r * 0.2, my)
          p.quadraticCurveTo(-r * 0.1, my - r * 0.1, 0, my)
          p.quadraticCurveTo(r * 0.1, my + r * 0.1, r * 0.2, my)
        },
        undefined,
        C.ink,
        r * 0.06,
      )
    } else if (mood === 'sleep') {
      this.ellipse(0, my, r * 0.07, r * 0.05, C.ink)
    }
    c.restore()
  }

  /** Side marker that never relies on colour alone: red = circle, blue = rounded square. */
  sideMark(side: Side, x: number, y: number, r: number, fill?: string): void {
    const col = fill ?? SIDE[side].main
    if (side === 0) this.circle(x, y, r, col)
    else this.rrect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.35, col)
  }

  /** Big score figure at a side's edge, upright for that player. */
  score(
    side: Side,
    value: string | number,
    o: { x?: number; inset?: number; size?: number } = {},
  ): void {
    const size = o.size ?? 84
    const inset = o.inset ?? 80
    const y = side === 0 ? this.stage.edge(0) - inset : this.stage.edge(1) + inset
    const x = o.x ?? (side === 0 ? W - 110 : 110)
    this.sideText(side, value, x, y, {
      size,
      weight: 700,
      color: SIDE[side].main,
      drop: alpha('#000000', 0.35),
    })
  }

  /** Midline divider used by most split-screen games. */
  midline(color: string = alpha(C.white, 0.18), dash = true): void {
    if (dash) this.dashed(0, MID, W, MID, color, 6, [24, 18])
    else this.line(0, MID, W, MID, color, 6)
  }

  /** Tinted halves (red bottom, blue top) bleeding into the letterbox. */
  halves(red = shade(C.red, -0.72), blue = shade(C.blue, -0.72)): void {
    const v = this.stage.view
    this.rect(v.x - 2, v.y - 2, v.w + 4, MID - v.y + 2, blue)
    this.rect(v.x - 2, MID, v.w + 4, v.y + v.h - MID + 2, red)
  }

  /** Subtle vignette over everything; makes flat backgrounds feel lit. */
  vignette(strength = 0.45): void {
    const g = this.rad(W / 2, H / 2, H * 0.25, H * 0.75, [
      [0, 'rgba(0,0,0,0)'],
      [1, `rgba(0,0,0,${strength})`],
    ])
    this.fillView(g)
  }
}
