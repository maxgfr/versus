import type { Side } from '../../core/game.ts'
import { banner, hudY } from '../../core/hud.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { alpha, C, SIDE, shade } from '../../core/render/palette.ts'
import { H, MID, W } from '../../core/stage.ts'
import {
  COOL,
  type Fallen,
  FULL,
  HIT_H,
  originX,
  type Preview,
  type Shuri,
  SHURI_Z,
  type Stalk,
  STUMP,
  type State,
  swayOf,
  THROW_Y,
} from './rules.ts'

const GREEN = '#6fcf6a'
const GREEN_DARK = '#2e7d3a'
const GOLD_STALK = '#f2c14e'
const GOLD_DARK = '#b6831f'
/** Screen lift per unit of height: tall things lean toward the top of the table. */
const LIFT = 0.3

/** 0..1 that is 1 at `t0` and fades to 0 over `dur`. */
const since = (t: number, t0: number, dur: number): number => {
  const d = t - t0
  return d < 0 || d > dur ? 0 : 1 - d / dur
}

/** Moonlit grove floor: dark moss, a few leaves and stones, and a tatami dojo at each end in its team colour. */
export function drawGrove(g: Draw): void {
  g.fillView('#0f2219')
  const v = g.stage.view
  for (let y = Math.floor(v.y / 140) * 140; y < v.y + v.h; y += 140) {
    if (Math.abs(Math.round(y / 140)) % 2 === 0)
      g.rect(v.x - 2, y, v.w + 4, 140, alpha('#2f6a45', 0.25))
  }
  // Grass tufts and fallen leaves, from fixed formulas so every device matches.
  for (let i = 0; i < 24; i++) {
    const x = (i * 337 + 40) % 1000
    const y = 400 + ((i * 631) % 1000)
    const col = alpha('#4f9a62', 0.5)
    g.line(x - 9, y, x - 13, y - 20, col, 5)
    g.line(x, y, x, y - 26, col, 5)
    g.line(x + 9, y, x + 13, y - 18, col, 5)
  }
  for (let i = 0; i < 30; i++) {
    const x = (i * 271 + 90) % 1000
    const y = 380 + ((i * 487 + 60) % 1040)
    g.at(x, y, i * 1.7, () =>
      g.ellipse(0, 0, 14, 6, alpha(i % 4 === 0 ? '#b8a24a' : '#5aa86a', 0.4)),
    )
  }
  for (let i = 0; i < 6; i++) {
    const x = (i * 433 + 150) % 1000
    const y = 450 + ((i * 557) % 900)
    g.shadow(x + 6, y + 10, 26, 10, 0.4)
    g.ellipse(x, y, 24, 17, '#4a5560')
    g.ellipse(x - 6, y - 5, 10, 6, alpha('#ffffff', 0.16))
  }
  // Moonlight across the band.
  g.fillView(
    g.rad(W / 2, MID, 80, 760, [
      [0, alpha('#d8f0ff', 0.12)],
      [1, alpha('#d8f0ff', 0)],
    ]),
  )
  for (const side of [0, 1] as Side[]) drawDojo(g, side)
  g.vignette(0.45)
}

/** Each player's end: tatami mats in the team tint, edged with the team colour along the throw line. */
function drawDojo(g: Draw, side: Side): void {
  const v = g.stage.view
  const line = THROW_Y[side] ?? 0
  const col = SIDE[side]
  const y0 = side === 0 ? line - 30 : v.y - 4
  const y1 = side === 0 ? v.y + v.h + 4 : line + 30
  g.rect(v.x - 2, y0, v.w + 4, y1 - y0, shade(col.main, -0.72))
  // Woven mats.
  for (let x = Math.floor(v.x / 250) * 250; x < v.x + v.w; x += 250) {
    g.rect(x, y0, 4, y1 - y0, alpha('#000000', 0.3))
    for (let y = y0 + 12; y < y1; y += 16) g.rect(x + 6, y, 240, 2, alpha('#ffffff', 0.035))
  }
  // The edge strip along the line.
  const ey = side === 0 ? y0 : y1 - 22
  g.rect(v.x - 2, ey, v.w + 4, 22, shade(col.main, -0.25))
  g.rect(v.x - 2, ey + (side === 0 ? 0 : 18), v.w + 4, 4, alpha('#ffffff', 0.25))
  for (let x = 40; x < 1000; x += 120) g.circle(x, ey + 11, 4, alpha('#000000', 0.35))
}

/** One bamboo stalk: shadow, segmented trunk with nodes and sprigs, a leaf crown when grown, or the stump after a cut. */
export function drawStalk(g: Draw, st: Stalk, t: number): void {
  const body = st.gold ? GOLD_STALK : GREEN
  const dark = st.gold ? GOLD_DARK : GREEN_DARK
  const grow = Math.min(1, st.h / FULL)
  const width = 24 + grow * 16
  g.shadow(st.x + 10, st.y + 8, width * 1.1, width * 0.45, 0.45)
  if (st.state === 'stump') {
    const top = st.y - STUMP * LIFT
    g.rrect(st.x - width / 2, top, width, st.y - top + 6, 8, shade(body, -0.25))
    g.rrect(st.x - width / 2 + 5, top, 6, st.y - top, 3, alpha('#ffffff', 0.25))
    // The fresh cut face.
    g.ellipse(st.x, top, width / 2, width * 0.3, shade(body, 0.35))
    g.ellipse(st.x, top, width * 0.32, width * 0.17, '#fff3cf')
    return
  }
  if (st.gold) {
    g.fillView(
      g.rad(st.x, st.y - st.h * LIFT * 0.5, 10, 170, [
        [0, alpha(C.yellow, 0.22 + 0.06 * Math.sin(t * 5))],
        [1, alpha(C.yellow, 0)],
      ]),
    )
  }
  const sway = swayOf(st, t)
  const tx = st.x + sway
  const ty = st.y - st.h * LIFT
  const ready = st.h >= HIT_H
  // Trunk: dark edge, body, a highlight stripe.
  g.line(st.x, st.y, tx, ty, shade(dark, -0.3), width + 8)
  g.line(st.x, st.y, tx, ty, ready ? body : shade(body, -0.15), width)
  g.line(st.x - width * 0.22, st.y - 4, tx - width * 0.22, ty + 4, alpha('#ffffff', 0.4), 5)
  // Nodes every so often, with a sprig on alternate sides.
  const nodes = Math.floor(st.h / 120)
  for (let i = 1; i <= nodes; i++) {
    const f = (i * 120) / Math.max(1, st.h)
    const px = st.x + (tx - st.x) * f
    const py = st.y + (ty - st.y) * f
    g.line(px - width * 0.62, py, px + width * 0.62, py, dark, 6)
    g.line(px - width * 0.5, py - 4, px + width * 0.5, py - 4, alpha('#ffffff', 0.25), 3)
    if (i % 2 === 0 && i < nodes) {
      const sx = i % 4 === 0 ? 1 : -1
      g.at(px + sx * width * 0.5, py, sx > 0 ? -0.5 : Math.PI + 0.5, () =>
        g.ellipse(26, 0, 28, 8, st.gold ? shade(GOLD_STALK, -0.1) : '#58b85a'),
      )
    }
  }
  if (st.h > FULL * 0.7) {
    const k = Math.min(1, (st.h - FULL * 0.7) / (FULL * 0.3))
    const up = Math.atan2(ty - st.y, tx - st.x)
    const leaf = st.gold ? shade(GOLD_STALK, 0.15) : '#7fdc78'
    for (const [a, len, w] of [
      [-1.0, 70, 13],
      [-0.5, 90, 15],
      [0, 100, 15],
      [0.5, 90, 15],
      [1.0, 70, 13],
    ] as const) {
      const wave = Math.sin(t * 2 + a * 3 + st.ph) * 0.06
      g.at(tx, ty, up + a + wave, () => {
        g.ellipse(len * 0.5 * k, 3, len * 0.5 * k, w, shade(leaf, -0.35))
        g.ellipse(len * 0.5 * k, 0, len * 0.5 * k, w, leaf)
        g.line(4, 0, len * 0.9 * k, 0, alpha('#ffffff', 0.3), 2)
      })
    }
  }
  if (st.gold) {
    for (let i = 0; i < 3; i++) {
      const f = (t * 0.35 + i / 3) % 1
      const px = st.x + (tx - st.x) * f + Math.sin(t * 3 + i) * 14
      const py = st.y + (ty - st.y) * f
      g.alpha(Math.sin(f * Math.PI), () => g.star(px, py, 14, '#ffffff', 4, 0.35))
    }
  }
  g.circle(st.x, st.y, width * 0.5, dark)
}

/** A sliced top: a slash flash at the cut, then the top tips over along the throw and fades. */
export function drawFallen(g: Draw, f: Fallen): void {
  const p = Math.min(1, f.t / 0.35)
  const ease = p * p * (3 - 2 * p)
  const fade = Math.max(0, 1 - Math.max(0, f.t - 0.5) / 0.4)
  const cx = f.x + f.fx * ease * 40
  const cy = f.y - f.from * LIFT + f.fy * ease * 40
  const len = Math.max(60, (f.to - f.from) * LIFT)
  const ux = Math.sin(ease * (Math.PI / 2)) * f.fx
  const uy = -Math.cos(ease * (Math.PI / 2)) + Math.sin(ease * (Math.PI / 2)) * f.fy
  const n = Math.hypot(ux, uy) || 1
  const ex = cx + (ux / n) * len
  const ey = cy + (uy / n) * len
  const body = f.gold ? GOLD_STALK : GREEN
  g.alpha(fade, () => {
    g.shadow(f.x + f.fx * ease * len * 0.6, f.y + f.fy * ease * len * 0.6, 40, 14, 0.3 * ease)
    g.line(cx, cy, ex, ey, shade(body, -0.35), 36)
    g.line(cx, cy, ex, ey, body, 28)
    g.line(cx - 6, cy, ex - 6, ey, alpha('#ffffff', 0.35), 5)
    g.ellipse(cx, cy, 16, 9, '#fff3cf')
    // A couple of leaves riding along with the top.
    g.at(ex, ey, Math.atan2(uy, ux) + ease * 2, () => {
      g.ellipse(30, 0, 34, 12, f.gold ? GOLD_STALK : '#7fdc78')
      g.ellipse(-20, 10, 26, 10, f.gold ? GOLD_STALK : '#58b85a')
    })
  })
  // The slash itself: a bright blade of light across the cut, in the cutter's colour.
  const flash = since(f.t, 0, 0.22)
  if (flash > 0) {
    const a = Math.atan2(f.fy, f.fx) + Math.PI / 2 + 0.5
    const r = 90 + (1 - flash) * 50
    const y = f.y - f.from * LIFT
    g.alpha(flash, () => {
      g.line(
        f.x - Math.cos(a) * r,
        y - Math.sin(a) * r,
        f.x + Math.cos(a) * r,
        y + Math.sin(a) * r,
        SIDE[f.side].light,
        22 * flash + 4,
      )
      g.line(
        f.x - Math.cos(a) * r * 0.9,
        y - Math.sin(a) * r * 0.9,
        f.x + Math.cos(a) * r * 0.9,
        y + Math.sin(a) * r * 0.9,
        '#ffffff',
        8 * flash + 2,
      )
    })
  }
}

/** A four-point star in steel with the thrower's colour at its hub. */
function drawStar(g: Draw, x: number, y: number, spin: number, side: Side, a = 1): void {
  g.alpha(a, () => {
    g.star(x, y + 3, 34, alpha('#000000', 0.3), 4, 0.34, spin)
    g.star(x, y, 34, '#aeb6cf', 4, 0.34, spin)
    g.star(x, y, 34, alpha('#ffffff', 0.5), 4, 0.15, spin + 0.12)
    g.circle(x, y, 11, SIDE[side].main)
    g.circle(x, y, 5, '#2a2243')
  })
}

/** A shuriken in the air: lifted by its height over its shadow, spinning, a ghost trail behind. */
export function drawShuri(g: Draw, sh: Shuri): void {
  const px = sh.x - SHURI_Z * 0.12
  const py = sh.y - SHURI_Z * LIFT
  g.shadow(sh.x, sh.y, 26, 11, 0.45)
  for (let i = 3; i >= 1; i--) {
    drawStar(
      g,
      px - sh.dx * i * 30,
      py - sh.dy * i * 30,
      sh.spin - i * 0.5,
      sh.side,
      0.16 * (4 - i),
    )
  }
  g.line(px, py, px - sh.dx * 110, py - sh.dy * 110, alpha(SIDE[sh.side].light, 0.35), 10)
  drawStar(g, px, py, sh.spin, sh.side)
}

/** Dotted preview of the swipe that is being held. */
function drawPreview(g: Draw, side: Side, p: Preview): void {
  const y0 = THROW_Y[side] ?? 0
  const x0 = originX(p.x)
  const col = SIDE[side].light
  for (let i = 0; i < 14; i++) {
    const d = 90 + i * 70
    const x = x0 + p.dx * d
    const y = y0 + p.dy * d - SHURI_Z * LIFT
    if (y < -20 || y > H + 20) break
    g.alpha(0.95 - i * 0.06, () => g.circle(x, y, 10 - i * 0.4, col))
  }
}

/** Where a side's ninja stands now: dashing to its last throw spot, or following the finger. */
export function ninjaX(s: State, side: Side): number {
  const p = s.aiming[side]
  if (p) return originX(p.x)
  const k = Math.min(1, Math.max(0, (s.t - s.moveT[side]) / 0.14))
  return s.from[side] + (s.at[side] - s.from[side]) * k
}

/** Each side's thrower: a ninja blob with a headband, flicking on a throw, with a ring that fills while it recovers. */
function drawNinja(g: Draw, s: State, side: Side, end: number, now: number): void {
  const y = THROW_Y[side] ?? 0
  const x = ninjaX(s, side)
  const col = SIDE[side]
  const ready = s.cool[side] <= 0
  const flick = since(s.t, s.throwT[side], 0.25)
  let mood: Mood = ready ? 'grin' : 'wow'
  let hop = 0
  if (s.left <= 0) {
    const [r, b] = s.score
    const won = side === 0 ? r > b : b > r
    mood = r === b ? 'happy' : won ? 'grin' : 'sad'
    if (won) hop = Math.abs(Math.sin(end * 7)) * 30
  }
  g.shadow(x + 6, y + 40, 50 - hop * 0.3, 16, 0.4)
  if (!ready && s.left > 0) {
    const k = 1 - s.cool[side] / COOL
    g.arc(x, y, 70, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k, alpha(col.light, 0.9), 10)
  }
  g.forSide(side, x, y, () => {
    const r = 46
    g.at(
      0,
      -hop,
      0,
      () => {
        g.blob(0, 0, r, col.main, { mood, look: [0, -1], cheeks: false })
        // Headband across the brow, tails flying behind.
        const wave = Math.sin(now * 12) * 6
        g.poly([-r * 0.92, -r * 0.62, r * 0.92, -r * 0.62, r, -r * 0.4, -r, -r * 0.4], C.ink)
        g.line(-r * 0.8, -r * 0.55, r * 0.8, -r * 0.55, alpha('#ffffff', 0.2), 3)
        g.poly([r * 0.9, -r * 0.55, r * 1.55, -r * 0.8 + wave, r * 1.5, -r * 0.5 + wave], C.ink)
        g.poly([r * 0.9, -r * 0.5, r * 1.45, -r * 0.3 - wave, r * 1.35, -r * 0.1 - wave], C.ink)
      },
      1 + flick * 0.16,
      1 - flick * 0.14,
    )
    if (ready && s.left > 0) {
      // The next star, ready in hand.
      g.at(r * 0.95, -r * 0.1, now * 2, () => {
        g.star(0, 0, 20, '#aeb6cf', 4, 0.34)
        g.circle(0, 0, 6, col.main)
      })
    }
  })
}

export function render(
  g: Draw,
  s: State,
  now: number,
  endAt: number,
  human: readonly [boolean, boolean] = [true, true],
): void {
  const end = endAt >= 0 ? now - endAt : 0
  drawGrove(g)
  for (const st of [...s.stalks].sort((a, b) => a.y - b.y)) drawStalk(g, st, now)
  for (const f of s.fallen) drawFallen(g, f)
  for (const side of [0, 1] as Side[]) {
    const p = s.aiming[side]
    if (p && s.left > 0) drawPreview(g, side, p)
  }
  for (const side of [0, 1] as Side[]) drawNinja(g, s, side, end, now)
  for (const sh of s.shuris) drawShuri(g, sh)
  if (s.t < 5 && s.left > 0) {
    for (const side of [0, 1] as Side[]) {
      if (!human[side]) continue
      const y = side === 0 ? 1430 : 370
      banner(g, side, 'Swipe at the bamboo', y, {
        size: 44,
        alpha: Math.min(1, (5 - s.t) / 0.6) * (0.75 + 0.25 * Math.sin(now * 4)),
      })
    }
  }
}

/** Score plaque at a player's corner, popping when it goes up. */
export function drawScore(
  g: Draw,
  s: State,
  side: Side,
  win: boolean,
  last: number,
  now: number,
): void {
  const y = hudY(g, side, 74)
  const x = side === 0 ? 120 : W - 120
  const pop = since(s.t, last, 0.3)
  const col = SIDE[side]
  g.forSide(side, x, y, () => {
    g.at(
      0,
      0,
      0,
      () => {
        if (win) {
          g.alpha(0.5 + 0.3 * Math.sin(now * 8), () => g.rrect(-82, -56, 164, 112, 34, C.yellow))
        }
        g.tile(-72, -46, 144, 100, 28, shade(col.main, -0.45), 10)
        g.text(s.score[side], 0, 0, { size: 66, weight: 700, color: C.white })
      },
      1 + pop * 0.35,
    )
  })
}

/**
 * The match clock in a player's own HUD row (opposite their score plaque), so
 * it never sits over the bamboo in the middle of the grove.
 */
export function drawClock(g: Draw, side: Side, left: number, now: number): void {
  const sec = Math.max(0, Math.ceil(left))
  const label = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const urgent = sec <= 5
  const y = hudY(g, side, 74)
  const x = side === 0 ? W - 120 : 120
  const beat = urgent ? Math.max(0, Math.sin(now * Math.PI * 2)) * 0.12 : 0
  g.forSide(side, x, y, () =>
    g.at(
      0,
      0,
      0,
      () => {
        g.rrect(-82, -40, 164, 80, 26, alpha(C.ink, 0.78))
        g.text(label, 0, 3, { size: 48, weight: 700, color: urgent ? C.yellow : C.white })
      },
      1 + beat,
    ),
  )
}

/** "Time!" stamped over the grove as the gong goes, readable from both ends. */
export function drawTimeUp(g: Draw, end: number): void {
  if (end <= 0 || end > 1.6) return
  const a = Math.min(1, (1.6 - end) / 0.3)
  const pop = end < 0.25 ? 0.6 + (end / 0.25) * 0.55 : 1.15 - Math.min(0.15, (end - 0.25) * 0.6)
  g.alpha(a, () => {
    const one = (angle: number, cy: number) =>
      g.at(
        W / 2,
        cy,
        angle,
        () => {
          g.rrect(-190, -64, 380, 128, 64, alpha(C.ink, 0.88))
          g.text('Time!', 0, 4, { size: 86, weight: 700, color: C.yellow })
        },
        pop,
      )
    if (g.flipTop) {
      one(0, MID + 150)
      one(Math.PI, MID - 150)
    } else one(g.orient(), MID)
  })
}
