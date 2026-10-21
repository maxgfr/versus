import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { hash01, LANE_W, repeatX } from '../../engines/runner/index.ts'
import {
  BOOST_MAX,
  FINISH,
  metres,
  obstacleAt,
  RISE_T,
  ROAD_Y,
  TRUCK_HALF,
  TRUCK_X,
  type Truck,
  WALL_H,
  WALL_V,
} from './rules.ts'
import { card, chip, scorePill } from './ui.ts'

type View = { x0: number; y0: number; x1: number; y1: number }

export interface LaneView {
  truck: Truck
  rival: Truck
  seed: number
  time: number
  phase: 'ready' | 'run'
  since: number
  name: string
  bot: boolean
  /** Game time this truck crossed the flag, or -1. */
  finishT: number
  /** Stamps for the animations: last smash (time, course x of the wall), last bump, last landing. */
  smashAt: number
  smashX: number
  bumpAt: number
  landAt: number
  fallAt: number
  winner: Side | 'draw' | null
  endAt: number
}

/** Wall width: its near face is where the bumper hits. */
const WALL_W = 120
/** Visual wheel radius and positions (from the truck's centre). */
const TYRE = 54
const REAR = -104
const FRONT = 58
const CARD_Y = 330
const CARD_X = 640

const SKY: readonly [readonly [string, string], readonly [string, string]] = [
  ['#1c0e22', '#6f2639'],
  ['#0d1129', '#22397a'],
]

function skyline(g: Draw, side: Side, v: View, d: number, time: number): void {
  const [top, low] = SKY[side]
  g.rect(
    v.x0,
    v.y0,
    v.x1 - v.x0,
    ROAD_Y - v.y0 + 4,
    g.lin(0, v.y0, 0, ROAD_Y, [
      [0, top],
      [1, low],
    ]),
  )
  // Floodlights over the arena.
  for (const fx of [220, 780]) {
    g.poly(
      [fx - 20, v.y0, fx + 20, v.y0, fx + 260, ROAD_Y, fx - 260, ROAD_Y],
      g.lin(0, v.y0, 0, ROAD_Y, [
        [0, alpha(SIDE[side].light, 0.16)],
        [1, alpha(SIDE[side].light, 0)],
      ]),
    )
  }
  // Far skyline: dark blocks with lit windows.
  const far = mix(SIDE[side].main, top, 0.78)
  repeatX(d * 0.12, 190, v.x0, v.x1, (x, i) => {
    const h = 230 + ((i * 61) % 5) * 46
    g.rect(x, ROAD_Y - h, 150, h, far)
  })
  // Near blocks, lit windows that flicker.
  const near = mix(SIDE[side].main, top, 0.6)
  repeatX(d * 0.25, 240, v.x0, v.x1, (x, i) => {
    const h = 150 + ((i * 97) % 6) * 34
    g.rrect(x, ROAD_Y - h, 180, h + 10, 12, near)
    g.rect(x, ROAD_Y - h, 180, 10, alpha(C.white, 0.08))
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const on = (i * 7 + r * 3 + c) % 4 !== 0
        if (!on) continue
        const flick = Math.sin(time * 2 + i * 3 + r) > -0.9
        g.rrect(
          x + 24 + c * 50,
          ROAD_Y - h + 28 + r * 46,
          26,
          26,
          5,
          alpha('#ffd66b', flick ? 0.6 : 0.2),
        )
      }
  })
  // Crowd barrier along the road.
  g.rect(v.x0, ROAD_Y - 56, v.x1 - v.x0, 34, shade(SIDE[side].main, -0.55))
  repeatX(d, 90, v.x0, v.x1, (x) => g.rect(x, ROAD_Y - 56, 10, 34, alpha(C.white, 0.15)))
  g.rect(v.x0, ROAD_Y - 58, v.x1 - v.x0, 6, alpha(C.white, 0.25))
}

/** The obstacles in course order that are on screen, and the flag. */
function visible(
  o: LaneView,
  v: View,
): { i: number; sx: number; kind: 'gap' | 'wall'; len: number; x: number }[] {
  const d = o.truck.x
  const out = []
  const first = Math.max(0, Math.floor((d + v.x0 - TRUCK_X - 900 - 400) / 600))
  const last = Math.floor((d + v.x1 - TRUCK_X - 900 + 200) / 600) + 1
  for (let i = first; i <= last; i++) {
    const ob = obstacleAt(o.seed, i)
    if (ob.x >= FINISH - 200) break
    out.push({ i, sx: TRUCK_X + (ob.x - d), kind: ob.kind, len: ob.len, x: ob.x })
  }
  return out
}

/** Inside of a pit: drawn before the truck, so a falling truck shows against it. */
function pitInside(g: Draw, x0: number, len: number, v: View, time: number): void {
  const bottom = ROAD_Y + 210
  g.rect(
    x0,
    ROAD_Y,
    len,
    v.y1 - ROAD_Y + 20,
    g.lin(0, ROAD_Y, 0, bottom, [
      [0, '#100b1a'],
      [1, '#050309'],
    ]),
  )
  // Hot glow far down.
  const pulse = 0.5 + 0.2 * Math.sin(time * 5 + x0 * 0.01)
  g.rect(
    x0,
    bottom - 110,
    len,
    v.y1 - bottom + 140,
    g.lin(0, bottom - 110, 0, bottom + 30, [
      [0, alpha(C.orange, 0)],
      [1, alpha(C.orange, pulse)],
    ]),
  )
  // The far wall of the pit, lit from above.
  g.rect(x0 + len - 22, ROAD_Y, 22, bottom - ROAD_Y, alpha(C.white, 0.06))
}

/** The road, with the pits cut out of it. */
function road(g: Draw, v: View, d: number, gaps: { sx: number; len: number }[]): void {
  const deck = g.lin(0, ROAD_Y, 0, v.y1, [
    [0, '#4a4262'],
    [1, '#241f38'],
  ])
  // Solid runs between the pits.
  const cuts = gaps.map((p) => [p.sx, p.sx + p.len] as const).sort((a, b) => a[0] - b[0])
  let at = v.x0 - 10
  const runs: [number, number][] = []
  for (const [a, b] of cuts) {
    if (a > at) runs.push([at, a])
    at = Math.max(at, b)
  }
  runs.push([at, v.x1 + 10])
  for (const [a, b] of runs) {
    g.rect(a, ROAD_Y, b - a, v.y1 - ROAD_Y + 20, deck)
    g.ctx.save()
    g.ctx.beginPath()
    g.ctx.rect(a, ROAD_Y - 30, b - a, v.y1 - ROAD_Y + 60)
    g.ctx.clip()
    // Lane dashes scroll past to sell the speed.
    repeatX(d, 180, v.x0, v.x1, (x) => g.rrect(x, ROAD_Y + 86, 100, 14, 7, alpha(C.yellow, 0.55)))
    // Kerb.
    g.rect(a, ROAD_Y - 4, b - a, 26, '#efe9fb')
    repeatX(d, 100, v.x0, v.x1, (x, i) => {
      if (i % 2)
        g.poly([x, ROAD_Y - 4, x + 50, ROAD_Y - 4, x + 40, ROAD_Y + 22, x - 10, ROAD_Y + 22], C.ink)
    })
    g.rect(a, ROAD_Y + 22, b - a, 6, alpha('#000000', 0.35))
    g.ctx.restore()
    // Lips: the cut face of the road at each pit edge.
    for (const [p, q] of cuts) {
      if (Math.abs(b - p) < 1) g.rect(p - 14, ROAD_Y - 4, 14, v.y1 - ROAD_Y + 20, '#2d2742')
      if (Math.abs(a - q) < 1) g.rect(q, ROAD_Y - 4, 10, v.y1 - ROAD_Y + 20, '#5a5277')
    }
  }
  // Hazard posts on both lips of each pit.
  for (const p of gaps) {
    for (const xx of [p.sx - 10, p.sx + p.len + 6]) {
      g.rrect(xx - 9, ROAD_Y - 92, 18, 92, 7, C.white)
      g.rect(xx - 9, ROAD_Y - 72, 18, 14, C.orange)
      g.rect(xx - 9, ROAD_Y - 42, 18, 14, C.orange)
      g.circle(xx, ROAD_Y - 96, 9, C.orange)
    }
  }
}

function brick(g: Draw, x: number, y: number, w: number, h: number, c: string): void {
  g.rrect(x + 2, y + 2, w - 4, h - 4, 7, shade(c, -0.25))
  g.rrect(x + 2, y + 2, w - 4, h - 9, 7, c)
  g.rect(x + 8, y + 7, w - 16, 5, alpha('#ffffff', 0.22))
}

const BRICK = '#cf7a45'

function wall(g: Draw, face: number, shake: number): void {
  const x = face + shake
  const bw = WALL_W / 2
  const rows = Math.round(WALL_H / 52)
  g.shadow(x + WALL_W / 2, ROAD_Y + 4, 80, 12, 0.35)
  for (let r = 0; r < rows; r++) {
    const y = ROAD_Y - (r + 1) * 52
    const off = r % 2 ? bw / 2 : 0
    for (let c = -1; c <= 2; c++) {
      const bx = x + c * bw + off
      const lo = Math.max(x, bx)
      const hi = Math.min(x + WALL_W, bx + bw)
      if (hi <= lo + 1) continue
      brick(g, lo, y, hi - lo, 52, shade(BRICK, ((r * 7 + c * 3) % 5) * 0.04 - 0.08))
    }
  }
  // Hazard band on top, and a boost sign: walls want speed.
  const top = ROAD_Y - WALL_H
  g.rect(x, top - 24, WALL_W, 24, C.yellow)
  for (let i = 0; i < 4; i++)
    g.poly(
      [x + i * 32, top, x + i * 32 + 16, top, x + i * 32 + 30, top - 24, x + i * 32 + 14, top - 24],
      C.ink,
    )
}

/** A smashed wall: a broken stump and bricks on the road. */
function rubble(g: Draw, face: number, i: number): void {
  for (let k = 0; k < 3; k++) {
    const h = 26 + hash01(i, k, 3) * 40
    brick(g, face + k * 40, ROAD_Y - h, 40, h, shade(BRICK, -0.12 * k))
  }
  for (let k = 0; k < 4; k++) {
    const bx = face + 140 + hash01(i, k, 4) * 260
    g.at(bx, ROAD_Y - 12, (hash01(i, k, 5) - 0.5) * 0.8, () =>
      brick(g, -22, -14, 44, 28, shade(BRICK, -0.1)),
    )
  }
}

/** Bricks flying off the wall just smashed (course-anchored, so they scroll with the road). */
function flyingBricks(g: Draw, sx: number, t: number, seedI: number): void {
  if (t < 0 || t > 1.1) return
  for (let k = 0; k < 12; k++) {
    const vx = 300 + hash01(seedI, k, 6) * 700
    const vy = -300 - hash01(seedI, k, 7) * 700
    const x = sx + 40 + vx * t
    const y = ROAD_Y - 40 - hash01(seedI, k, 8) * WALL_H * 0.8 + vy * t + 1500 * t * t
    if (y > ROAD_Y - 10) continue
    const s = 0.6 + hash01(seedI, k, 9) * 0.6
    g.at(x, y, t * (hash01(seedI, k, 10) - 0.5) * 18, () =>
      brick(g, -26 * s, -16 * s, 52 * s, 32 * s, BRICK),
    )
  }
}

function finishLine(g: Draw, x: number, v: View, time: number): void {
  const top = Math.max(v.y0 + 60, ROAD_Y - 400)
  // Two posts and a checkered banner.
  for (const px of [x - 70, x + 62]) {
    g.rrect(px, top, 14, ROAD_Y - top, 6, '#d8d3ea')
    g.rect(px + 3, top, 4, ROAD_Y - top, alpha(C.white, 0.6))
  }
  const wave = Math.sin(time * 4) * 6
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 6; c++) {
      g.rect(
        x - 70 + c * 24,
        top + 10 + r * 24 + (c % 2 ? wave : -wave) * 0.3,
        24,
        24,
        (r + c) % 2 ? '#f5f5f8' : C.ink,
      )
    }
  g.text('FINISH', x, top - 32, {
    size: 40,
    weight: 700,
    color: C.yellow,
    drop: alpha('#000', 0.5),
  })
  // Checkered line across the road.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++)
      g.rect(x - 40 + c * 20, ROAD_Y - 4 + r * 13, 20, 13, (r + c) % 2 ? '#f5f5f8' : C.ink)
}

function tyre(g: Draw, side: Side, x: number, y: number, spin: number): void {
  g.circle(x, y, TYRE, '#15111d')
  for (let k = 0; k < 10; k++) {
    const a = spin + (k * Math.PI) / 5
    g.at(x + Math.cos(a) * (TYRE - 4), y + Math.sin(a) * (TYRE - 4), a, () =>
      g.rrect(-7, -11, 14, 22, 4, '#2b2437'),
    )
  }
  g.circle(x, y, TYRE * 0.6, '#3a3350')
  g.circle(x, y, TYRE * 0.5, SIDE[side].light)
  for (let k = 0; k < 5; k++) {
    const a = spin + (k * Math.PI * 2) / 5
    g.circle(
      x + Math.cos(a) * TYRE * 0.3,
      y + Math.sin(a) * TYRE * 0.3,
      5,
      shade(SIDE[side].main, -0.3),
    )
  }
  g.circle(x, y, 9, C.white)
}

/** The monster truck, in its own frame: centre of the chassis at x = 0, the road at y = 0, up is -y. */
function truckBody(g: Draw, side: Side, t: Truck, o: LaneView): void {
  const col = SIDE[side].main
  const spin = t.x / TYRE
  // Boost flame behind the bed.
  if (t.boosting) {
    for (let i = 0; i < 4; i++) {
      const k = (o.time * 5 + i / 4) % 1
      const len = 90 + 70 * (1 - k)
      g.poly(
        [-176, -170 - 6 * k, -176 - len, -150 + 8 * Math.sin(o.time * 40 + i), -176, -122 + 6 * k],
        alpha(i % 2 ? '#fff1a0' : C.orange, 0.85 * (1 - k)),
      )
    }
  }
  // Suspension and wheels.
  for (const wx of [REAR, FRONT]) {
    g.line(wx, -TYRE, wx + 18, -112, '#8f86b3', 12)
    g.line(wx, -TYRE, wx - 18, -112, '#5d5578', 12)
  }
  tyre(g, side, REAR, -TYRE, spin)
  tyre(g, side, FRONT, -TYRE, spin)
  // Chassis rail.
  g.rrect(-172, -124, 292, 26, 10, '#221c33')
  // Bed: a glossy team-coloured box with racing stripes and the team mark.
  g.rrect(-176, -214, 156, 96, 18, shade(col, -0.4))
  g.rrect(-176, -220, 156, 92, 18, col)
  g.clip(-176, -220, 156, 92, 18, () => {
    g.rect(-176, -186, 156, 14, alpha(C.white, 0.85))
    g.rect(-176, -168, 156, 6, alpha(C.white, 0.85))
  })
  g.rrect(-170, -216, 144, 22, 11, alpha(C.white, 0.22))
  g.sideMark(side, -98, -146, 14, C.white)
  // Exhaust stacks.
  for (const ex of [-30, -14]) {
    g.rrect(ex, -268, 11, 70, 5, '#c9c4dc')
    g.rect(ex + 2, -268, 3, 70, alpha(C.white, 0.6))
  }
  // Cab with the driver in the window.
  g.path(
    (p) => {
      p.moveTo(-20, -124)
      p.lineTo(-20, -218)
      p.quadraticCurveTo(-20, -244, 6, -244)
      p.lineTo(52, -244)
      p.quadraticCurveTo(70, -244, 80, -222)
      p.lineTo(104, -170)
      p.lineTo(104, -124)
      p.closePath()
    },
    g.lin(0, -244, 0, -124, [
      [0, shade(col, 0.3)],
      [0.55, shade(col, 0.05)],
      [1, shade(col, -0.3)],
    ]),
    shade(col, -0.55),
    4,
  )
  g.path((p) => {
    p.moveTo(-4, -170)
    p.lineTo(-4, -222)
    p.lineTo(50, -226)
    p.quadraticCurveTo(62, -226, 68, -214)
    p.lineTo(86, -170)
    p.closePath()
  }, '#9fe3ff')
  const mood =
    t.state === 'bump' ? 'dizzy' : t.state === 'fall' ? 'wow' : t.boosting ? 'grin' : 'happy'
  g.ctx.save()
  g.ctx.beginPath()
  g.ctx.rect(-4, -232, 92, 64)
  g.ctx.clip()
  g.blob(32, -184, 30, shade(col, 0.1), { mood, look: [0.9, 0], cheeks: true })
  g.ctx.restore()
  g.alpha(0.45, () => g.poly([6, -222, 26, -222, 0, -172, -4, -172, -4, -210], '#fff'))
  // Steel ram at the front: the bumper face is the truck's front (TRUCK_HALF). It glows at smashing speed.
  if (t.v >= WALL_V && t.state === 'run')
    g.rrect(88, -180, 42, 122, 16, alpha(C.yellow, 0.35 + 0.2 * Math.sin(o.time * 30)))
  g.rrect(96, -168, 24, 98, 8, '#8f89a6')
  for (let k = 0; k < 4; k++) g.rect(96, -160 + k * 24, 24, 12, k % 2 ? C.yellow : C.ink)
  g.rect(100, -166, 4, 92, alpha(C.white, 0.5))
  // Headlight.
  g.circle(98, -150, 12, '#fff3c4')
  if (t.boosting) g.circle(98, -150, 22, alpha(C.yellow, 0.35))
}

function truckAt(g: Draw, side: Side, t: Truck, o: LaneView): void {
  let y = ROAD_Y - t.y
  let a = 1
  let ang = 0
  if (t.state === 'rise') {
    // Lowered back onto the road by a crane, blinking.
    const k = Math.max(0, t.timer) / RISE_T
    y = ROAD_Y - 240 * k * k
    a = Math.sin(o.time * 40) > -0.3 ? 1 : 0.4
    g.line(TRUCK_X - 40, y - 240, TRUCK_X - 40, -400, '#c9c4dc', 6)
    g.line(TRUCK_X - 40, y - 240, TRUCK_X - 120, y - 214, '#c9c4dc', 4)
    g.line(TRUCK_X - 40, y - 240, TRUCK_X + 40, y - 236, '#c9c4dc', 4)
    g.circle(TRUCK_X - 40, y - 244, 12, C.yellow)
  } else if (t.state === 'fall') ang = Math.min(0.5, -t.y / 300)
  else if (t.y > 0) ang = Math.max(-0.12, Math.min(0.12, -t.vy / 4000))
  // Squash on landing and on a bump.
  const sinceLand = o.time - o.landAt
  const sinceBump = o.time - o.bumpAt
  let sx = 1
  let sy = 1
  if (sinceLand >= 0 && sinceLand < 0.3) {
    const q = Math.sin((sinceLand / 0.3) * Math.PI) * (1 - sinceLand / 0.3)
    sx = 1 + 0.12 * q
    sy = 1 - 0.14 * q
  }
  if (sinceBump >= 0 && sinceBump < 0.35) {
    const q = Math.sin((sinceBump / 0.35) * Math.PI)
    sx *= 1 - 0.1 * q
  }
  if (t.state !== 'fall' && t.state !== 'rise') {
    const h = Math.max(0, t.y)
    g.shadow(TRUCK_X - 20, ROAD_Y + 6, 170 * Math.max(0.4, 1 - h / 360), 14, 0.4)
  }
  g.alpha(a, () => g.at(TRUCK_X, y, ang, () => truckBody(g, side, t, o), sx, sy))
}

/** Boost meter at the player's own edge: yellow while it burns, a tick where walls need it. */
function boostMeter(g: Draw, side: Side, t: Truck, time: number, wallNear: boolean): void {
  const x0 = 230
  const len = 560
  const y = 826
  const f = Math.max(0, Math.min(1, t.boost / BOOST_MAX))
  g.rrect(x0 - 26, y - 38 + 8, len + 52, 76, 38, shade(SIDE[side].main, -0.6))
  g.rrect(x0 - 26, y - 38, len + 52, 76, 38, alpha(C.ink, 0.92))
  g.rrect(x0, y - 16, len, 32, 16, alpha(C.white, 0.1))
  if (f > 0) {
    const col = t.boosting ? C.yellow : SIDE[side].light
    const pulse = t.boosting ? 0.85 + 0.15 * Math.sin(time * 30) : 1
    g.rrect(x0, y - 16, Math.max(32, f * len), 32, 16, alpha(col, pulse))
    g.rrect(x0 + 6, y - 12, Math.max(20, f * len - 12), 9, 5, alpha(C.white, 0.35))
  }
  // Bolt badge.
  const bx = x0 - 60
  const glow = wallNear && !t.boosting ? 0.5 + 0.5 * Math.sin(time * 10) : 0
  g.circle(bx, y + 4, 40, shade(t.boosting ? C.yellow : SIDE[side].main, -0.45))
  g.circle(bx, y, 40, t.boosting ? C.yellow : SIDE[side].main)
  if (glow > 0) g.ring(bx, y, 46 + glow * 6, alpha(C.yellow, glow), 6)
  g.poly(
    [bx + 6, y - 26, bx - 14, y + 4, bx - 1, y + 4, bx - 6, y + 26, bx + 14, y - 4, bx + 1, y - 4],
    C.white,
  )
}

/** Race track strip: both trucks on it, the flag at the end. */
function progress(g: Draw, side: Side, me: Truck, rival: Truck): void {
  const x0 = 170
  const len = 660
  const y = 172
  const xOf = (d: number) => x0 + Math.max(0, Math.min(1, d / FINISH)) * len
  const rs = (1 - side) as Side
  g.rrect(x0 - 24, y - 26, len + 70, 52, 26, alpha(C.ink, 0.8))
  g.rrect(x0, y - 7, len, 14, 7, alpha(C.white, 0.14))
  g.rrect(x0, y - 7, Math.max(14, xOf(me.x) - x0), 14, 7, SIDE[side].main)
  // Flag.
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      g.rect(x0 + len + 12 + c * 12, y - 12 + r * 12, 12, 12, (r + c) % 2 ? C.white : C.ink)
  // The rival as a ghost, then me on top.
  g.sideMark(rs, xOf(rival.x), y, 13, alpha(SIDE[rs].main, 0.9))
  g.circle(xOf(me.x), y + 3, 19, alpha('#000', 0.35))
  g.sideMark(side, xOf(me.x), y, 17, C.white)
  g.sideMark(side, xOf(me.x), y, 10, SIDE[side].main)
}

export function drawLane(g: Draw, side: Side, v: View, o: LaneView): void {
  const t = o.truck
  const d = t.x
  skyline(g, side, v, d, o.time)
  const obs = visible(o, v)
  const gaps = obs.filter((p) => p.kind === 'gap')
  for (const p of gaps) pitInside(g, p.sx, p.len, v, o.time)
  // A falling truck sinks behind the road; otherwise it drives on top.
  const inPit = t.state === 'fall'
  if (inPit) truckAt(g, side, t, o)
  road(g, v, d, gaps)
  const fx = TRUCK_X + (FINISH - d)
  if (fx < v.x1 + 120) finishLine(g, fx, v, o.time)
  for (const p of obs) {
    if (p.kind !== 'wall') continue
    if (p.i < t.k) rubble(g, p.sx, p.i)
    else {
      const sb = o.time - o.bumpAt
      const shake = p.i === t.k && sb >= 0 && sb < 0.4 ? Math.sin(sb * 60) * 8 * (1 - sb / 0.4) : 0
      wall(g, p.sx, shake)
    }
  }
  if (!inPit) truckAt(g, side, t, o)
  flyingBricks(g, TRUCK_X + (o.smashX - d), o.time - o.smashAt, Math.floor(o.smashX))
  // Speed lines while boosting.
  if (t.boosting) {
    for (let k = 0; k < 7; k++) {
      const yy = 260 + hash01(3, k, Math.floor(o.time * 12)) * 360
      const xx = ((o.time * 2600 + k * 380) % 1300) - 150
      g.line(1000 - xx, yy, 1000 - xx + 140, yy, alpha(C.white, 0.25), 5)
    }
  }
  hud(g, side, o, obs)
}

function hud(g: Draw, side: Side, o: LaneView, obs: ReturnType<typeof visible>): void {
  const t = o.truck
  const left = metres(FINISH - Math.min(FINISH, t.x))
  scorePill(g, side, String(left), 'm to go', LANE_W / 2, 74)
  progress(g, side, t, o.rival)
  const next = obs.find((p) => p.i === t.k)
  const ahead = next ? next.x - t.x : Infinity
  const wallNear = next?.kind === 'wall' && ahead - TRUCK_HALF < 560
  boostMeter(g, side, t, o.time, wallNear)

  if (o.phase === 'ready') {
    card(
      g,
      side,
      o.bot ? 'Ready…' : 'Tap to jump',
      o.bot ? o.name : 'Hold to boost through walls',
      CARD_Y,
      o.since,
      { x: CARD_X },
    )
    return
  }
  if (o.winner !== null) {
    const tEnd = o.time - o.endAt
    const won = o.winner === side
    const gap = metres(Math.max(0, FINISH - t.x))
    const title =
      o.winner === 'draw'
        ? 'Photo finish!'
        : won
          ? o.bot
            ? 'Computer wins!'
            : 'You win!'
          : 'Beaten!'
    const sub =
      o.winner === 'draw'
        ? 'Dead level'
        : won
          ? `${(o.finishT >= 0 ? o.finishT : 0).toFixed(1)} s to the flag`
          : `${gap} m short`
    card(g, side, title, sub, CARD_Y, tEnd - (won ? 0 : 0.2), {
      x: CARD_X,
      color: won ? C.yellow : C.white,
      accent: won ? C.yellow : SIDE[side].main,
    })
    if (won) g.emoji('🏆', CARD_X, CARD_Y - 170, 96 * outBack(prog(tEnd, 0.3, 0.7)))
    return
  }
  if (t.state === 'bump') {
    card(
      g,
      side,
      'Ouch!',
      o.bot ? 'Too slow for the wall' : 'Hold to boost, then hit it',
      CARD_Y,
      o.time - o.bumpAt,
      { x: CARD_X, accent: C.orange },
    )
    return
  }
  if (t.state === 'fall' || t.state === 'rise') {
    card(
      g,
      side,
      'Into the pit!',
      o.bot ? 'Craning it out…' : 'Tap earlier to jump',
      CARD_Y,
      o.time - o.fallAt,
      { x: CARD_X, accent: C.orange },
    )
    return
  }
  if (!o.bot && next && t.state === 'run') {
    // Teach the two verbs right before the obstacle that needs them.
    const yellow = { color: C.ink, bg: alpha(C.yellow, 0.95), size: 42 }
    if (next.kind === 'wall' && wallNear && !t.boosting && t.v < WALL_V)
      chip(g, 'Hold to boost!', TRUCK_X + 60, 330, yellow)
    if (next.kind === 'gap' && ahead < 420 && ahead > 0 && t.y <= 0)
      chip(g, 'Tap to jump!', TRUCK_X + 60, 330, yellow)
  }
}
