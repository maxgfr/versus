import { outBack, outCubic } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  type Ball,
  BALL_R,
  BUMP_R,
  COURSE,
  CUP_R,
  type Geo,
  type Mill,
  MILL_T,
  type Pt,
  type Seg,
  type Slope,
  type Table,
  WALL_T,
} from './rules.ts'

/** The putt the player is lining up (cosmetic, never synced). */
export interface Aim {
  dx: number
  dy: number
  power: number
}

export interface Look {
  table: Table
  card: [number[], number[]]
  hole: number
  holes: number
  holeAt: number
  time: number
  turn: Side
  /** A ball is waiting to be putted (the live one gets the yellow ring). */
  live: boolean
  aiming: Aim | null
  /** Game time each bumper was last struck. */
  bumpAt: number[]
  /** Recent positions of each ball, newest last (cosmetic). */
  trails: [Pt[], Pt[]]
}

const GRASS = C.grass
const RIM = 40

export function backdrop(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.8)],
      [0.5, C.ink],
      [1, shade(SIDE[0].main, -0.8)],
    ]),
  )
  g.fillView(
    g.rad(W / 2, MID, 120, 1100, [
      [0, alpha('#fff4d8', 0.1)],
      [0.6, alpha('#000000', 0)],
      [1, alpha('#000000', 0.45)],
    ]),
  )
}

function drawCourse(g: Draw, geo: Geo, time: number): void {
  const { x0, y0, x1, y1 } = COURSE
  const w = x1 - x0
  const h = y1 - y0
  g.shadow(W / 2, y1 + RIM + 30, w * 0.56, 46, 0.5)
  // Raised wooden surround: a lip below, the polished top, a light edge.
  g.rrect(x0 - RIM, y0 - RIM + 18, w + RIM * 2, h + RIM * 2, 92, shade(C.woodDark, -0.35))
  g.rrect(
    x0 - RIM,
    y0 - RIM,
    w + RIM * 2,
    h + RIM * 2,
    92,
    g.lin(0, y0 - RIM, 0, y1 + RIM, [
      [0, shade(C.wood, 0.12)],
      [1, shade(C.wood, -0.1)],
    ]),
  )
  // Varnish highlight along the top edge, kept inside the rounded corners.
  g.rrect(x0 - RIM + 84, y0 - RIM + 6, w + RIM * 2 - 168, 12, 6, alpha('#ffffff', 0.25))
  // Bolts at the corners.
  for (const [bx, by] of [
    [x0 - 12, y0 - 12],
    [x1 + 12, y0 - 12],
    [x0 - 12, y1 + 12],
    [x1 + 12, y1 + 12],
  ] as const) {
    g.circle(bx, by + 2, 9, shade(C.woodDark, -0.3))
    g.circle(bx, by, 8, shade(C.wood, 0.35))
  }
  g.rrect(x0 - 6, y0 - 6, w + 12, h + 12, 60, shade(C.woodDark, -0.2))
  g.clip(x0, y0, w, h, 56, () => {
    g.rect(
      x0,
      y0,
      w,
      h,
      g.lin(0, y0, 0, y1, [
        [0, shade(GRASS, 0.08)],
        [0.5, shade(GRASS, 0.02)],
        [1, shade(GRASS, -0.06)],
      ]),
    )
    // Diagonal mowing stripes.
    const c = g.ctx
    c.save()
    c.translate(W / 2, (y0 + y1) / 2)
    c.rotate(-0.5)
    for (let i = -14; i < 14; i += 2) g.rect(i * 70, -900, 70, 1800, alpha('#ffffff', 0.05))
    c.restore()
    // The green: a lighter, close-cut circle round the cup.
    const cup = geo.cup
    g.circle(
      cup.x,
      cup.y,
      190,
      g.rad(cup.x, cup.y, 40, 190, [
        [0, alpha(shade(GRASS, 0.3), 0.6)],
        [0.85, alpha(shade(GRASS, 0.22), 0.45)],
        [1, alpha(shade(GRASS, 0.22), 0)],
      ]),
    )
    g.alpha(0.12, () => g.ring(cup.x, cup.y, 150 + Math.sin(time * 1.6) * 6, '#ffffff', 5))
    // The border rail the ball bounces on, with its shadow on the grass.
    g.rrect(x0, y0, w, h, 56, undefined, alpha('#000000', 0.2), 64)
    g.rrect(x0, y0, w, h, 56, undefined, shade(C.wood, -0.05), WALL_T * 2)
    g.rrect(
      x0 + WALL_T - 2,
      y0 + WALL_T - 2,
      w - WALL_T * 2 + 4,
      h - WALL_T * 2 + 4,
      46,
      undefined,
      alpha('#ffffff', 0.22),
      3,
    )
  })
}

/** The tee: one rubber mat under both starting spots, a white line across it. */
function drawTee(g: Draw, tees: [Pt, Pt]): void {
  const [a, b] = tees
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const ang = Math.atan2(b.y - a.y, b.x - a.x)
  const half = Math.hypot(b.x - a.x, b.y - a.y) / 2 + BALL_R + 26
  const r = BALL_R + 22
  g.at(cx, cy, ang, () => {
    g.rrect(-half, -r + 6, half * 2, r * 2, 22, alpha('#000000', 0.2))
    g.rrect(-half, -r, half * 2, r * 2, 22, mix(C.grass, C.cream, 0.28))
    g.rrect(-half + 6, -r + 6, half * 2 - 12, r * 2 - 12, 16, undefined, alpha('#ffffff', 0.5), 4)
  })
}

/**
 * The cup and its flag. The cloth shows the hole number; when a ball drops,
 * the pole hops out and back (`dropAt` is the game time of the last drop).
 */
function drawCup(g: Draw, c: Pt, time: number, hole: number, dropAt: number): void {
  g.circle(c.x, c.y, CUP_R + 8, alpha('#ffffff', 0.9))
  g.circle(
    c.x,
    c.y,
    CUP_R,
    g.rad(c.x, c.y - 8, 4, CUP_R, [
      [0, shade(C.ink, -0.2)],
      [0.7, C.ink],
      [1, shade(C.ink, 0.3)],
    ]),
  )
  g.ellipse(c.x, c.y - CUP_R * 0.45, CUP_R * 0.8, CUP_R * 0.35, alpha('#000000', 0.45))
  const k = time - dropAt
  const hop = k >= 0 && k < 0.7 ? Math.sin((k / 0.7) * Math.PI) * 60 : 0
  const top = c.y - 150 - hop
  // Pole shadow on the grass, then the pole and its cloth.
  g.line(c.x + 6, c.y, c.x + 70, c.y - 40, alpha('#000000', 0.2), 8)
  g.line(c.x, c.y - hop * 0.4, c.x, top, shade(C.white, -0.1), 9)
  g.line(c.x - 2, c.y - hop * 0.4, c.x - 2, top, '#ffffff', 3)
  const wave = Math.sin(time * 4) * 8
  const fw = 96
  g.path((p) => {
    p.moveTo(c.x, top)
    p.quadraticCurveTo(c.x + fw * 0.5, top - 8 + wave, c.x + fw, top + 4 + wave * 0.6)
    p.lineTo(c.x + fw - 6, top + 58 + wave * 0.6)
    p.quadraticCurveTo(c.x + fw * 0.5, top + 50 + wave, c.x, top + 62)
    p.closePath()
  }, C.yellow)
  g.text(String(hole + 1), c.x + fw * 0.48, top + 30 + wave * 0.8, {
    size: 38,
    weight: 700,
    color: C.ink,
  })
  g.circle(c.x, top - 4, 9, C.white)
}

function drawSlope(g: Draw, s: Slope, time: number): void {
  const w = s.x1 - s.x0
  const h = s.y1 - s.y0
  const len = Math.hypot(s.ax, s.ay) || 1
  const dx = s.ax / len
  const dy = s.ay / len
  const cx = s.x0 + w / 2
  const cy = s.y0 + h / 2
  // A ramp: lit at its high end, shaded toward the low end it pushes to.
  g.rrect(
    s.x0,
    s.y0,
    w,
    h,
    28,
    g.lin(cx - (dx * w) / 2, cy - (dy * h) / 2, cx + (dx * w) / 2, cy + (dy * h) / 2, [
      [0, alpha('#ffffff', 0.2)],
      [1, alpha('#000000', 0.22)],
    ]),
    alpha('#e9fff0', 0.35),
    4,
  )
  const px = -dy
  const py = dx
  const step = 90
  const phase = (time * 80) % step
  g.clip(s.x0, s.y0, w, h, 28, () => {
    for (let k = -8; k <= 8; k++) {
      const d = k * step + phase
      const x = cx + dx * d
      const y = cy + dy * d
      g.line(x - dx * 18 + px * 22, y - dy * 18 + py * 22, x, y, alpha('#ffffff', 0.5), 9)
      g.line(x - dx * 18 - px * 22, y - dy * 18 - py * 22, x, y, alpha('#ffffff', 0.5), 9)
    }
  })
}

function drawWalls(g: Draw, walls: Seg[]): void {
  // Inner walls only: the first four are the course border, drawn as the frame.
  const inner = walls.slice(4)
  for (const s of inner)
    g.line(s.x0 + 6, s.y0 + 16, s.x1 + 6, s.y1 + 16, alpha('#000000', 0.25), WALL_T * 2 + 6)
  for (const s of inner) {
    g.line(s.x0, s.y0 + 10, s.x1, s.y1 + 10, shade(C.woodDark, -0.35), WALL_T * 2 + 2)
    g.line(s.x0, s.y0, s.x1, s.y1, shade(C.wood, 0.05), WALL_T * 2)
    g.line(s.x0, s.y0 - 5, s.x1, s.y1 - 5, alpha('#ffffff', 0.3), 5)
  }
}

function drawBumper(g: Draw, p: Pt, time: number, hitAt: number): void {
  const k = time - hitAt
  const pop = k >= 0 && k < 0.35 ? Math.sin((k / 0.35) * Math.PI) * 0.22 : 0
  const r = BUMP_R * (1 + pop)
  g.shadow(p.x + 6, p.y + 18, BUMP_R * 1.05, BUMP_R * 0.7, 0.4)
  g.circle(p.x, p.y + 12, r, shade(C.orange, -0.5))
  g.circle(p.x, p.y + 6, r, shade(C.orange, -0.2))
  g.circle(
    p.x,
    p.y,
    r,
    g.rad(
      p.x,
      p.y,
      4,
      r,
      [
        [0, shade(C.yellow, 0.45)],
        [0.65, pop > 0 ? shade(C.yellow, 0.3) : C.yellow],
        [1, C.orange],
      ],
      p.x - 12,
      p.y - 14,
    ),
  )
  g.ring(p.x, p.y, r * 0.6, alpha(C.orange, 0.6), 6)
  g.star(p.x, p.y, r * 0.32, alpha('#ffffff', 0.85), 5, 0.5)
  g.alpha(0.7, () => g.ellipse(p.x - r * 0.35, p.y - r * 0.45, r * 0.26, r * 0.14, '#fff', -0.6))
  if (pop > 0) g.alpha(1 - k / 0.35, () => g.ring(p.x, p.y, r + 10 + k * 120, C.yellow, 8))
}

function drawMill(g: Draw, m: Mill): void {
  g.shadow(m.x + 10, m.y + 20, m.half * 0.95, m.half * 0.3, 0.3)
  for (const k of [0, Math.PI / 2]) {
    g.at(m.x, m.y, m.a + k, () => {
      g.rrect(-m.half, -MILL_T + 10, m.half * 2, MILL_T * 2, MILL_T, shade(C.purple, -0.5))
      g.rrect(-m.half, -MILL_T, m.half * 2, MILL_T * 2, MILL_T, C.purple)
      // Sail panels near each tip.
      for (const sx of [-1, 1]) {
        g.rrect(
          sx > 0 ? m.half * 0.42 : -m.half * 0.94,
          -MILL_T + 4,
          m.half * 0.52,
          MILL_T * 2 - 8,
          8,
          shade(C.purple, 0.35),
        )
      }
      g.rrect(
        -m.half + 12,
        -MILL_T + 4,
        m.half * 2 - 24,
        MILL_T * 0.6,
        MILL_T * 0.3,
        alpha('#ffffff', 0.3),
      )
    })
  }
  g.circle(m.x, m.y + 10, 38, shade(C.pink, -0.5))
  g.circle(
    m.x,
    m.y,
    36,
    g.rad(
      m.x,
      m.y,
      4,
      36,
      [
        [0, shade(C.pink, 0.35)],
        [1, C.pink],
      ],
      m.x - 10,
      m.y - 12,
    ),
  )
  g.circle(m.x, m.y, 10, shade(C.pink, -0.4))
}

function drawBall(g: Draw, b: Ball, cup: Pt, time: number, trail: Pt[]): void {
  let x = b.x
  let y = b.y
  let k = 1
  let size = BALL_R
  const col = SIDE[b.side].main
  if (b.state === 'holed') {
    // Swirl into the cup and drop out of sight.
    const t = Math.min(1, Math.max(0, (time - b.holedAt) / 0.5))
    k = 1 - t
    size = BALL_R * (0.35 + 0.65 * k)
    const a = t * 7
    x = cup.x + Math.cos(a) * CUP_R * 0.4 * k
    y = cup.y + Math.sin(a) * CUP_R * 0.4 * k
    if (k <= 0.02) return
  } else if (b.state === 'picked') {
    k = 0.4
  }
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i] as Pt
    const f = (i + 1) / (trail.length + 1)
    g.alpha(f * 0.35, () => g.circle(p.x, p.y, BALL_R * (0.35 + 0.55 * f), SIDE[b.side].light))
  }
  g.alpha(k, () => {
    if (b.state !== 'holed') g.shadow(x + 6, y + 14, size * 0.95, size * 0.6, 0.45)
    g.ball(x, y, size, col, 1)
    g.sideMark(b.side, x + size * 0.1, y + size * 0.15, size * 0.3, alpha('#ffffff', 0.92))
  })
}

/** Yellow ring under the ball that is up next. */
function drawLive(g: Draw, b: Ball, time: number): void {
  const p = 0.5 + 0.5 * Math.sin(time * 6)
  g.circle(b.x, b.y, BALL_R + 22 + p * 6, alpha(C.yellow, 0.16))
  g.ring(b.x, b.y, BALL_R + 22 + p * 6, alpha(C.yellow, 0.9), 6)
}

function drawAim(g: Draw, b: Ball, aim: Aim, side: Side): void {
  const col = mix(SIDE[side].light, C.yellow, aim.power)
  const len = 80 + aim.power * 380
  const ang = Math.atan2(aim.dy, aim.dx)
  // Where the putt goes: shrinking dots out to an arrow head.
  const n = Math.round(4 + aim.power * 10)
  for (let i = 1; i <= n; i++) {
    const d = BALL_R + 30 + ((len - BALL_R - 30) * i) / n
    g.circle(b.x + aim.dx * d, b.y + aim.dy * d, 10 - (i / n) * 4, alpha(col, 0.95 - (i / n) * 0.4))
  }
  const ex = b.x + aim.dx * (len + 30)
  const ey = b.y + aim.dy * (len + 30)
  g.poly(
    [
      ex + Math.cos(ang) * 30,
      ey + Math.sin(ang) * 30,
      ex + Math.cos(ang + 2.5) * 26,
      ey + Math.sin(ang + 2.5) * 26,
      ex + Math.cos(ang - 2.5) * 26,
      ey + Math.sin(ang - 2.5) * 26,
    ],
    col,
  )
  // The pull: a putter-head bar behind the ball.
  const back = BALL_R + 26 + aim.power * 70
  const bx = b.x - aim.dx * back
  const by = b.y - aim.dy * back
  g.at(bx, by, ang + Math.PI / 2, () => {
    g.rrect(-38, -11, 76, 22, 10, shade(C.white, -0.15))
    g.rrect(-38, -11, 76, 9, 5, '#ffffff')
  })
  // Power ring: how far the pull has gone.
  g.ring(b.x, b.y, BALL_R + 34, alpha('#000000', 0.25), 12)
  g.arc(b.x, b.y, BALL_R + 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * aim.power, col, 12)
}

/** The whole shared course: grass, walls, obstacles, cup, both balls. */
export function drawHole(g: Draw, look: Look): void {
  const t = look.table
  const geo = t.geo
  backdrop(g)
  // A new hole drops in: a quick scale-and-fade of the whole course.
  const k = Math.min(1, Math.max(0, (look.time - look.holeAt) / 0.5))
  const s = 0.9 + 0.1 * outBack(k)
  g.alpha(0.3 + 0.7 * outCubic(k), () =>
    g.at(
      W / 2,
      MID,
      0,
      () => {
        g.ctx.translate(-W / 2, -MID)
        drawCourse(g, geo, look.time)
        drawTee(g, geo.tees)
        for (const sl of geo.slopes) drawSlope(g, sl, look.time)
        const dropAt = Math.max(t.balls[0].holedAt, t.balls[1].holedAt)
        drawCup(g, geo.cup, look.time, look.hole, dropAt < 0 ? -9 : dropAt)
        drawWalls(g, geo.walls)
        for (const m of geo.mills) drawMill(g, m)
        geo.bumpers.forEach((p, i) => drawBumper(g, p, look.time, look.bumpAt[i] ?? -9))
        const live = t.balls[look.turn]
        if (look.live && live.state === 'play' && !look.aiming) drawLive(g, live, look.time)
        for (const b of t.balls) drawBall(g, b, geo.cup, look.time, look.trails[b.side])
        if (look.aiming && live.state === 'play') drawAim(g, live, look.aiming, look.turn)
      },
      s,
    ),
  )
}

/**
 * A scorecard row for one side, drawn upright for that side's player. Red's
 * sits under the course, blue's above it.
 */
export function drawCard(g: Draw, side: Side, look: Look): void {
  const n = look.holes
  const cw = Math.min(110, 760 / n)
  const width = cw * n
  const y = side === 0 ? COURSE.y1 + RIM + 82 : COURSE.y0 - RIM - 82
  const done = look.card[side]
  const col = SIDE[side]
  g.forSide(side, W / 2, y, () => {
    g.rrect(-width / 2 - 16, -54, width + 32, 110, 32, alpha(C.ink, 0.82))
    g.rrect(-width / 2 - 16, -54, width + 32, 110, 32, undefined, alpha(col.main, 0.35), 4)
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + cw * (i + 0.5)
      const current = i === look.hole
      if (current) g.tile(x - cw / 2 + 6, -46, cw - 12, 92, 20, shade(col.main, -0.35), 6)
      g.text(String(i + 1), x, -20, {
        size: 34,
        weight: 600,
        color: alpha(C.white, current ? 0.85 : 0.45),
      })
      let value: string
      let color: string
      if (i < done.length) {
        const v = done[i] as number
        value = String(v)
        color = v === 1 ? C.yellow : C.white
      } else if (current) {
        value = String(look.table.balls[side].strokes)
        color = col.light
      } else {
        value = '·'
        color = alpha(C.white, 0.3)
      }
      g.text(value, x, 22, { size: 42, weight: 700, color })
    }
  })
}
