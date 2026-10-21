/**
 * Puck engine: circles sliding on a table. Fast discs, kinematic paddles that
 * follow fingers, a rounded rink with goal mouths, and the bookkeeping every
 * ball game needs (goals, serves, first-to-N).
 *
 * How to build a game on it (copy src/games/air-hockey):
 *  1. rules.ts — a plain-object `World` (discs as {x,y,vx,vy,r}) and a pure
 *     `step(world, dt, targets)` that runs a few substeps of: `driveTo` each
 *     paddle toward its target, `integrate` the ball, `collideWalls`,
 *     `collideKinematic` against every paddle, then `scoredBy`. Return events
 *     ({kind:'hit'|'wall'|'goal', speed, x, y}) instead of playing sounds, so
 *     the rules stay testable and the online guest gets them via fx replay.
 *  2. bot.ts — returns a target point per paddle; use `predictX` to intercept.
 *  3. index.ts — extends BaseGame; each step reads `fingerTarget(input, side,
 *     lane)` for humans or the bot target, calls rules.step, turns events into
 *     juice (fx.sparks / shake / stop / audio 'hit' pitched by speed).
 *  4. render.ts — `drawRink` + `drawPaddle` + `drawPuck` + `rinkScore`.
 * All units are world units (stage 1000 × 1800), red defends the bottom goal.
 */
import type { Side } from '../../core/game.ts'
import type { PlayerInput } from '../../core/input.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'

export interface Disc {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

export interface Rink {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Corner radius. */
  corner: number
  /** Goal mouth width, centred on x = W/2 in the top and bottom walls (0 = no goals). */
  goal: number
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Contact {
  kind: 'wall' | 'post' | 'hit'
  speed: number
  x: number
  y: number
}

export const rink = (o: Partial<Rink> = {}): Rink => ({
  x0: 50,
  y0: 60,
  x1: 950,
  y1: 1740,
  corner: 140,
  goal: 320,
  ...o,
})

export const disc = (x: number, y: number, r: number): Disc => ({ x, y, vx: 0, vy: 0, r })

export const speedOf = (d: Disc): number => Math.hypot(d.vx, d.vy)

/** Move by velocity and apply table friction (exponential, frame-rate independent). */
export function integrate(d: Disc, dt: number, drag = 0.35): void {
  d.x += d.vx * dt
  d.y += d.vy * dt
  const k = Math.exp(-drag * dt)
  d.vx *= k
  d.vy *= k
}

export function capSpeed(d: Disc, max: number): void {
  const s = speedOf(d)
  if (s > max) {
    d.vx *= max / s
    d.vy *= max / s
  }
}

const inMouth = (x: number, rk: Rink, r = 0) => rk.goal > 0 && Math.abs(x - W / 2) < rk.goal / 2 - r

/** Bounce off the rink (rounded corners, open goal mouths, posts). Returns the hardest contact. */
export function collideWalls(d: Disc, rk: Rink, e = 0.88): Contact | null {
  let hit: Contact | null = null
  const note = (kind: Contact['kind'], speed: number) => {
    if (!hit || speed > hit.speed) hit = { kind, speed, x: d.x, y: d.y }
  }
  // Inside a goal pocket: side walls of the pocket only.
  const pocket = (d.y < rk.y0 || d.y > rk.y1) && inMouth(d.x, rk)
  if (pocket) {
    const l = W / 2 - rk.goal / 2 + d.r
    const r = W / 2 + rk.goal / 2 - d.r
    if (d.x < l) {
      d.x = l
      note('post', Math.abs(d.vx))
      d.vx = Math.abs(d.vx) * e
    } else if (d.x > r) {
      d.x = r
      note('post', Math.abs(d.vx))
      d.vx = -Math.abs(d.vx) * e
    }
    return hit
  }
  if (d.x - d.r < rk.x0) {
    d.x = rk.x0 + d.r
    note('wall', Math.abs(d.vx))
    d.vx = Math.abs(d.vx) * e
  } else if (d.x + d.r > rk.x1) {
    d.x = rk.x1 - d.r
    note('wall', Math.abs(d.vx))
    d.vx = -Math.abs(d.vx) * e
  }
  if (d.y - d.r < rk.y0 && !inMouth(d.x, rk)) {
    d.y = rk.y0 + d.r
    note('wall', Math.abs(d.vy))
    d.vy = Math.abs(d.vy) * e
  } else if (d.y + d.r > rk.y1 && !inMouth(d.x, rk)) {
    d.y = rk.y1 - d.r
    note('wall', Math.abs(d.vy))
    d.vy = -Math.abs(d.vy) * e
  }
  // Rounded corners: keep the disc inside a quarter circle.
  const R = rk.corner
  for (const [cx, cy, sx, sy] of [
    [rk.x0 + R, rk.y0 + R, -1, -1],
    [rk.x1 - R, rk.y0 + R, 1, -1],
    [rk.x0 + R, rk.y1 - R, -1, 1],
    [rk.x1 - R, rk.y1 - R, 1, 1],
  ] as const) {
    if ((d.x - cx) * sx <= 0 || (d.y - cy) * sy <= 0) continue
    const dx = d.x - cx
    const dy = d.y - cy
    const dist = Math.hypot(dx, dy)
    if (dist > R - d.r) {
      const nx = dx / dist
      const ny = dy / dist
      d.x = cx + nx * (R - d.r)
      d.y = cy + ny * (R - d.r)
      const vn = d.vx * nx + d.vy * ny
      if (vn > 0) {
        note('wall', vn)
        d.vx -= (1 + e) * vn * nx
        d.vy -= (1 + e) * vn * ny
      }
    }
  }
  // Goal posts: the mouth's two corners act as tiny round posts.
  if (rk.goal > 0) {
    for (const py of [rk.y0, rk.y1]) {
      for (const px of [W / 2 - rk.goal / 2, W / 2 + rk.goal / 2]) {
        const dx = d.x - px
        const dy = d.y - py
        const dist = Math.hypot(dx, dy)
        if (dist < d.r && dist > 0) {
          const nx = dx / dist
          const ny = dy / dist
          d.x = px + nx * d.r
          d.y = py + ny * d.r
          const vn = d.vx * nx + d.vy * ny
          if (vn < 0) {
            note('post', -vn)
            d.vx -= (1 + e) * vn * nx
            d.vy -= (1 + e) * vn * ny
          }
        }
      }
    }
  }
  return hit
}

/**
 * Disc against a kinematic body (paddle, mallet, bumper) that moved with
 * velocity (body.vx, body.vy): the body is unstoppable, the disc rebounds with
 * the body's velocity added. Returns the contact with the closing speed.
 */
export function collideKinematic(d: Disc, body: Disc, e = 0.92): Contact | null {
  const dx = d.x - body.x
  const dy = d.y - body.y
  const min = d.r + body.r
  const dist2 = dx * dx + dy * dy
  if (dist2 >= min * min) return null
  const dist = Math.sqrt(dist2) || 0.0001
  const nx = dx / dist
  const ny = dy / dist
  d.x = body.x + nx * min
  d.y = body.y + ny * min
  const rvx = d.vx - body.vx
  const rvy = d.vy - body.vy
  const vn = rvx * nx + rvy * ny
  if (vn >= 0) return null
  d.vx -= (1 + e) * vn * nx
  d.vy -= (1 + e) * vn * ny
  return { kind: 'hit', speed: -vn, x: body.x + nx * body.r, y: body.y + ny * body.r }
}

/** Two free discs with masses (billiard-style). */
export function collideDynamic(a: Disc, b: Disc, ma = 1, mb = 1, e = 0.95): Contact | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const min = a.r + b.r
  const dist2 = dx * dx + dy * dy
  if (dist2 >= min * min) return null
  const dist = Math.sqrt(dist2) || 0.0001
  const nx = dx / dist
  const ny = dy / dist
  const overlap = min - dist
  const ta = mb / (ma + mb)
  a.x -= nx * overlap * ta
  a.y -= ny * overlap * ta
  b.x += nx * overlap * (1 - ta)
  b.y += ny * overlap * (1 - ta)
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
  if (vn >= 0) return null
  const j = (-(1 + e) * vn) / (1 / ma + 1 / mb)
  a.vx -= (j / ma) * nx
  a.vy -= (j / ma) * ny
  b.vx += (j / mb) * nx
  b.vy += (j / mb) * ny
  return { kind: 'hit', speed: -vn, x: a.x + nx * a.r, y: a.y + ny * a.r }
}

/** Which side scored, once the disc is fully past a goal line. Red attacks the top goal. */
export function scoredBy(d: Disc, rk: Rink): Side | null {
  if (!inMouth(d.x, rk, -d.r)) return null
  if (d.y < rk.y0 - d.r * 1.1) return 0
  if (d.y > rk.y1 + d.r * 1.1) return 1
  return null
}

/** The area a side's paddle may move in: its own half, optionally one lane of it (2 vs 2). */
export function halfBox(side: Side, rk: Rink, r: number, lane?: 0 | 1): Box {
  const x0 = lane === 1 ? W / 2 : rk.x0 + r
  const x1 = lane === 0 ? W / 2 : rk.x1 - r
  return side === 0
    ? { x0, x1, y0: MID + r, y1: rk.y1 - r }
    : { x0, x1, y0: rk.y0 + r, y1: MID - r }
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/**
 * Move a kinematic paddle toward (tx, ty) at up to `maxSpeed`, inside `box`,
 * and set its velocity to what it actually moved (so hits carry the flick).
 */
export function driveTo(
  p: Disc,
  tx: number,
  ty: number,
  maxSpeed: number,
  dt: number,
  box: Box,
): void {
  const gx = clamp(tx, box.x0, box.x1)
  const gy = clamp(ty, box.y0, box.y1)
  let dx = gx - p.x
  let dy = gy - p.y
  const d = Math.hypot(dx, dy)
  const step = maxSpeed * dt
  if (d > step) {
    dx *= step / d
    dy *= step / d
  }
  p.x += dx
  p.y += dy
  p.vx = dx / dt
  p.vy = dy / dt
}

/** Where a side's finger wants its paddle (null when no finger is down). */
export function fingerTarget(input: PlayerInput, lane?: 0 | 1): { x: number; y: number } | null {
  const p = input.first(lane)
  return p ? { x: p.x, y: p.y } : null
}

/**
 * Predict the disc's x when it reaches the horizontal line y, bouncing off the
 * side walls (no friction). Null if it is moving away or too slow.
 */
export function predictX(d: Disc, y: number, rk: Rink, maxT = 3): number | null {
  if (Math.abs(d.vy) < 1) return null
  const t = (y - d.y) / d.vy
  if (t < 0 || t > maxT) return null
  const lo = rk.x0 + d.r
  const hi = rk.x1 - d.r
  const span = hi - lo
  let x = d.x + d.vx * t - lo
  // Fold the straight-line x into the [lo, hi] corridor (mirror bounces).
  x = ((x % (2 * span)) + 2 * span) % (2 * span)
  if (x > span) x = 2 * span - x
  return lo + x
}

// ---------- drawing ----------

/** Air-hole dots are cosmetic; a fixed pattern keeps them cheap. */
export function drawRink(
  g: Draw,
  rk: Rink,
  o: { surface?: string; rim?: string; markings?: boolean; holes?: boolean } = {},
): void {
  const surface = o.surface ?? '#18204a'
  const rim = o.rim ?? C.ink4
  const w = rk.x1 - rk.x0
  const h = rk.y1 - rk.y0
  // Floodlit table bed
  g.fillView(
    g.lin(0, 0, 0, 1800, [
      [0, shade(C.blue, -0.82)],
      [0.5, C.ink],
      [1, shade(C.red, -0.82)],
    ]),
  )
  const pad = 26
  g.shadow(W / 2, rk.y1 + pad + 20, w * 0.55, 40, 0.45)
  g.rrect(
    rk.x0 - pad,
    rk.y0 - pad + 12,
    w + pad * 2,
    h + pad * 2,
    rk.corner + pad,
    shade(rim, -0.45),
  )
  g.rrect(rk.x0 - pad, rk.y0 - pad, w + pad * 2, h + pad * 2, rk.corner + pad, rim)
  // Rim highlight along the straight top edge only.
  g.rrect(rk.x0 + rk.corner, rk.y0 - pad + 4, w - rk.corner * 2, 10, 5, alpha('#ffffff', 0.14))
  // Surface: cool sheen in the middle, team tint toward each end.
  g.rrect(
    rk.x0,
    rk.y0,
    w,
    h,
    rk.corner,
    g.lin(0, rk.y0, 0, rk.y1, [
      [0, shade(surface, 0.04)],
      [0.5, shade(surface, 0.14)],
      [1, shade(surface, 0.04)],
    ]),
  )
  g.clip(rk.x0, rk.y0, w, h, rk.corner, () => {
    // Each end glows in its defender's colour, fading toward the centre line.
    g.rect(
      rk.x0,
      rk.y0,
      w,
      h,
      g.lin(0, rk.y0, 0, rk.y1, [
        [0, alpha(SIDE[1].main, 0.32)],
        [0.36, alpha(SIDE[1].main, 0)],
        [0.64, alpha(SIDE[0].main, 0)],
        [1, alpha(SIDE[0].main, 0.32)],
      ]),
    )
    if (o.holes ?? true) {
      const c = g.ctx
      c.fillStyle = alpha('#000000', 0.22)
      c.beginPath()
      for (let y = rk.y0 + 40; y < rk.y1; y += 60) {
        for (let x = rk.x0 + 40 + ((y / 60) % 2) * 30; x < rk.x1; x += 60) {
          c.moveTo(x + 3, y)
          c.arc(x, y, 3, 0, Math.PI * 2)
        }
      }
      c.fill()
    }
    // Light pool
    g.fillView(
      g.rad(W / 2, MID, 50, h * 0.6, [
        [0, alpha('#ffffff', 0.08)],
        [1, alpha('#ffffff', 0)],
      ]),
    )
  })
  if (o.markings ?? true) {
    const line = alpha('#ffffff', 0.32)
    g.line(rk.x0, MID, rk.x1, MID, line, 8)
    g.ring(W / 2, MID, 130, line, 8)
    g.circle(W / 2, MID, 14, line)
    if (rk.goal > 0) {
      g.arc(W / 2, rk.y0, rk.goal * 0.62, 0, Math.PI, alpha(SIDE[1].main, 0.75), 8)
      g.arc(W / 2, rk.y1, rk.goal * 0.62, Math.PI, Math.PI * 2, alpha(SIDE[0].main, 0.75), 8)
    }
  }
  // Goal mouths: dark slots with the defending team's glow.
  if (rk.goal > 0) {
    for (const side of [0, 1] as Side[]) {
      const y = side === 1 ? rk.y0 - pad : rk.y1
      g.rrect(W / 2 - rk.goal / 2, y, rk.goal, pad, 8, C.ink)
      g.rrect(W / 2 - rk.goal / 2, side === 1 ? y : y + pad - 8, rk.goal, 8, 4, SIDE[side].main)
      for (const px of [W / 2 - rk.goal / 2, W / 2 + rk.goal / 2]) {
        g.circle(px, side === 1 ? rk.y0 : rk.y1, 13, shade(rim, 0.35))
      }
    }
  }
}

/** A mallet: lipped disc in the team colour with a raised knob. `squash` 1 = rest. */
export function drawPaddle(g: Draw, p: Disc, side: Side, squash = 1, color?: string): void {
  const col = color ?? SIDE[side].main
  g.shadow(p.x + 6, p.y + 14, p.r * 1.02, p.r * 0.9, 0.35)
  g.at(
    p.x,
    p.y,
    0,
    () => {
      g.circle(0, p.r * 0.14, p.r, shade(col, -0.45))
      g.circle(
        0,
        0,
        p.r,
        g.rad(
          0,
          0,
          p.r * 0.1,
          p.r,
          [
            [0, shade(col, 0.25)],
            [1, col],
          ],
          -p.r * 0.3,
          -p.r * 0.35,
        ),
      )
      g.ring(0, 0, p.r * 0.72, alpha('#000000', 0.16), p.r * 0.1)
      g.ball(0, -p.r * 0.06, p.r * 0.42, shade(col, 0.1), 0.8)
      g.sideMark(side, 0, -p.r * 0.06, p.r * 0.12, alpha('#ffffff', 0.85))
    },
    squash,
    2 - squash,
  )
}

/** The puck with a short speed trail. `trail` holds recent positions, newest last. */
export function drawPuck(
  g: Draw,
  d: Disc,
  trail: readonly { x: number; y: number }[] = [],
  color: string = C.yellow,
): void {
  for (let i = 0; i < trail.length; i++) {
    const t = trail[i]
    if (!t) continue
    const k = (i + 1) / (trail.length + 1)
    g.alpha(k * 0.3, () => g.circle(t.x, t.y, d.r * (0.5 + 0.5 * k), color))
  }
  g.shadow(d.x + 5, d.y + 10, d.r * 0.95, d.r * 0.8, 0.4)
  g.circle(d.x, d.y + d.r * 0.16, d.r, shade(C.ink, 0.1))
  g.circle(d.x, d.y, d.r, C.ink2)
  g.ring(d.x, d.y, d.r * 0.78, color, d.r * 0.22)
  g.alpha(0.5, () =>
    g.ellipse(d.x - d.r * 0.3, d.y - d.r * 0.4, d.r * 0.3, d.r * 0.15, '#fff', -0.5),
  )
}

/** Score figure printed on the table near the midline, on each player's right, upright for them. */
export function rinkScore(g: Draw, side: Side, value: number, rk: Rink, pulse = 0): void {
  const x = side === 0 ? rk.x1 - 120 : rk.x0 + 120
  const y = side === 0 ? MID + 120 : MID - 120
  g.forSide(side, x, y, () =>
    g.text(value, 0, 0, {
      size: 120 * (1 + pulse * 0.35),
      weight: 700,
      color: alpha(SIDE[side].main, 0.55 + pulse * 0.45),
    }),
  )
}
