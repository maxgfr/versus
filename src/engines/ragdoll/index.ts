/**
 * Ragdoll engine: rigid-body physics with matter-js, loaded lazily (it is the
 * heaviest dependency in the arcade, so only physics games pay for it).
 *
 * How to build a game on it:
 * - Call `loadMatter()` in `setup()` and keep the promise; the countdown hides
 *   the load. Until it resolves, skip physics in `step` (`this.world` is null).
 * - Create a `PhysicsWorld(M)` and add bodies with `makeBody(M, shape, x, y)`
 *   under stable numeric ids. Shapes are plain data (`Shape`) so the same spec
 *   drives physics, rendering (`drawShape`) and tests.
 * - Step it from `update` with `world.step(dt)` (fixed 60 Hz, in sync with the
 *   game), and copy `world.snap(kindOf)` into your state every step: the state
 *   (not matter) is what you render, so the online guest — which never runs
 *   physics — draws exactly what the host sees.
 * - `world.settled()` tells when everything has come to rest (stacking games);
 *   `ragdoll()` builds a floppy jointed figure (wrestling / kicking games).
 * - For bots, `cloneWorld` rebuilds a throwaway world from snapshots so a move
 *   can be simulated ahead without touching the real one.
 */
import type MatterNS from 'matter-js'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, shade } from '../../core/render/palette.ts'

export type M = typeof MatterNS
export type Body = MatterNS.Body

let cached: Promise<M> | null = null

/** matter-js as a lazy chunk, loaded once. */
export function loadMatter(): Promise<M> {
  cached ??= import('matter-js').then(
    (m) => (m as unknown as { default?: M }).default ?? (m as unknown as M),
  )
  return cached
}

export type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'rect'; w: number; h: number; round?: number }
  | { kind: 'poly'; sides: number; r: number }
  | { kind: 'trap'; w: number; h: number; slope: number }

/** Half extents of a shape's bounding box when unrotated. */
export function extent(s: Shape): { hw: number; hh: number } {
  switch (s.kind) {
    case 'circle':
      return { hw: s.r, hh: s.r }
    case 'rect':
    case 'trap':
      return { hw: s.w / 2, hh: s.h / 2 }
    case 'poly':
      return { hw: s.r, hh: s.r }
  }
}

/** Radius of the circle enclosing the shape (rotation-proof extent). */
export function reach(s: Shape): number {
  const e = extent(s)
  return Math.hypot(e.hw, e.hh)
}

export interface BodyOpts {
  isStatic?: boolean
  friction?: number
  frictionStatic?: number
  frictionAir?: number
  restitution?: number
  density?: number
  label?: string
}

export function makeBody(Mx: M, s: Shape, x: number, y: number, angle = 0, o: BodyOpts = {}): Body {
  const opts: MatterNS.IChamferableBodyDefinition = {
    friction: o.friction ?? 0.9,
    frictionStatic: o.frictionStatic ?? 2,
    frictionAir: o.frictionAir ?? 0.015,
    restitution: o.restitution ?? 0,
    density: o.density ?? 0.0012,
    isStatic: o.isStatic ?? false,
    label: o.label ?? 'body',
    angle,
  }
  switch (s.kind) {
    case 'circle':
      return Mx.Bodies.circle(x, y, s.r, opts)
    case 'rect':
      return Mx.Bodies.rectangle(
        x,
        y,
        s.w,
        s.h,
        s.round ? { ...opts, chamfer: { radius: s.round } } : opts,
      )
    case 'poly':
      return Mx.Bodies.polygon(x, y, s.sides, s.r, opts)
    case 'trap':
      return Mx.Bodies.trapezoid(x, y, s.w, s.h, s.slope, opts)
  }
}

/** A body as plain data: what states carry and what renderers draw. */
export interface BodySnap {
  id: number
  /** Game-defined kind (index into the game's piece table). */
  k: number
  x: number
  y: number
  a: number
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r3 = (v: number) => Math.round(v * 1000) / 1000

export class PhysicsWorld {
  readonly engine: MatterNS.Engine
  readonly bodies = new Map<number, Body>()
  readonly kinds = new Map<number, number>()
  private calm = 0

  constructor(
    readonly M: M,
    gravityY = 1,
  ) {
    this.engine = M.Engine.create({ gravity: { x: 0, y: gravityY, scale: 0.0012 } })
    this.engine.positionIterations = 8
    this.engine.velocityIterations = 6
  }

  add(id: number, body: Body, kind = 0): Body {
    this.bodies.set(id, body)
    this.kinds.set(id, kind)
    this.M.Composite.add(this.engine.world, body)
    this.calm = 0
    return body
  }

  /** Static scenery (platforms, walls) that is not snapshotted. */
  addStatic(body: Body): Body {
    this.M.Composite.add(this.engine.world, body)
    return body
  }

  remove(id: number): void {
    const b = this.bodies.get(id)
    if (!b) return
    this.M.Composite.remove(this.engine.world, b)
    this.bodies.delete(id)
    this.kinds.delete(id)
  }

  step(dt: number): void {
    this.M.Engine.update(this.engine, dt * 1000)
    let max = 0
    for (const b of this.bodies.values()) {
      // Bodies sunk far below (fallen into the sea) do not count.
      if (b.position.y > 4000) continue
      max = Math.max(max, b.speed, Math.abs(b.angularSpeed) * 20)
    }
    this.calm = max < 0.3 ? this.calm + 1 : 0
  }

  /** Everything has been (nearly) still for `steps` consecutive steps. */
  settled(steps = 24): boolean {
    return this.calm >= steps
  }

  snap(): BodySnap[] {
    const out: BodySnap[] = []
    for (const [id, b] of this.bodies) {
      out.push({
        id,
        k: this.kinds.get(id) ?? 0,
        x: r1(b.position.x),
        y: r1(b.position.y),
        a: r3(b.angle),
      })
    }
    return out
  }
}

/**
 * Rebuild a world from snapshots (bodies at rest, zero velocity) plus scenery,
 * for simulating ahead. `shapeOf(kind)` maps a snapshot kind to its shape.
 */
export function cloneWorld(
  Mx: M,
  snaps: readonly BodySnap[],
  shapeOf: (k: number) => Shape,
  scenery: (w: PhysicsWorld) => void,
): PhysicsWorld {
  const w = new PhysicsWorld(Mx)
  scenery(w)
  for (const s of snaps) w.add(s.id, makeBody(Mx, shapeOf(s.k), s.x, s.y, s.a), s.k)
  return w
}

/** How far below the box centre a trapezoid's centroid sits. */
export function trapCentroid(s: { w: number; h: number; slope: number }): number {
  const top = s.w * (1 - s.slope)
  const bottom = s.w
  const fromBottom = (s.h * (bottom + 2 * top)) / (3 * (top + bottom))
  return s.h / 2 - fromBottom
}

/** Trace a shape's outline around the origin (for fills / strokes). */
function outline(c: CanvasRenderingContext2D, s: Shape): void {
  switch (s.kind) {
    case 'circle':
      c.arc(0, 0, s.r, 0, Math.PI * 2)
      break
    case 'rect':
      c.roundRect(-s.w / 2, -s.h / 2, s.w, s.h, s.round ?? 0)
      break
    case 'poly':
      for (let i = 0; i < s.sides; i++) {
        // Matter's polygon: first vertex at angle π/sides offset.
        const a = (Math.PI * 2 * i) / s.sides + Math.PI / s.sides
        const x = Math.cos(a) * s.r
        const y = Math.sin(a) * s.r
        if (i === 0) c.moveTo(x, y)
        else c.lineTo(x, y)
      }
      c.closePath()
      break
    case 'trap': {
      // Matter's trapezoid: the top is narrower by `slope` of the width on each
      // side, and the body's position is the centroid, which sits below the
      // box centre.
      const t = (s.w * s.slope) / 2
      const dy = -trapCentroid(s)
      c.moveTo(-s.w / 2 + t, -s.h / 2 + dy)
      c.lineTo(s.w / 2 - t, -s.h / 2 + dy)
      c.lineTo(s.w / 2, s.h / 2 + dy)
      c.lineTo(-s.w / 2, s.h / 2 + dy)
      c.closePath()
      break
    }
  }
}

/**
 * A physics piece drawn as a chunky toy block: lip, face, gloss, and an
 * optional emoji printed on it. The drawing is the hitbox, so what you see is
 * exactly what collides.
 */
export function drawShape(
  g: Draw,
  s: Shape,
  x: number,
  y: number,
  a: number,
  color: string,
  glyph?: string,
  o: { ghost?: boolean } = {},
): void {
  const c = g.ctx
  c.save()
  c.translate(x, y)
  c.rotate(a)
  if (o.ghost) c.globalAlpha *= 0.4
  // Lip: the same outline nudged "down" in the piece's frame reads as thickness.
  c.save()
  c.translate(0, 7)
  c.beginPath()
  outline(c, s)
  c.fillStyle = shade(color, -0.35)
  c.fill()
  c.restore()
  c.beginPath()
  outline(c, s)
  const { hw, hh } = extent(s)
  const grad = c.createLinearGradient(0, -hh, 0, hh)
  grad.addColorStop(0, shade(color, 0.25))
  grad.addColorStop(1, shade(color, -0.08))
  c.fillStyle = grad
  c.fill()
  c.lineWidth = 5
  c.strokeStyle = alpha('#1a1030', 0.35)
  c.stroke()
  c.restore()
  if (glyph) {
    const size = Math.min(hw, hh) * 1.75
    g.alpha(o.ghost ? 0.5 : 1, () => g.emoji(glyph, x, y, size, a))
  }
}

export interface Ragdoll {
  parts: Body[]
  head: Body
  torso: Body
  joints: MatterNS.Constraint[]
}

/**
 * A floppy figure: head, torso, two arms and two legs joined by soft
 * constraints. Parts share a collision group so they never fight each other.
 * Scale 1 ≈ 220 world units tall.
 */
export function ragdoll(Mx: M, x: number, y: number, scale = 1, group = -1): Ragdoll {
  const k = scale
  const filter = { group }
  const opt = { friction: 0.6, restitution: 0.1, density: 0.0016, collisionFilter: filter }
  const head = Mx.Bodies.circle(x, y - 80 * k, 30 * k, { ...opt, label: 'head' })
  const torso = Mx.Bodies.rectangle(x, y, 46 * k, 90 * k, {
    ...opt,
    chamfer: { radius: 18 * k },
    label: 'torso',
  })
  const limb = (dx: number, dy: number, w: number, h: number, label: string) =>
    Mx.Bodies.rectangle(x + dx * k, y + dy * k, w * k, h * k, {
      ...opt,
      chamfer: { radius: (w * k) / 2 },
      label,
    })
  const armL = limb(-38, -10, 18, 60, 'arm')
  const armR = limb(38, -10, 18, 60, 'arm')
  const legL = limb(-14, 80, 20, 70, 'leg')
  const legR = limb(14, 80, 20, 70, 'leg')
  const pin = (a: Body, ax: number, ay: number, b: Body, bx: number, by: number) =>
    Mx.Constraint.create({
      bodyA: a,
      pointA: { x: ax * k, y: ay * k },
      bodyB: b,
      pointB: { x: bx * k, y: by * k },
      stiffness: 0.9,
      length: 0,
    })
  const joints = [
    pin(torso, 0, -45, head, 0, 28),
    pin(torso, -22, -36, armL, 0, -26),
    pin(torso, 22, -36, armR, 0, -26),
    pin(torso, -12, 42, legL, 0, -30),
    pin(torso, 12, 42, legR, 0, -30),
  ]
  return { parts: [head, torso, armL, armR, legL, legR], head, torso, joints }
}
