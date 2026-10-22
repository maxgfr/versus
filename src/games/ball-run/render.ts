import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { hash01, LANE_W } from '../../engines/runner/index.ts'
import { type Arc, type Ball, BALL_R, metres, ROW, rowAt, wrap } from './rules.ts'
import { card, chip, scorePill } from './ui.ts'

type View = { x0: number; y0: number; x1: number; y1: number }

export interface LaneView {
  ball: Ball
  /** Interpolated distance and angle for this frame. */
  dist: number
  phi: number
  seed: number
  time: number
  phase: 'ready' | 'run'
  since: number
  readyLeft: number
  name: string
  bot: boolean
  /** Game time the ball fell, or -1. */
  outT: number
  /** Seconds left in the match. */
  left: number
  /** Match result once decided. */
  winner: Side | 'draw' | null
  /** Game time the match was decided, or -1. */
  endAt: number
  /** Why it ended: a fall or the clock. */
  endWhy: 'fall' | 'time' | null
  rivalDist: number
}

/** The far end of the tunnel: where every ring converges. */
export const VP = { x: 500, y: 330 }
/** Radius of the tunnel at the ball's depth. */
const NEAR_R = 430
/** Perspective: rings shrink like 1/(Z0 + z). */
const Z0 = 420
/** Rows drawn ahead of the ball. */
const VIS = 8
/** Tiles around the tunnel. */
const SECTORS = 16
const SEC = (Math.PI * 2) / SECTORS
/** Half-depth of a row's band. */
const HALF = ROW / 2
/** Barrier height, as a share of the radius. */
const BAR_H = 0.24

export function ringR(z: number): number {
  return (NEAR_R * Z0) / (Z0 + Math.max(-Z0 * 0.75, z))
}

/** Screen point at radius r, at tunnel angle a seen from a camera rolled to `cam`. */
function pt(r: number, a: number, cam: number): { x: number; y: number } {
  const t = a - cam
  return { x: VP.x + r * Math.sin(t), y: VP.y + r * Math.cos(t) }
}

/** Lane-local position of the ball: the camera rolls with it, so it always sits on the floor. */
export function ballPos(): { x: number; y: number } {
  return { x: VP.x, y: VP.y + NEAR_R - BALL_R }
}

function arcTo(
  c: CanvasRenderingContext2D,
  r: number,
  a: number,
  b: number,
  cam: number,
  first: boolean,
): void {
  const steps = Math.max(2, Math.ceil(Math.abs(b - a) / 0.07))
  for (let k = 0; k <= steps; k++) {
    const p = pt(r, a + ((b - a) * k) / steps, cam)
    if (first && k === 0) c.moveTo(p.x, p.y)
    else c.lineTo(p.x, p.y)
  }
}

/** Annulus piece between radii r0 (near, larger) and r1 (far), angles a..b. */
function piece(
  g: Draw,
  r0: number,
  r1: number,
  a: number,
  b: number,
  cam: number,
  fill: string | CanvasGradient,
): void {
  g.path((c) => {
    arcTo(c, r0, a, b, cam, true)
    arcTo(c, r1, b, a, cam, false)
    c.closePath()
  }, fill)
}

/** Subtract the holes from [a, b]: the solid pieces left. */
function solid(a: number, b: number, holes: Arc[]): [number, number][] {
  let parts: [number, number][] = [[a, b]]
  const mid = (a + b) / 2
  for (const h of holes) {
    const c = mid + wrap(h.c - mid)
    const h0 = c - h.w / 2
    const h1 = c + h.w / 2
    const next: [number, number][] = []
    for (const [p0, p1] of parts) {
      if (h1 <= p0 || h0 >= p1) next.push([p0, p1])
      else {
        if (h0 > p0) next.push([p0, h0])
        if (h1 < p1) next.push([h1, p1])
      }
    }
    parts = next
  }
  return parts
}

interface Band {
  i: number
  z: number
  rNear: number
  rFar: number
  rMid: number
  /** 1 at the ball, 0 at the far end. */
  near: number
  holes: Arc[]
  bars: Arc[]
}

function band(seed: number, i: number, dist: number): Band {
  const z = i * ROW - dist
  const row = rowAt(seed, i)
  return {
    i,
    z,
    rNear: ringR(z - HALF),
    rFar: ringR(z + HALF),
    rMid: ringR(z),
    near: 1 - Math.min(1, Math.max(0, z) / (VIS * ROW)),
    holes: row.holes,
    bars: row.bars,
  }
}

/** The void under a hole: a deep dark well with a hot rim, so it reads from far away. */
function holes(g: Draw, b: Band, cam: number, time: number): void {
  for (const h of b.holes) {
    const a = h.c - h.w / 2
    const e = h.c + h.w / 2
    piece(g, b.rNear, b.rFar, a, e, cam, '#06040c')
    const glow = 0.35 + 0.65 * b.near
    const pulse = 0.75 + 0.25 * Math.sin(time * 10 + b.i)
    const c = g.ctx
    c.save()
    c.lineCap = 'round'
    c.lineJoin = 'round'
    // Hot rim on all four edges of the hole.
    c.beginPath()
    arcTo(c, b.rNear, a, e, cam, true)
    arcTo(c, b.rFar, e, a, cam, false)
    c.closePath()
    c.strokeStyle = alpha(C.orange, 0.35 * glow * pulse)
    c.lineWidth = 6 + 26 * (b.rMid / NEAR_R)
    c.stroke()
    c.strokeStyle = alpha('#ffe2b0', 0.85 * glow)
    c.lineWidth = 2 + 6 * (b.rMid / NEAR_R)
    c.stroke()
    c.restore()
  }
}

/** The tiles of one band, alternating shades, fogged with depth, with a neon seam at the near edge. */
function tiles(g: Draw, side: Side, b: Band, cam: number): void {
  const col = SIDE[side]
  const fog = 1 - b.near
  const light = mix(shade(col.main, -0.32), C.ink, 0.22 + fog * 0.7)
  const dark = mix(shade(col.main, -0.5), C.ink, 0.3 + fog * 0.65)
  for (let k = 0; k < SECTORS; k++) {
    const a = -Math.PI + k * SEC
    const fill = (k + b.i) % 2 ? light : dark
    for (const [p0, p1] of solid(a, a + SEC, b.holes)) piece(g, b.rNear, b.rFar, p0, p1, cam, fill)
  }
  // Neon seam along the near edge of the band, broken by the holes.
  const c = g.ctx
  const s = b.rNear / NEAR_R
  c.save()
  c.lineCap = 'round'
  for (const [p0, p1] of solid(-Math.PI, Math.PI, b.holes)) {
    c.beginPath()
    arcTo(c, b.rNear, p0, p1, cam, true)
    c.strokeStyle = alpha(col.main, 0.3 * b.near + 0.06)
    c.lineWidth = 4 + 18 * Math.min(1.4, s)
    c.stroke()
    c.beginPath()
    arcTo(c, b.rNear, p0, p1, cam, true)
    c.strokeStyle = alpha(col.light, 0.25 + 0.7 * b.near)
    c.lineWidth = 2 + 5 * Math.min(1.4, s)
    c.stroke()
  }
  c.restore()
}

/** Barriers stand up from the floor at the band's middle: a glossy pink block facing the ball. */
function bars(g: Draw, b: Band, cam: number): void {
  for (const bar of b.bars) {
    const a = bar.c - bar.w / 2
    const e = bar.c + bar.w / 2
    const r0 = b.rMid
    const r1 = r0 * (1 - BAR_H)
    const rTop = ringR(b.z + 60) * (1 - BAR_H)
    const fog = 1 - b.near
    // Top face first, then the front face over it.
    piece(g, r1, rTop, a, e, cam, mix('#ffd0ea', C.ink, fog * 0.7))
    const p = pt((r0 + r1) / 2, bar.c, cam)
    const q = pt(r1, bar.c, cam)
    piece(
      g,
      r0,
      r1,
      a,
      e,
      cam,
      g.lin(p.x, p.y, q.x, q.y, [
        [0, mix(shade(C.pink, -0.25), C.ink, fog * 0.75)],
        [1, mix(C.pink, C.ink, fog * 0.6)],
      ]),
    )
    const c = g.ctx
    c.save()
    c.lineCap = 'round'
    c.beginPath()
    arcTo(c, r1, a + 0.03, e - 0.03, cam, true)
    c.strokeStyle = alpha(C.white, 0.35 + 0.55 * b.near)
    c.lineWidth = 2 + 6 * (r0 / NEAR_R)
    c.stroke()
    c.restore()
  }
}

function backdrop(g: Draw, side: Side, v: View, time: number): void {
  g.rect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0, '#07050d')
  // Light at the end of the tunnel.
  const far = ringR(VIS * ROW + HALF)
  g.circle(
    VP.x,
    VP.y,
    far * 1.6,
    g.rad(VP.x, VP.y, 0, far * 1.6, [
      [0, alpha(C.white, 0.9)],
      [0.35, alpha(SIDE[side].light, 0.7)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
  g.circle(VP.x, VP.y, far * 0.45 * (1 + 0.08 * Math.sin(time * 6)), alpha(C.white, 0.9))
}

/** Streaks flying past near the walls: they speed up with the ball. */
function streaks(g: Draw, side: Side, b: Ball, dist: number, cam: number): void {
  const n = 10
  for (let k = 0; k < n; k++) {
    const a = hash01(7, k, 1) * Math.PI * 2
    const span = 1400
    const z = span - ((dist * 1.15 + hash01(7, k, 2) * span) % span)
    // Keep the streaks off the ball's own floor.
    if (z < 160 || Math.abs(wrap(a - cam)) < 0.5) continue
    const r0 = ringR(z) * 0.94
    const r1 = ringR(z + 90 + b.v * 0.12) * 0.94
    const p0 = pt(r0, a, cam)
    const p1 = pt(r1, a, cam)
    const k01 = Math.min(1, (b.v - 450) / 600)
    g.line(p0.x, p0.y, p1.x, p1.y, alpha(SIDE[side].light, 0.15 + 0.4 * Math.max(0, k01)), 4)
  }
}

function ballAt(g: Draw, side: Side, b: Ball, o: LaneView): void {
  const col = SIDE[side].main
  const home = ballPos()
  let x = home.x
  let y = home.y
  let r = BALL_R
  let k = 1
  let sx = 1
  let sy = 1
  if (b.out) {
    // It drops through the hole, out of the tunnel.
    const t = prog(o.time - o.outT, 0, 0.9)
    y += 30 * t + 260 * t * t
    r = BALL_R * (1 - 0.55 * t)
    k = 1 - prog(t, 0.5, 1)
  } else {
    // Squash on a barrier hit.
    const h = b.barAt >= 0 ? o.time - b.barAt : 9
    if (h < 0.35) {
      const q = Math.sin((h / 0.35) * Math.PI) * (1 - h / 0.35)
      sx = 1 + 0.35 * q
      sy = 1 - 0.3 * q
    }
    // Leaning into a hard turn: the ball slides off-centre and stretches with it.
    const turn = Math.max(-1, Math.min(1, wrap(b.phiT - b.phi) / 0.8))
    x += turn * 26
    sx *= 1 + Math.abs(turn) * 0.08
    sy *= 1 - Math.abs(turn) * 0.05
    g.shadow(x, home.y + BALL_R - 2, r * 0.85, 10, 0.5)
  }
  if (k <= 0.01) return
  g.alpha(k, () => {
    if (!b.out)
      g.circle(
        x,
        y,
        r * 2.3,
        g.rad(x, y, r * 0.8, r * 2.3, [
          [0, alpha(col, 0.5)],
          [1, alpha(col, 0)],
        ]),
      )
    g.at(
      x,
      y + r * (1 - sy),
      0,
      () => {
        g.ball(0, 0, r, col, 1)
        // Bands roll up the face as the ball rolls away, and slide sideways as it turns.
        g.ctx.save()
        g.ctx.beginPath()
        g.ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2)
        g.ctx.clip()
        const roll = (o.dist / (BALL_R * 2.2)) % 1
        for (let j = 0; j < 2; j++) {
          const p = (roll + j * 0.5) % 1
          const yy = r - p * r * 2
          const w = Math.sqrt(Math.max(0, r * r - yy * yy))
          g.ellipse(wrap(b.phi) * 6, yy, w * 1.02, r * 0.13, alpha(C.white, 0.22))
        }
        g.ctx.restore()
        g.alpha(0.75, () => g.ellipse(-r * 0.32, -r * 0.42, r * 0.3, r * 0.18, '#fff', -0.6))
      },
      sx,
      sy,
    )
  })
  if (b.barAt >= 0 && o.time - b.barAt < 0.45 && !b.out) {
    const t = (o.time - b.barAt) / 0.45
    g.ring(x, y, r + 20 + t * 90, alpha(C.pink, 1 - t), 10 * (1 - t) + 2)
  }
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const b = o.ball
  const cam = o.phi
  backdrop(g, side, v, o.time)
  // Far to near, so near bands overlap far ones.
  const bands: Band[] = []
  for (let i = b.next + VIS; i >= Math.max(0, b.next - 2); i--) bands.push(band(o.seed, i, o.dist))
  for (const bd of bands) {
    if (bd.rNear < 4) continue
    const last = bd.i === b.next - 1
    holes(g, bd, cam, o.time)
    // A falling ball goes behind the floor around its hole.
    if (last && b.out) ballAt(g, side, b, o)
    tiles(g, side, bd, cam)
    bars(g, bd, cam)
  }
  if (b.next - 1 < 0 || !b.out) {
    streaks(g, side, b, o.dist, cam)
    ballAt(g, side, b, o)
  }
  hud(g, side, o)
}

function hud(g: Draw, side: Side, o: LaneView): void {
  const b = o.ball
  const m = metres(b.dist)
  // Pop on every 100 m.
  const pop = 1 - prog((b.dist % 1000) / Math.max(1, b.v), 0, 0.25)
  scorePill(g, side, String(m), 'm', 430, 74, b.dist > 900 ? Math.max(0, pop) : 0)
  const secs = Math.max(0, Math.ceil(o.left))
  const urgent = secs <= 10 && o.phase === 'run'
  chip(g, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 780, 74, {
    color: urgent ? C.yellow : C.white,
    size: 44,
  })

  // Online, each phone only coaches its own player: the rival's lane just says Ready.
  const coach = !o.bot && (g.viewer === null || g.viewer === side)
  if (o.phase === 'ready') {
    // The shell has just counted 3-2-1: a short beat to read the one rule.
    card(
      g,
      side,
      coach ? 'Drag to steer' : 'Ready…',
      coach ? 'Dodge the holes!' : o.name,
      330,
      o.since,
    )
  }
  if (coach && (o.phase === 'ready' || o.since < 1.6) && o.winner === null) {
    const sw = Math.sin(o.time * 4)
    g.alpha(o.phase === 'ready' ? 1 : 1 - prog(o.since, 1, 1.6), () =>
      g.emoji('👆', 500 + sw * 170, 826, 84, sw * 0.25),
    )
  }
  if (o.phase === 'ready') return
  if (o.winner !== null && o.endAt >= 0) {
    const t = o.time - o.endAt
    const won = o.winner === side
    const draw = o.winner === 'draw'
    const gap = Math.abs(metres(b.dist) - metres(o.rivalDist))
    const title = draw
      ? 'Draw!'
      : won
        ? o.endWhy === 'fall'
          ? 'Still rolling!'
          : 'Furthest!'
        : 'Out!'
    const sub = draw
      ? `${m} m each`
      : won
        ? o.endWhy === 'fall'
          ? 'Last ball rolling'
          : `${gap} m ahead`
        : o.endWhy === 'fall'
          ? `${m} m`
          : `${gap} m short`
    card(g, side, title, sub, 330, t - (won ? 0.15 : 0), {
      color: won ? C.yellow : C.white,
      accent: won ? C.yellow : SIDE[side].main,
    })
    if (won) {
      const s = outBack(prog(t, 0.3, 0.7))
      g.emoji('🏆', LANE_W / 2, 175, 96 * s)
    }
    return
  }
}
