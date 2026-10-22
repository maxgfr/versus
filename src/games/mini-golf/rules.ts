import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'
import { collideDynamic, type Disc } from '../../engines/puck/index.ts'

/**
 * Mini golf: one shared course per hole, one ball per player, pure physics.
 * No DOM, no sound. Both balls live on the same course; the rules decide who
 * putts next, when a ball drops, and what a hole costs.
 */

export const BALL_R = 22
export const CUP_R = 34
export const WALL_T = 12
export const BUMP_R = 40
export const MILL_T = 14
/** Exponential table friction (per second). */
export const DRAG = 0.95
/** Ball speed (world units / s) at full power. */
export const VMAX = 1500
/** Faster than this and the ball lips out of the cup instead of dropping in. */
export const SINK_SPEED = 430
export const REST_SPEED = 14
export const MAX_STROKES = 6
/** A roll is cut short after this many seconds, so a stuck ball cannot stall the match. */
export const MAX_ROLL = 9
export const FRAME = 1 / 60
const SUB = 4
const BUMP_SPEED = 360
const BUMP_E = 1.25
const WALL_E = 0.72
export const COURSE = { x0: 80, y0: 430, x1: 920, y1: 1370 }

export interface Pt {
  x: number
  y: number
}
export interface Seg {
  x0: number
  y0: number
  x1: number
  y1: number
}
export interface Slope extends Seg {
  /** Acceleration (world units / s²) while the ball is inside the zone. */
  ax: number
  ay: number
}
export interface Mill extends Pt {
  /** Half length of each bar; the windmill is a cross of two bars through its hub. */
  half: number
  /** Angular speed (rad / s). */
  w: number
  /** Current angle (rad). */
  a: number
}

export interface Geo {
  /** Which layout template this hole came from (for the card art). */
  id: number
  cup: Pt
  /** Where red's and blue's balls start. */
  tees: [Pt, Pt]
  walls: Seg[]
  bumpers: Pt[]
  slopes: Slope[]
  mills: Mill[]
}

export type BallState = 'play' | 'holed' | 'picked'

export interface Ball extends Disc {
  side: Side
  strokes: number
  state: BallState
  /** Game time when it dropped (cosmetic: the sink animation). */
  holedAt: number
}

export interface Table {
  geo: Geo
  balls: [Ball, Ball]
}

export type Event =
  | { kind: 'wall' | 'bump' | 'mill' | 'ball'; x: number; y: number; speed: number }
  | { kind: 'holed'; side: Side; x: number; y: number; strokes: number }
  | { kind: 'picked'; side: Side; x: number; y: number }

interface Feature {
  tee: [number, number]
  cup: [number, number]
  walls: [number, number, number, number][]
  bumpers: [number, number][]
  /** x0, y0, x1, y1, ax, ay */
  slopes: [number, number, number, number, number, number][]
  /** x, y, half length */
  mills: [number, number, number][]
}

/** Templates authored as red sees them: tee at the bottom, cup at the top. Flips and jitter vary them. */
const LAYOUTS: Feature[] = [
  {
    tee: [500, 1240],
    cup: [500, 560],
    walls: [
      [200, 900, 380, 900],
      [620, 900, 800, 900],
    ],
    bumpers: [[500, 720]],
    slopes: [],
    mills: [],
  },
  {
    tee: [180, 1270],
    cup: [820, 560],
    walls: [
      [92, 1010, 700, 1010],
      [300, 745, 908, 745],
    ],
    bumpers: [],
    slopes: [],
    mills: [],
  },
  {
    tee: [500, 1250],
    cup: [500, 560],
    walls: [],
    bumpers: [
      [300, 1040],
      [700, 1040],
    ],
    slopes: [],
    mills: [[500, 900, 170]],
  },
  {
    tee: [250, 1250],
    cup: [720, 560],
    walls: [[420, 700, 420, 860]],
    bumpers: [[600, 640]],
    slopes: [[300, 780, 700, 1000, -260, 0]],
    mills: [],
  },
  {
    tee: [500, 1250],
    cup: [500, 560],
    walls: [
      [330, 640, 330, 1120],
      [670, 640, 670, 1120],
    ],
    bumpers: [[500, 880]],
    slopes: [],
    mills: [],
  },
  {
    tee: [820, 1230],
    cup: [300, 560],
    walls: [[92, 880, 620, 880]],
    bumpers: [[760, 700]],
    slopes: [],
    mills: [],
  },
  {
    tee: [300, 1240],
    cup: [700, 540],
    walls: [[480, 620, 480, 700]],
    bumpers: [
      [500, 1000],
      [330, 800],
      [660, 760],
    ],
    slopes: [],
    mills: [],
  },
]

/** Windmills turn this much faster on each later hole (capped): the course gets tense. */
export const MILL_RAMP = 0.1
export const MILL_RAMP_MAX = 0.6

/**
 * A procedural hole from the seed: a template, mirrored left-right and/or
 * top-bottom at random, every feature nudged, a windmill spun in a random
 * direction. `prev` avoids repeating the last template back to back; `hole`
 * (0-based) speeds the windmills up as the match goes on.
 */
export function makeGeo(rng: Rng, prev = -1, hole = 0): Geo {
  const ramp = 1 + Math.min(MILL_RAMP_MAX, Math.max(0, hole) * MILL_RAMP)
  let id = rng.int(0, LAYOUTS.length - 1)
  if (id === prev) id = (id + rng.int(1, LAYOUTS.length - 1)) % LAYOUTS.length
  const L = LAYOUTS[id] as Feature
  const fx = rng.chance(0.5)
  const fy = rng.chance(0.5)
  const jit = () => rng.range(-14, 14)
  const P = (x: number, y: number): Pt => ({
    x: (fx ? W - x : x) + jit(),
    y: (fy ? H - y : y) + jit(),
  })
  const cup = P(L.cup[0], L.cup[1])
  const tee = P(L.tee[0], L.tee[1])
  const dx = cup.x - tee.x
  const dy = cup.y - tee.y
  const len = Math.hypot(dx, dy) || 1
  // Two balls share the tee, side by side across the line to the cup.
  const px = -dy / len
  const py = dx / len
  const gap = BALL_R + 12
  const walls: Seg[] = [
    { x0: COURSE.x0, y0: COURSE.y0, x1: COURSE.x1, y1: COURSE.y0 },
    { x0: COURSE.x1, y0: COURSE.y0, x1: COURSE.x1, y1: COURSE.y1 },
    { x0: COURSE.x1, y0: COURSE.y1, x1: COURSE.x0, y1: COURSE.y1 },
    { x0: COURSE.x0, y0: COURSE.y1, x1: COURSE.x0, y1: COURSE.y0 },
  ]
  for (const [x0, y0, x1, y1] of L.walls) {
    const a = P(x0, y0)
    const b = P(x1, y1)
    walls.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y })
  }
  const slopes: Slope[] = L.slopes.map(([x0, y0, x1, y1, ax, ay]) => {
    const a = P(x0, y0)
    const b = P(x1, y1)
    return {
      x0: Math.min(a.x, b.x),
      y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x),
      y1: Math.max(a.y, b.y),
      ax: fx ? -ax : ax,
      ay: fy ? -ay : ay,
    }
  })
  const mills: Mill[] = L.mills.map(([x, y, half]) => {
    const c = P(x, y)
    const w = rng.sign() * rng.range(1, 1.5) * ramp
    return { x: c.x, y: c.y, half, w, a: rng.range(0, Math.PI) }
  })
  return {
    id,
    cup,
    tees: [
      { x: tee.x - px * gap, y: tee.y - py * gap },
      { x: tee.x + px * gap, y: tee.y + py * gap },
    ],
    walls,
    bumpers: L.bumpers.map(([x, y]) => P(x, y)),
    slopes,
    mills,
  }
}

export function startTable(geo: Geo): Table {
  const ball = (side: Side): Ball => ({
    x: geo.tees[side].x,
    y: geo.tees[side].y,
    vx: 0,
    vy: 0,
    r: BALL_R,
    side,
    strokes: 0,
    state: 'play',
    holedAt: -1,
  })
  return { geo, balls: [ball(0), ball(1)] }
}

export function cloneTable(t: Table): Table {
  return {
    geo: { ...t.geo, mills: t.geo.mills.map((m) => ({ ...m })) },
    balls: [{ ...t.balls[0] }, { ...t.balls[1] }],
  }
}

/** Hit a resting ball. `dx, dy` is a unit vector, `power` 0..1. */
export function launch(t: Table, side: Side, dx: number, dy: number, power: number): void {
  const b = t.balls[side]
  b.vx = dx * power * VMAX
  b.vy = dy * power * VMAX
  b.strokes++
}

export const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y)

/** Advance every windmill by `dt`. Runs every frame, whether or not a ball moves. */
export function spin(t: Table, dt: number): void {
  for (const m of t.geo.mills) m.a += m.w * dt
}

/** Circle against a capsule (segment with radius `rad`). Returns the closing speed on contact. */
function hitSeg(b: Ball, s: Seg, rad: number, e: number, mill: Mill | null): number {
  const dx = s.x1 - s.x0
  const dy = s.y1 - s.y0
  const len2 = dx * dx + dy * dy
  const k = len2 > 0 ? Math.min(1, Math.max(0, ((b.x - s.x0) * dx + (b.y - s.y0) * dy) / len2)) : 0
  const px = s.x0 + dx * k
  const py = s.y0 + dy * k
  const ex = b.x - px
  const ey = b.y - py
  const d = Math.hypot(ex, ey)
  if (d >= rad) return 0
  const nx = d > 1e-6 ? ex / d : 0
  const ny = d > 1e-6 ? ey / d : -1
  b.x = px + nx * rad
  b.y = py + ny * rad
  // A windmill bar moves: its surface speed at the contact is w × r.
  const wx = mill ? -mill.w * (py - mill.y) : 0
  const wy = mill ? mill.w * (px - mill.x) : 0
  const vn = (b.vx - wx) * nx + (b.vy - wy) * ny
  if (vn >= 0) return 0
  b.vx -= (1 + e) * vn * nx
  b.vy -= (1 + e) * vn * ny
  return -vn
}

function hitBump(b: Ball, p: Pt): number {
  const ex = b.x - p.x
  const ey = b.y - p.y
  const rad = b.r + BUMP_R
  const d = Math.hypot(ex, ey)
  if (d >= rad) return 0
  const nx = d > 1e-6 ? ex / d : 0
  const ny = d > 1e-6 ? ey / d : -1
  b.x = p.x + nx * rad
  b.y = p.y + ny * rad
  const vn = b.vx * nx + b.vy * ny
  if (vn < 0) {
    b.vx -= (1 + BUMP_E) * vn * nx
    b.vy -= (1 + BUMP_E) * vn * ny
  }
  // Pinball kick: a bumper never leaves the ball crawling.
  const sp = Math.hypot(b.vx, b.vy)
  if (sp > 1e-6 && sp < BUMP_SPEED) {
    b.vx *= BUMP_SPEED / sp
    b.vy *= BUMP_SPEED / sp
  }
  return -vn
}

function moveBall(t: Table, b: Ball, h: number, ev?: Event[]): void {
  const g = t.geo
  for (const s of g.slopes) {
    if (b.x >= s.x0 && b.x <= s.x1 && b.y >= s.y0 && b.y <= s.y1) {
      b.vx += s.ax * h
      b.vy += s.ay * h
    }
  }
  b.x += b.vx * h
  b.y += b.vy * h
  const k = Math.exp(-DRAG * h)
  b.vx *= k
  b.vy *= k
  for (const s of g.walls) {
    const sp = hitSeg(b, s, b.r + WALL_T, WALL_E, null)
    if (sp > 120) ev?.push({ kind: 'wall', x: b.x, y: b.y, speed: sp })
  }
  for (const p of g.bumpers) {
    const sp = hitBump(b, p)
    if (sp > 60) ev?.push({ kind: 'bump', x: b.x, y: b.y, speed: sp })
  }
  for (const m of g.mills) {
    const c = Math.cos(m.a) * m.half
    const s = Math.sin(m.a) * m.half
    const c2 = -Math.sin(m.a) * m.half
    const s2 = Math.cos(m.a) * m.half
    const bars: Seg[] = [
      { x0: m.x - c, y0: m.y - s, x1: m.x + c, y1: m.y + s },
      { x0: m.x - c2, y0: m.y - s2, x1: m.x + c2, y1: m.y + s2 },
    ]
    for (const bar of bars) {
      const sp = hitSeg(b, bar, b.r + MILL_T, 1, m)
      if (sp > 120) ev?.push({ kind: 'mill', x: b.x, y: b.y, speed: sp })
    }
  }
}

/** Drop a ball into the cup when it is inside the rim and slow enough. */
function checkCup(t: Table, b: Ball, ev?: Event[]): void {
  const c = t.geo.cup
  if (Math.hypot(b.x - c.x, b.y - c.y) >= CUP_R) return
  if (Math.hypot(b.vx, b.vy) >= SINK_SPEED) return
  b.state = 'holed'
  b.x = c.x
  b.y = c.y
  b.vx = 0
  b.vy = 0
  ev?.push({ kind: 'holed', side: b.side, x: c.x, y: c.y, strokes: b.strokes })
}

/**
 * One fixed frame: the windmills turn, then the balls move in SUB substeps
 * (friction, walls, bumpers, bars, the other ball, the cup). Deterministic, so
 * the bot can simulate a shot exactly as the game will play it.
 */
export function frame(t: Table, ev?: Event[], dt = FRAME): void {
  spin(t, dt)
  const h = dt / SUB
  for (let i = 0; i < SUB; i++) {
    for (const b of t.balls) if (b.state === 'play') moveBall(t, b, h, ev)
    const [a, b] = t.balls
    if (a.state === 'play' && b.state === 'play') {
      const c = collideDynamic(a, b, 1, 1, 0.9)
      if (c && c.speed > 40) ev?.push({ kind: 'ball', x: c.x, y: c.y, speed: c.speed })
    }
    for (const ball of t.balls) if (ball.state === 'play') checkCup(t, ball, ev)
  }
  for (const b of t.balls) {
    if (b.state === 'play' && Math.hypot(b.vx, b.vy) < REST_SPEED) {
      b.vx = 0
      b.vy = 0
    }
  }
}

/**
 * Stop every ball where it is. A roll cut short at `MAX_ROLL` must not leave a
 * ball drifting into the next putt (it would move again with the rival's shot).
 */
export function halt(t: Table): void {
  for (const b of t.balls) {
    b.vx = 0
    b.vy = 0
  }
}

/** True once every ball still in play has stopped. */
export function atRest(t: Table): boolean {
  return t.balls.every((b) => b.state !== 'play' || (b.vx === 0 && b.vy === 0))
}

/**
 * Called once a roll has ended: a ball that used up its strokes without
 * dropping is picked up and scores the maximum.
 */
export function settle(t: Table, ev?: Event[]): void {
  for (const b of t.balls) {
    if (b.state === 'play' && b.strokes >= MAX_STROKES) {
      b.state = 'picked'
      ev?.push({ kind: 'picked', side: b.side, x: b.x, y: b.y })
    }
  }
}

/** Both balls are out of play: the hole is over. */
export function holeOver(t: Table): boolean {
  return t.balls.every((b) => b.state !== 'play')
}

/** A finished ball's strokes for the card: holed scores what it took, a picked-up ball scores the maximum. */
export function holeScore(b: Ball): number {
  return b.state === 'holed' ? b.strokes : MAX_STROKES
}

/**
 * Who putts next: the ball still in play with fewer strokes on this hole; on a
 * tie, the one farther from the cup (away first); on a tie again, red.
 */
export function nextTurn(t: Table): Side | null {
  const live = t.balls.filter((b) => b.state === 'play')
  if (live.length === 0) return null
  const cup = t.geo.cup
  live.sort((a, b) => {
    if (a.strokes !== b.strokes) return a.strokes - b.strokes
    const da = dist(a, cup)
    const db = dist(b, cup)
    if (Math.abs(da - db) > 1) return db - da
    return a.side - b.side
  })
  return (live[0] as Ball).side
}

/** Total strokes per side over the whole match. */
export function totals(card: [number[], number[]]): [number, number] {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  return [sum(card[0]), sum(card[1])]
}

/**
 * Play one shot forward on a copy of the table (the rest of the table as it
 * is, the other ball included) and report whether it dropped, where it ended
 * and how close it came to the cup. Used by the bot to pick a shot.
 */
export function simulate(
  t: Table,
  side: Side,
  dx: number,
  dy: number,
  power: number,
): { holed: boolean; dist: number; closest: number } {
  const c = cloneTable(t)
  const b = c.balls[side]
  b.vx = dx * power * VMAX
  b.vy = dy * power * VMAX
  let closest = Infinity
  const frames = Math.round(MAX_ROLL / FRAME)
  for (let i = 0; i < frames; i++) {
    frame(c)
    closest = Math.min(closest, dist(b, c.geo.cup))
    if (b.state !== 'play' || (b.vx === 0 && b.vy === 0)) break
  }
  return { holed: b.state === 'holed', dist: dist(b, c.geo.cup), closest }
}
