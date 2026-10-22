import type MatterNS from 'matter-js'
import type { Draw } from '../../core/render/draw.ts'
import { C, alpha, shade } from '../../core/render/palette.ts'
import type { M } from '../../engines/ragdoll/index.ts'

/**
 * Toy pieces with real silhouettes: each one is a handful of convex polygons
 * (body, neck, legs, spikes…) welded into one matter-js compound body, so it
 * balances, tips and rocks exactly like the shape you see. Pure geometry
 * (centred on the centre of mass) plus the matter builder and the drawing.
 */

/** One convex part, as flat [x0, y0, x1, y1, …] in the piece's frame (y down). */
export interface Part {
  pts: number[]
  /** Paint this part in its own colour (a shell, a beak, a belly). */
  color?: string
}

export type Mood = 'happy' | 'wow' | 'scared' | 'grin' | 'sad'

export interface ToyDef {
  name: string
  color: string
  /** Mass per unit area: light pufferfish, heavy hippo. */
  density: number
  parts: Part[]
  /** Eye centres and radius, in the same frame as the parts. */
  eyes: [number, number][]
  eyeR: number
  /** Where the mouth sits. */
  mouth: [number, number]
  /** Extra painting inside the silhouette (spots, stripes, a spiral), in the piece's frame. */
  paint?: (g: Draw, c: CanvasRenderingContext2D) => void
}

export interface Toy extends ToyDef {
  /** Distance from the centre of mass to the furthest vertex: a rotation-proof extent. */
  radius: number
  /** Total area of the parts (overlaps counted twice, as the physics does). */
  area: number
}

// ---------- geometry helpers (all convex) ----------

export const rect = (cx: number, cy: number, w: number, h: number): number[] => [
  cx - w / 2,
  cy - h / 2,
  cx + w / 2,
  cy - h / 2,
  cx + w / 2,
  cy + h / 2,
  cx - w / 2,
  cy + h / 2,
]

/** Rounded rectangle as a convex polygon (3 segments per corner). */
export function rrect(cx: number, cy: number, w: number, h: number, r: number): number[] {
  const rr = Math.min(r, w / 2, h / 2)
  const out: number[] = []
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy - h / 2 + rr, -Math.PI / 2],
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
  ]
  for (const [x, y, a0] of corners)
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2)
      out.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
  return out
}

/** Ellipse (or an arc of it closed by its chord) as a polygon of `n` points. */
export function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  n = 12,
  a0 = 0,
  a1 = Math.PI * 2,
): number[] {
  const out: number[] = []
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6
  const k = full ? n : n - 1
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / k
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  }
  return out
}

/** The top half of an ellipse with a flat base `base` units below its centre line. */
export function dome(cx: number, cy: number, rx: number, ry: number, base = 0, n = 10): number[] {
  const out = ellipse(cx, cy, rx, ry, n, Math.PI, Math.PI * 2)
  if (base > 0) out.push(cx + rx, cy + base, cx - rx, cy + base)
  return out
}

export const poly = (...pts: number[]): number[] => pts

/** Signed area (positive = clockwise on a y-down screen). */
function signedArea(p: number[]): number {
  let s = 0
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    s +=
      (p[i * 2] as number) * (p[j * 2 + 1] as number) -
      (p[j * 2] as number) * (p[i * 2 + 1] as number)
  }
  return s / 2
}

function centroid(p: number[]): { x: number; y: number; a: number } {
  const a = signedArea(p)
  let cx = 0
  let cy = 0
  const n = p.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const x0 = p[i * 2] as number
    const y0 = p[i * 2 + 1] as number
    const x1 = p[j * 2] as number
    const y1 = p[j * 2 + 1] as number
    const cr = x0 * y1 - x1 * y0
    cx += (x0 + x1) * cr
    cy += (y0 + y1) * cr
  }
  return { x: cx / (6 * a), y: cy / (6 * a), a: Math.abs(a) }
}

/** True when every turn of the outline goes the same way. */
export function isConvex(p: number[]): boolean {
  const n = p.length / 2
  let sign = 0
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2] as number
    const ay = p[i * 2 + 1] as number
    const bx = p[((i + 1) % n) * 2] as number
    const by = p[((i + 1) % n) * 2 + 1] as number
    const cx = p[((i + 2) % n) * 2] as number
    const cy = p[((i + 2) % n) * 2 + 1] as number
    const cr = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(cr) < 1e-9) continue
    const s = Math.sign(cr)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Centre a toy on its centre of mass (area-weighted over its parts, as the
 * physics weighs them) and wind every part the same way.
 */
export function makeToy(def: ToyDef): Toy {
  let ax = 0
  let ay = 0
  let area = 0
  for (const part of def.parts) {
    const c = centroid(part.pts)
    ax += c.x * c.a
    ay += c.y * c.a
    area += c.a
  }
  const ox = ax / area
  const oy = ay / area
  const shift = (p: number[]) => p.map((v, i) => (i % 2 === 0 ? v - ox : v - oy))
  const parts = def.parts.map((part) => {
    let pts = shift(part.pts)
    if (signedArea(pts) < 0) {
      const rev: number[] = []
      for (let i = pts.length / 2 - 1; i >= 0; i--)
        rev.push(pts[i * 2] as number, pts[i * 2 + 1] as number)
      pts = rev
    }
    return { ...part, pts }
  })
  let radius = 0
  for (const part of parts)
    for (let i = 0; i < part.pts.length; i += 2)
      radius = Math.max(radius, Math.hypot(part.pts[i] as number, part.pts[i + 1] as number))
  const paint = def.paint
  return {
    ...def,
    parts,
    eyes: def.eyes.map(([x, y]) => [x - ox, y - oy] as [number, number]),
    mouth: [def.mouth[0] - ox, def.mouth[1] - oy],
    // Paint is drawn in the def's frame: shift it to the centred one.
    paint: paint
      ? (g, c) => {
          c.translate(-ox, -oy)
          paint(g, c)
          c.translate(ox, oy)
        }
      : undefined,
    radius,
    area,
  }
}

/** Highest point (smallest y) of a toy posed at (x, y, a). */
export function topOf(t: Toy, _x: number, y: number, a: number): number {
  const s = Math.sin(a)
  const c = Math.cos(a)
  let top = Infinity
  for (const part of t.parts)
    for (let i = 0; i < part.pts.length; i += 2) {
      const py = y + (part.pts[i] as number) * s + (part.pts[i + 1] as number) * c
      if (py < top) top = py
    }
  return top
}

/** Lowest point (largest y) of a toy posed at (x, y, a). */
export function bottomOf(t: Toy, _x: number, y: number, a: number): number {
  const s = Math.sin(a)
  const c = Math.cos(a)
  let bot = -Infinity
  for (const part of t.parts)
    for (let i = 0; i < part.pts.length; i += 2) {
      const py = y + (part.pts[i] as number) * s + (part.pts[i + 1] as number) * c
      if (py > bot) bot = py
    }
  return bot
}

/**
 * The top of `t` (posed at x, y, a) within the horizontal band [x0, x1], or
 * Infinity if no part of it reaches into that band. Used for the drop preview.
 */
export function topIn(t: Toy, x: number, y: number, a: number, x0: number, x1: number): number {
  const s = Math.sin(a)
  const c = Math.cos(a)
  let top = Infinity
  for (const part of t.parts) {
    const n = part.pts.length / 2
    for (let i = 0; i < n; i++) {
      // Sample each edge so wide flat tops count, not only their corners.
      const ax = part.pts[i * 2] as number
      const ay = part.pts[i * 2 + 1] as number
      const bx = part.pts[((i + 1) % n) * 2] as number
      const by = part.pts[((i + 1) % n) * 2 + 1] as number
      for (let k = 0; k < 4; k++) {
        const lx = ax + ((bx - ax) * k) / 4
        const ly = ay + ((by - ay) * k) / 4
        const wx = x + lx * c - ly * s
        if (wx < x0 || wx > x1) continue
        const wy = y + lx * s + ly * c
        if (wy < top) top = wy
      }
    }
  }
  return top
}

// ---------- physics ----------

export interface ToyBodyOpts {
  friction?: number
  frictionStatic?: number
  frictionAir?: number
  restitution?: number
}

/**
 * The matter-js compound body of a toy, its centre of mass at (x, y), turned by
 * `a`. Every part is one of the toy's convex polygons, so the hitbox is the
 * silhouette.
 */
export function buildToy(
  Mx: M,
  t: Toy,
  x: number,
  y: number,
  a = 0,
  o: ToyBodyOpts = {},
): MatterNS.Body {
  const parts = t.parts.map((part) => {
    const c = centroid(part.pts)
    const verts: { x: number; y: number }[] = []
    for (let i = 0; i < part.pts.length; i += 2)
      verts.push({ x: part.pts[i] as number, y: part.pts[i + 1] as number })
    return Mx.Body.create({
      position: { x: c.x, y: c.y },
      vertices: verts,
      density: t.density,
      friction: o.friction ?? 1,
      frictionStatic: o.frictionStatic ?? 3,
      restitution: o.restitution ?? 0,
    })
  })
  const body = Mx.Body.create({
    parts,
    friction: o.friction ?? 1,
    frictionStatic: o.frictionStatic ?? 3,
    frictionAir: o.frictionAir ?? 0.015,
    restitution: o.restitution ?? 0,
    label: t.name,
  })
  Mx.Body.setPosition(body, { x, y })
  Mx.Body.setAngle(body, a)
  return body
}

// ---------- drawing ----------

function trace(c: CanvasRenderingContext2D, parts: readonly Part[]): void {
  c.beginPath()
  for (const part of parts) {
    const p = part.pts
    c.moveTo(p[0] as number, p[1] as number)
    for (let i = 2; i < p.length; i += 2) c.lineTo(p[i] as number, p[i + 1] as number)
    c.closePath()
  }
}

export interface ToyLook {
  /** Squash & stretch (1 = rest), applied along the screen's vertical. */
  squash?: number
  mood?: Mood
  /** Eyes shut this frame. */
  blink?: boolean
  /** Where the pupils turn (unit-ish, screen frame). */
  look?: [number, number]
  /** Draw faded (the landing ghost). */
  ghost?: number
}

/**
 * A chunky glossy toy: dark lip under it, a soft outline, each part in its
 * colour, light from the top of the screen, then the face. The drawn outline
 * is exactly the physics outline.
 */
export function drawToy(g: Draw, t: Toy, x: number, y: number, a: number, o: ToyLook = {}): void {
  const c = g.ctx
  const sq = o.squash ?? 1
  c.save()
  if (o.ghost !== undefined) c.globalAlpha *= o.ghost
  // Lip: the silhouette nudged down the screen reads as thickness.
  c.save()
  c.translate(x, y + 8)
  c.scale(2 - sq, sq)
  c.rotate(a)
  trace(c, t.parts)
  c.fillStyle = shade(t.color, -0.5)
  c.fill()
  c.restore()
  c.translate(x, y)
  c.scale(2 - sq, sq)
  c.rotate(a)
  trace(c, t.parts)
  c.lineJoin = 'round'
  c.lineWidth = 10
  c.strokeStyle = alpha('#1a1030', 0.4)
  c.stroke()
  for (const part of t.parts) {
    trace(c, [part])
    c.fillStyle = part.color ?? t.color
    c.fill()
  }
  if (o.ghost === undefined) {
    // Inside the silhouette: the toy's own paint, then light from the top of the screen.
    c.save()
    trace(c, t.parts)
    c.clip()
    t.paint?.(g, c)
    c.rotate(-a)
    const r = t.radius
    const grad = c.createLinearGradient(0, -r, 0, r)
    grad.addColorStop(0, 'rgba(255,255,255,0.28)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.22)')
    c.fillStyle = grad
    c.fillRect(-r, -r, r * 2, r * 2)
    c.restore()
    face(c, t, a, o)
  }
  c.restore()
}

/** Eyes and mouth in the piece's frame; pupils look along the screen. */
function face(c: CanvasRenderingContext2D, t: Toy, a: number, o: ToyLook): void {
  const mood = o.mood ?? 'happy'
  const er = t.eyeR * (mood === 'wow' || mood === 'scared' ? 1.18 : 1)
  // Look direction, turned into the piece's frame.
  const [lx0, ly0] = o.look ?? [0, 0.3]
  const lx = lx0 * Math.cos(-a) - ly0 * Math.sin(-a)
  const ly = lx0 * Math.sin(-a) + ly0 * Math.cos(-a)
  for (const [ex, ey] of t.eyes) {
    if (o.blink && mood !== 'scared' && mood !== 'wow') {
      c.beginPath()
      c.moveTo(ex - er, ey)
      c.quadraticCurveTo(ex, ey + er * 0.6, ex + er, ey)
      c.lineWidth = er * 0.35
      c.lineCap = 'round'
      c.strokeStyle = C.ink
      c.stroke()
      continue
    }
    c.beginPath()
    c.arc(ex, ey, er, 0, Math.PI * 2)
    c.fillStyle = '#ffffff'
    c.fill()
    c.lineWidth = er * 0.18
    c.strokeStyle = alpha(C.ink, 0.5)
    c.stroke()
    const pr = er * (mood === 'scared' ? 0.32 : mood === 'wow' ? 0.5 : 0.55)
    c.beginPath()
    c.arc(ex + lx * er * 0.35, ey + ly * er * 0.35, pr, 0, Math.PI * 2)
    c.fillStyle = C.ink
    c.fill()
    c.beginPath()
    c.arc(
      ex + lx * er * 0.35 - pr * 0.35,
      ey + ly * er * 0.35 - pr * 0.35,
      pr * 0.35,
      0,
      Math.PI * 2,
    )
    c.fillStyle = '#ffffff'
    c.fill()
  }
  const [mx, my] = t.mouth
  const m = t.eyeR
  c.lineCap = 'round'
  c.strokeStyle = C.ink
  c.lineWidth = m * 0.3
  c.beginPath()
  if (mood === 'wow') {
    c.ellipse(mx, my, m * 0.4, m * 0.5, 0, 0, Math.PI * 2)
    c.fillStyle = shade(C.red, -0.3)
    c.fill()
  } else if (mood === 'scared') {
    // A wobbly worried line.
    c.moveTo(mx - m * 0.7, my)
    c.quadraticCurveTo(mx - m * 0.35, my - m * 0.3, mx, my)
    c.quadraticCurveTo(mx + m * 0.35, my + m * 0.3, mx + m * 0.7, my)
    c.stroke()
  } else if (mood === 'sad') {
    c.arc(mx, my + m * 0.5, m * 0.5, Math.PI * 1.15, Math.PI * 1.85)
    c.stroke()
  } else {
    const w = mood === 'grin' ? 0.8 : 0.55
    c.arc(mx, my - m * 0.25, m * w, Math.PI * 0.15, Math.PI * 0.85)
    c.stroke()
  }
}
