/**
 * The logical stage: every game is written for a fixed 1000 × 1800 portrait
 * world, red at the bottom (y = 1800), blue at the top (y = 0). The canvas fills
 * the screen; the world is scaled to fit and the extra area (letterbox) is still
 * drawn into — `view` gives its extent in world units so backdrops can bleed.
 *
 * The online guest sees the world rotated 180° so their own side is at the
 * bottom of their screen; input is mapped back through the same transform.
 */
export const W = 1000
export const H = 1800
export const MID = H / 2

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export class Stage {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  /** CSS px per world unit. */
  scale = 1
  /** Device pixels per CSS px (capped at 2: past that, fill rate costs more than it shows). */
  dpr = 1
  /** Screen offset (CSS px) of world (0, 0) before rotation. */
  ox = 0
  oy = 0
  /** 0 or π: the guest's view is upside down. */
  rot = 0
  /** Visible area in world units, letterbox included. */
  view: Rect = { x: 0, y: 0, w: W, h: H }
  /** Safe area in world units (notch, home bar), relative to the visible edges. */
  safe = { top: 0, bottom: 0, left: 0, right: 0 }
  private cssW = 0
  private cssH = 0
  private ro: ResizeObserver | null = null

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'stage'
    const ctx = this.canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.ctx = ctx
    parent.appendChild(this.canvas)
    this.resize()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.canvas)
  }

  setRotated(rotated: boolean): void {
    this.rot = rotated ? Math.PI : 0
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect()
    this.cssW = Math.max(1, r.width || window.innerWidth)
    this.cssH = Math.max(1, r.height || window.innerHeight)
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(this.cssW * this.dpr)
    this.canvas.height = Math.round(this.cssH * this.dpr)
    this.scale = Math.min(this.cssW / W, this.cssH / H)
    this.ox = (this.cssW - W * this.scale) / 2
    this.oy = (this.cssH - H * this.scale) / 2
    const vx = -this.ox / this.scale
    const vy = -this.oy / this.scale
    this.view = { x: vx, y: vy, w: this.cssW / this.scale, h: this.cssH / this.scale }
    // The canvas is laid out inside the safe area (see .stage in style.css), so
    // its edges are already safe; `safe` stays for layouts that want margins.
    this.safe = { top: 0, bottom: 0, left: 0, right: 0 }
  }

  /** Apply the world transform to the context (device pixels). */
  applyTransform(ctx: CanvasRenderingContext2D = this.ctx): void {
    const k = this.dpr * this.scale
    if (this.rot === 0) {
      ctx.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr)
    } else {
      // Rotate 180° around the stage centre.
      ctx.setTransform(
        -k,
        0,
        0,
        -k,
        (this.ox + W * this.scale) * this.dpr,
        (this.oy + H * this.scale) * this.dpr,
      )
    }
  }

  /** Client (CSS px) → world. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    const x = (clientX - r.left - this.ox) / this.scale
    const y = (clientY - r.top - this.oy) / this.scale
    return this.rot === 0 ? { x, y } : { x: W - x, y: H - y }
  }

  /**
   * The visible rect's edges in world units, in the orientation of the world
   * (for the rotated guest the "bottom" of their screen is the world top).
   */
  get top(): number {
    return this.view.y
  }
  get bottom(): number {
    return this.view.y + this.view.h
  }
  get left(): number {
    return this.view.x
  }
  get right(): number {
    return this.view.x + this.view.w
  }

  /** Inner edge for a side's HUD: red's is near the bottom, blue's near the top. Safe-area aware. */
  edge(side: 0 | 1): number {
    const atScreenBottom = (side === 0) === (this.rot === 0)
    const inset = atScreenBottom ? this.safe.bottom : this.safe.top
    return side === 0 ? this.bottom - inset : this.top + inset
  }

  destroy(): void {
    this.ro?.disconnect()
    this.ro = null
    // Releasing the backing store promptly matters on iOS, which caps total canvas memory.
    this.canvas.width = 1
    this.canvas.height = 1
    this.canvas.remove()
  }
}
