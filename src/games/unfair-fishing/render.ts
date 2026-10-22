import { frame, inFrame, textAngle } from '../../core/frame.ts'
import type { Side } from '../../core/game.ts'
import { clamp, lerp, outBack, outCubic } from '../../core/fx/ease.ts'
import { banner, clock, hudY, namePill } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { alpha, C, mix, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import { mashPulse } from '../../engines/reflex/index.ts'
import { BAND, FISH, type Rod, SURGE_LEN } from './rules.ts'

/** The pond in the middle, in world units. */
const WATER = { x: 60, y: 400, w: 880, h: 1000 }
/** Lily pads, scattered over the water (world units): x, y, radius, flower. */
const PADS: readonly [number, number, number, boolean][] = [
  [170, 540, 50, true],
  [845, 650, 40, false],
  [250, 1190, 42, false],
  [800, 1250, 52, true],
  [560, 760, 30, false],
  [430, 1060, 34, false],
]
/** Rod butt and resting tip, in the angler's frame. */
const BUTT = { x: 790, y: 1690 }
const TIP = { x: 610, y: 1405 }
/** The float hangs here before a cast. */
const HANG = { x: 610, y: 1470 }
/** Score figure, in the angler's frame. */
const SCORE_X = 150
/** Tension bar span and height, in the angler's frame. */
const BAR = { x0: 200, x1: 660, y: 1580 }

export interface View {
  names: [string, string]
  sec: number
  over: boolean
  /** Game time the match ended (-1 while playing). */
  endAt: number
}

export function renderFishing(g: Draw, rods: [Rod, Rod], now: number, v: View): void {
  background(g, now)
  for (const side of [0, 1] as Side[]) inFrame(g, side, () => pier(g))
  for (const side of [0, 1] as Side[]) lane(g, side, rods[side], now)
  const lead = rods[0].points === rods[1].points ? -1 : rods[0].points > rods[1].points ? 0 : 1
  for (const side of [0, 1] as Side[]) {
    const rod = rods[side]
    score(g, side, rod, now, v.over && lead === side)
    namePill(g, side, v.names[side], { active: rod.phase === 'bite' || rod.phase === 'reel' })
  }
  if (!v.over) clock(g, v.sec, MID)
  else if (v.endAt >= 0) {
    const t = now - v.endAt
    g.alpha(clamp(t * 5, 0, 1), () =>
      banner(g, undefined, 'Time!', MID, { size: 64 * outBack(clamp(t / 0.35, 0, 1)) + 1 }),
    )
  }
}

// ---------- the pond ----------

function background(g: Draw, now: number): void {
  const view = g.stage.view
  g.fillView('#123326')
  g.halves(mix('#123326', C.red, 0.3), mix('#123326', C.blue, 0.34))
  // Bushes on the banks.
  for (let i = 0; i < 26; i++) {
    const x = ((i * 337) % 1000) + 10
    const y = view.y + ((i * 523) % Math.max(1, view.h))
    if (y > WATER.y - 60 && y < WATER.y + WATER.h + 60 && x > 20 && x < 980) continue
    for (const [dx, dy, r] of [
      [-16, 4, 16],
      [14, 6, 14],
      [0, -6, 19],
    ] as const) {
      g.circle(x + dx, y + dy, r, alpha('#2f6f3a', 0.45))
    }
  }
  const { x, y, w, h } = WATER
  // Sandy rim, then the water.
  g.rrect(x - 24, y - 24, w + 48, h + 48, 130, '#3b5e3a')
  g.rrect(x - 12, y - 12, w + 24, h + 24, 120, '#c9b07a')
  g.rrect(
    x,
    y,
    w,
    h,
    110,
    g.rad(W / 2, MID, 80, 640, [
      [0, '#3cb3d6'],
      [0.6, '#1f7fa6'],
      [1, '#164f6e'],
    ]),
  )
  // Shallow edge.
  g.rrect(x + 8, y + 8, w - 16, h - 16, 104, undefined, alpha('#bff1ff', 0.18), 10)
  // Ripples drift across; fish shadows glide under the surface.
  for (let i = 0; i < 8; i++) {
    const p = (now * 0.25 + i * 0.137) % 1
    const rx = x + 120 + ((i * 271) % 640)
    const ry = y + 120 + ((i * 397) % 760)
    g.alpha(Math.sin(p * Math.PI) * 0.16, () => g.ring(rx, ry, 16 + p * 46, '#d8f6ff', 3))
  }
  for (let i = 0; i < 4; i++) {
    const span = w - 380
    const k = ((now * (0.05 + i * 0.013) + i * 0.27) % 1) * 2
    const dir = k < 1 ? 1 : -1
    const sx = x + 190 + span * (k < 1 ? k : 2 - k)
    const sy = y + 170 + i * 220 + Math.sin(now * 1.3 + i) * 30
    const sh = alpha('#06222c', 0.32)
    g.ellipse(sx, sy, 64 - i * 6, 20, sh)
    g.poly([sx - dir * 54, sy, sx - dir * 96, sy - 22, sx - dir * 96, sy + 22], sh)
  }
  for (const [px, py, r, flower] of PADS) {
    const bob = Math.sin(now * 1.4 + px) * 3
    g.ellipse(px + 4, py + 6 + bob, r, r * 0.78, alpha('#06222c', 0.35))
    g.path(
      (c) => {
        c.ellipse(px, py + bob, r, r * 0.78, 0, 0.35, Math.PI * 2 - 0.1)
        c.lineTo(px, py + bob)
        c.closePath()
      },
      '#3fae6b',
      '#2a7d4c',
      3,
    )
    g.ellipse(px - r * 0.25, py - r * 0.25 + bob, r * 0.45, r * 0.25, alpha('#ffffff', 0.14))
    if (flower) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2
        g.ellipse(px + Math.cos(a) * 12, py - 6 + bob + Math.sin(a) * 9, 13, 8, C.pink, a)
      }
      g.circle(px, py - 6 + bob, 8, C.yellow)
    }
  }
  // Reeds at the corners.
  for (const [cx, cy, dir] of [
    [90, 430, 1],
    [910, 1370, -1],
    [930, 440, 1],
    [70, 1360, -1],
  ] as const) {
    for (let k = 0; k < 5; k++) {
      const bx = cx + (k - 2) * 16
      const sway = Math.sin(now * 1.2 + k) * 8
      g.line(bx, cy, bx + sway + (k - 2) * 6, cy - dir * (80 + k * 14), '#4f8f3a', 7)
      if (k % 2 === 0)
        g.ellipse(bx + sway + (k - 2) * 6, cy - dir * (70 + k * 14), 7, 18, '#7a4b22')
    }
  }
  g.vignette(0.4)
}

/** A short wooden pier at the angler's edge of the pond. Drawn in the angler's frame. */
function pier(g: Draw): void {
  const x0 = 380
  const x1 = 700
  const y0 = 1350
  for (const px of [x0 + 26, x1 - 26]) {
    g.rect(px - 11, y0 - 8, 22, 40, '#3e2614')
    g.ellipse(px, y0 + 30, 22, 7, alpha('#bff1ff', 0.3))
  }
  g.shadow((x0 + x1) / 2, y0 + 150, (x1 - x0) * 0.55, 18, 0.3)
  for (let i = 0; i < 5; i++) {
    const y = y0 + i * 30
    g.rrect(x0, y, x1 - x0, 26, 6, i % 2 ? '#b07a42' : '#c98a4b')
    g.rect(x0 + 6, y + 21, x1 - x0 - 12, 5, alpha('#000000', 0.18))
    g.circle(x0 + 16, y + 13, 3, '#5e3a1c')
    g.circle(x1 - 16, y + 13, 3, '#5e3a1c')
  }
}

// ---------- one angler ----------

interface P {
  x: number
  y: number
}

/** Where the float is now, in the angler's frame. */
function floatAt(rod: Rod, now: number): P {
  if (rod.phase === 'idle') return { x: HANG.x, y: HANG.y + Math.sin(now * 2) * 6 }
  if (rod.phase === 'cast') {
    const t = clamp(rod.t / 0.45, 0, 1)
    return {
      x: lerp(TIP.x, rod.x, t),
      y: lerp(TIP.y, rod.y, t) - Math.sin(t * Math.PI) * 220,
    }
  }
  // Reeling draws the float toward the pier; a surge yanks it back out.
  const pull = rod.phase === 'reel' ? outCubic(rod.reel) * 0.85 : 0
  const jerk = rod.phase === 'reel' && rod.surge > 0 ? Math.sin(now * 40) * 10 : 0
  return {
    x: lerp(rod.x, TIP.x - 60, pull) + jerk,
    y: lerp(rod.y, 1330, pull) + floatBob(rod, now),
  }
}

function floatBob(rod: Rod, now: number): number {
  switch (rod.phase) {
    case 'bite':
      // The float dips and jerks.
      return 22 * Math.max(0, Math.sin(now * 24))
    case 'reel':
      return Math.sin(now * 14) * 6
    default:
      return Math.sin(now * 2.6) * 5
  }
}

/** The rod tip, bent toward the fish by the line's tension. */
function tipAt(rod: Rod, fl: P): P {
  if (rod.phase !== 'reel') return TIP
  const dx = fl.x - TIP.x
  const dy = fl.y - TIP.y
  const d = Math.hypot(dx, dy) || 1
  const k = 20 + rod.tension * 60
  return { x: TIP.x + (dx / d) * k, y: TIP.y + (dy / d) * k }
}

function lane(g: Draw, side: Side, rod: Rod, now: number): void {
  inFrame(g, side, () => {
    const fl = floatAt(rod, now)
    const tip = tipAt(rod, fl)
    if (rod.phase === 'reel') fish(g, rod, fl, now)
    if (rod.phase !== 'won' && rod.phase !== 'lost') line(g, side, rod, tip, fl)
    else if (rod.phase === 'lost') brokenLine(g, side, rod, tip)
    if (rod.phase !== 'lost' || rod.t < 0.2) bobber(g, side, rod, fl, now)
    rodPole(g, side, rod, tip, now)
    if (rod.phase === 'won') landed(g, rod, fl)
    // Online, the tap prompts are only for the angler's own phone.
    const mine = g.viewer === null || g.viewer === side
    if (rod.phase === 'reel') meter(g, side, rod, now, mine)
    else if (mine) status(g, side, rod, now)
  })
}

function rodPole(g: Draw, side: Side, rod: Rod, tip: P, now: number): void {
  const col = SIDE[side]
  const bend = rod.phase === 'reel' ? rod.tension : 0.1
  const mx = (BUTT.x + tip.x) / 2 + 40 * bend
  const my = (BUTT.y + tip.y) / 2 + 30 * bend
  const stroke = (c: string, lw: number) =>
    g.path(
      (p) => {
        p.moveTo(BUTT.x, BUTT.y)
        p.quadraticCurveTo(mx, my, tip.x, tip.y)
      },
      undefined,
      c,
      lw,
    )
  g.shadow(BUTT.x - 40, BUTT.y + 30, 110, 16, 0.3)
  stroke(shade(col.main, -0.55), 22)
  stroke(col.main, 13)
  stroke(alpha('#ffffff', 0.35), 4)
  // Cork grip and the reel, whose crank spins as you mash.
  g.line(BUTT.x, BUTT.y, BUTT.x - 30, BUTT.y - 50, '#c9a06a', 26)
  const rx = BUTT.x - 58
  const ry = BUTT.y - 82
  const spin = rod.mash.taps * 1.1 + (rod.phase === 'reel' ? 0 : now * 0.2)
  g.disc(rx, ry, 30, '#d6d9e6', 6)
  g.circle(rx, ry, 9, '#5d6380')
  const hx = rx + Math.cos(spin) * 34
  const hy = ry + Math.sin(spin) * 34
  g.line(rx, ry, hx, hy, '#5d6380', 8)
  g.ball(hx, hy, 11, rod.phase === 'reel' && mashPulse(rod.mash, now) > 0 ? C.yellow : C.white)
  g.circle(tip.x, tip.y, 8, C.white)
}

function line(g: Draw, side: Side, rod: Rod, tip: P, fl: P): void {
  let sag = 46
  let col = alpha(C.white, 0.75)
  let lw = 4
  if (rod.phase === 'reel') {
    // Taut line: straighter and hotter as the tension climbs.
    sag = 30 * (1 - rod.tension)
    const inBand = rod.tension >= BAND[0] && rod.tension <= BAND[1]
    col = inBand
      ? alpha(C.white, 0.9)
      : rod.tension > BAND[1]
        ? C.red
        : alpha(SIDE[side].light, 0.6)
    lw = 5
  } else if (rod.phase === 'idle') sag = 8
  g.path(
    (c) => {
      c.moveTo(tip.x, tip.y)
      c.quadraticCurveTo((tip.x + fl.x) / 2 + sag * 0.4, (tip.y + fl.y) / 2 + sag, fl.x, fl.y)
    },
    undefined,
    col,
    lw,
  )
}

/** After a snap or a slack, the loose line curls back toward the rod. */
function brokenLine(g: Draw, side: Side, rod: Rod, tip: P): void {
  const t = clamp(rod.t / 0.6, 0, 1)
  const len = 260 * (1 - outCubic(t))
  if (len < 4) return
  g.path(
    (c) => {
      c.moveTo(tip.x, tip.y)
      c.quadraticCurveTo(tip.x - 90, tip.y - len * 0.5, tip.x - 30, tip.y - len)
    },
    undefined,
    alpha(SIDE[side].light, 0.7 * (1 - t)),
    4,
  )
}

function bobber(g: Draw, side: Side, rod: Rod, p: P, now: number): void {
  const col = SIDE[side].main
  const biting = rod.phase === 'bite'
  const inWater = rod.phase !== 'idle' && rod.phase !== 'cast'
  if (inWater) {
    const pulse = (now * (biting ? 3 : 0.8)) % 1
    g.alpha(1 - pulse, () =>
      g.ring(
        p.x,
        p.y + 6,
        30 + pulse * (biting ? 70 : 40),
        biting ? C.yellow : '#d8f6ff',
        biting ? 6 : 3,
      ),
    )
    g.ellipse(p.x, p.y + 12, 30, 10, alpha('#0b2a33', 0.4))
  } else g.shadow(p.x, p.y + 40, 20, 6, 0.3)
  // Red-or-blue cap, white belly, an antenna.
  g.line(p.x, p.y - 18, p.x, p.y - 48, C.white, 6)
  g.circle(p.x, p.y - 50, 6, biting ? C.yellow : col)
  g.ball(p.x, p.y, 24, C.white, 0.8)
  g.path(
    (c) => {
      c.arc(p.x, p.y, 24, Math.PI, 0)
      c.closePath()
    },
    biting ? C.yellow : col,
  )
  g.ellipse(p.x - 8, p.y - 12, 8, 5, alpha('#ffffff', 0.6), -0.5)
}

/** The fish on the line: it leaps when hooked, then fights under the surface. */
function fish(g: Draw, rod: Rod, p: P, now: number): void {
  const f = FISH[rod.kind]
  if (!f) return
  const size = 96 + rod.kind * 30
  if (rod.t < 0.5) {
    // The hook-set leap.
    const t = rod.t / 0.5
    const y = p.y - 60 - Math.sin(t * Math.PI) * 200
    g.emoji(
      f.ch,
      p.x + (t - 0.5) * 80,
      y,
      size * (1 + 0.2 * Math.sin(t * Math.PI)),
      (t - 0.5) * 1.6,
    )
    return
  }
  const dive = rod.surge > 0 ? (rod.surge / SURGE_LEN) * 60 : 0
  const x = p.x + Math.sin(now * 4) * 30
  const y = p.y - 90 - dive + Math.sin(now * 9) * 8
  g.ellipse(x, y + 10, size * 0.42, size * 0.18, alpha('#06222c', 0.4))
  g.alpha(0.7, () => g.emoji(f.ch, x, y, size, Math.sin(now * 4) * 0.25))
  // Splashes where the fish thrashes.
  if (rod.surge > 0) g.ring(x, y, size * 0.6, alpha('#d8f6ff', 0.4), 4)
}

/** A landed fish flies up out of the water and drops into your score. */
function landed(g: Draw, rod: Rod, p: P): void {
  const f = FISH[rod.kind]
  if (!f) return
  const t = clamp(rod.t / 0.65, 0, 1)
  if (t >= 1) return
  const e = outCubic(t)
  const tx = SCORE_X
  const ty = 1700
  const x = lerp(p.x, tx, e)
  const y = lerp(p.y, ty, e) - Math.sin(t * Math.PI) * 360
  const size = (110 + rod.kind * 30) * (1 - 0.5 * t)
  g.emoji(f.ch, x, y, size, t * 7)
}

/** Tension bar and reel progress: both upright for the angler. */
function meter(g: Draw, side: Side, rod: Rod, now: number, prompt = true): void {
  const { x0, x1, y } = BAR
  const w = x1 - x0
  const angle = textAngle(g, side)
  g.rrect(x0 - 14, y - 34, w + 28, 92, 26, alpha(C.ink, 0.85))
  // Track: pale slack end, red snap end, green band.
  g.rrect(
    x0,
    y - 20,
    w,
    40,
    16,
    g.lin(x0, 0, x1, 0, [
      [0, '#5b6c8f'],
      [BAND[0], C.ink3],
      [BAND[1], C.ink3],
      [1, C.redDark],
    ]),
  )
  g.rrect(x0 + w * BAND[0], y - 20, w * (BAND[1] - BAND[0]), 40, 8, C.green)
  g.rect(x0 + w * BAND[0], y - 20, w * (BAND[1] - BAND[0]), 12, alpha('#ffffff', 0.25))
  const nx = x0 + clamp(rod.tension, -0.03, 1.03) * w
  const inside = rod.tension >= BAND[0] && rod.tension <= BAND[1]
  const shake = inside ? 0 : Math.sin(now * 50) * 4
  const col = inside ? C.white : C.yellow
  g.poly([nx - 16 + shake, y - 40, nx + 16 + shake, y - 40, nx + shake, y - 18], col)
  g.rrect(nx - 4 + shake, y - 22, 8, 44, 4, col)
  // Reel progress: how close the fish is.
  const py = y + 36
  g.rrect(x0, py - 7, w, 14, 7, C.ink3)
  g.rrect(x0, py - 7, Math.max(14, w * rod.reel), 14, 7, SIDE[side].main)
  g.text('slack', x0 + 44, y - 60, { size: 34, weight: 600, color: alpha(C.white, 0.6), angle })
  g.text('snap', x1 - 40, y - 60, { size: 34, weight: 600, color: alpha(C.white, 0.6), angle })
  const p = mashPulse(rod.mash, now, 0.12)
  if (!prompt) return
  // Beside the pier on the bank, not over its planks.
  g.text('MASH!', 205, y - 132, {
    size: 64 * (1 + p * 0.12),
    weight: 700,
    color: C.white,
    stroke: SIDE[side].dark,
    strokeWidth: 14,
    angle,
  })
}

/** The big prompt between the pier and the HUD. */
function status(g: Draw, side: Side, rod: Rod, now: number): void {
  const angle = textAngle(g, side)
  const x = W / 2 - 80
  const y = BAR.y
  const o = { weight: 700, color: C.white, stroke: SIDE[side].dark, strokeWidth: 14, angle }
  if (rod.phase === 'idle') {
    const a = clamp(rod.t * 4, 0, 1)
    g.alpha(a, () => g.text('TAP TO CAST', x, y, { ...o, size: 54 }))
  } else if (rod.phase === 'wait') {
    g.text('wait for it…', x, y, { size: 46, weight: 600, color: alpha(C.white, 0.55), angle })
  } else if (rod.phase === 'bite') {
    g.text('TAP!', x, y - 10, {
      ...o,
      size: 104 + Math.sin(now * 24) * 8,
      color: C.yellow,
      stroke: C.ink,
    })
  }
}

// ---------- HUD ----------

function score(g: Draw, side: Side, rod: Rod, now: number, winner: boolean): void {
  // The landed fish drops into the score at about 0.6 s.
  const land = rod.phase === 'won' ? rod.t - 0.6 : -1
  const bump = land >= 0 && land < 0.3 ? 1 - land / 0.3 : 0
  const s = 1 + 0.4 * bump + (winner ? 0.12 * Math.abs(Math.sin(now * 6)) : 0)
  const p = frame(side, SCORE_X, H)
  g.forSide(side, p.x, hudY(g, side), () => {
    if (winner || bump > 0) g.circle(0, 2, 66, alpha(SIDE[side].main, 0.3))
    g.text(rod.points, 0, 4, {
      size: 80 * s,
      weight: 700,
      color: bump > 0 ? C.white : SIDE[side].main,
      stroke: alpha(C.ink, 0.6),
      strokeWidth: 12,
    })
  })
}
