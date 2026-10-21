import type { Side } from '../../core/game.ts'
import type { Draw, Mood } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { H, W } from '../../core/stage.ts'
import { DASH_COOL, RING, type Wrestler } from './rules.ts'

/** Clay of the raised dohyo platform, and the sand inside the bales. */
const CLAY = mix(C.sand, C.woodDark, 0.42)
const SAND = shade(C.sand, 0.06)
const STRAW = '#e2c879'
/** Width of the straw-bale ring around the sand. */
const BALE = 34
/** Half size of the square clay mound. */
const MOUND = 470

export function backdrop(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, H, [
      [0, shade(SIDE[1].main, -0.78)],
      [0.5, C.ink],
      [1, shade(SIDE[0].main, -0.78)],
    ]),
  )
  // A tatami floor round the mound: long mats in a staggered weave, each
  // player's end tinted in their colour.
  const v = g.stage.view
  const mw = 250
  const mh = 125
  for (let row = Math.floor(v.y / mh) - 1; row * mh < v.y + v.h; row++) {
    const y = row * mh
    const off = row % 2 ? mw / 2 : 0
    const tint = y + mh / 2 < RING.y ? SIDE[1].main : SIDE[0].main
    const d = Math.abs(y + mh / 2 - RING.y) / 900
    for (let x = Math.floor((v.x - off) / mw) * mw + off - mw; x < v.x + v.w; x += mw) {
      if ((row + Math.round((x - off) / mw)) % 2)
        g.rect(x, y, mw, mh, alpha(tint, 0.02 + 0.04 * Math.min(1, d)))
      g.rect(x, y, mw, 3, alpha('#000000', 0.16))
      g.rect(x, y, 3, mh, alpha('#000000', 0.16))
    }
  }
  // The floodlight over the ring.
  g.fillView(
    g.rad(W / 2, RING.y, 160, 1050, [
      [0, alpha('#fff1d0', 0.12)],
      [0.55, alpha('#000000', 0)],
      [1, alpha('#000000', 0.5)],
    ]),
  )
}

/**
 * The dohyo: a square clay mound, the straw-bale ring and its raked sand. Once
 * the bout runs long, `radius` (the live edge) shrinks inside the bales and the
 * lost sand turns to a hazard.
 */
export function drawRing(g: Draw, radius: number, t: number): void {
  const { x, y } = RING
  const m = MOUND
  // The mound: a raised clay tile with a lit top face.
  g.shadow(x, y + m + 40, m * 1.05, 60, 0.5)
  g.rrect(x - m, y - m + 34, m * 2, m * 2, 60, shade(CLAY, -0.45))
  g.rrect(
    x - m,
    y - m,
    m * 2,
    m * 2,
    60,
    g.lin(0, y - m, 0, y + m, [
      [0, shade(CLAY, 0.12)],
      [1, shade(CLAY, -0.08)],
    ]),
  )
  g.rrect(x - m + 58, y - m + 8, m * 2 - 116, 22, 11, alpha('#ffffff', 0.12))
  // Team corners: each side owns its two corners of the mound.
  for (const side of [0, 1] as Side[]) {
    const cy = side === 0 ? y + m - 64 : y - m + 64
    for (const cx of [x - m + 64, x + m - 64]) {
      g.circle(cx, cy, 30, alpha(SIDE[side].main, 0.25))
      g.sideMark(side, cx, cy, 15, alpha(SIDE[side].main, 0.85))
    }
  }
  // Sand inside the bales, lit from the middle.
  const R = RING.r
  g.circle(
    x,
    y,
    R,
    g.rad(x, y, 30, R, [
      [0, shade(SAND, 0.1)],
      [0.8, SAND],
      [1, shade(SAND, -0.12)],
    ]),
  )
  // Raked rings.
  for (let k = 70; k < R; k += 52) g.ring(x, y, k, alpha(C.woodDark, 0.07), 3)
  // The shrinking edge: lost sand darkens with a red hazard tint.
  if (radius < R) {
    g.path(
      (c) => {
        c.arc(x, y, R, 0, Math.PI * 2)
        c.moveTo(x + Math.max(0, radius), y)
        c.arc(x, y, Math.max(0, radius), 0, Math.PI * 2, true)
      },
      alpha(shade(C.red, -0.55), 0.55),
    )
    const pulse = 0.5 + 0.5 * Math.sin(t * 9)
    g.ring(x, y, radius, alpha(C.yellow, 0.55 + pulse * 0.45), 10 + pulse * 6)
  } else {
    g.ring(x, y, R - 4, alpha('#ffffff', 0.55), 6)
  }
  // Shikiri-sen: the two start lines, one per side.
  for (const side of [0, 1] as Side[]) {
    const ly = side === 0 ? y + 58 : y - 58
    g.rrect(x - 70, ly - 7, 140, 14, 7, alpha('#ffffff', 0.85))
    g.rrect(x - 70, ly - 7, 140, 5, 3, alpha(SIDE[side].main, 0.7))
  }
  // Straw bales: plump segments with a gap between each.
  const n = 28
  const rb = R + BALE / 2
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + 0.03
    const a1 = ((i + 1) / n) * Math.PI * 2 - 0.03
    g.arc(x, y + 6, rb, a0, a1, shade(STRAW, -0.45), BALE)
    g.arc(x, y, rb, a0, a1, STRAW, BALE)
    g.arc(x, y - 4, rb + 4, a0 + 0.03, a1 - 0.03, alpha('#ffffff', 0.35), 6)
  }
  // Team arcs on the bales at each side's end.
  g.arc(x, y, rb + BALE / 2 + 10, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, SIDE[0].main, 12)
  g.arc(x, y, rb + BALE / 2 + 10, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5, SIDE[1].main, 12)
}

export interface WrestlerLook {
  /** Squash (-ish) of a fresh hit, 0 at rest. */
  squash: number
  mood: Mood
  time: number
  /** 0 on the mound; grows to 1 as the wrestler tumbles off it. */
  fall: number
  /** Bounce of the pre-bout stomp, 0..1. */
  stomp: number
}

/** A wrestler: a heavy blob in its side's colour with a topknot, looking where it goes. */
export function drawWrestler(g: Draw, a: Wrestler, o: WrestlerLook): void {
  const r = a.r * (1 - o.fall * 0.45)
  const sp = Math.hypot(a.vx, a.vy)
  const lx = sp > 1 ? a.vx / sp : 0
  const ly = sp > 1 ? a.vy / sp : a.side === 0 ? -0.5 : 0.5
  const k = Math.max(-0.32, Math.min(0.32, o.squash))
  const col = SIDE[a.side].main
  // Dash streaks: afterimages behind a wrestler moving faster than it can run.
  if (sp > 700 && o.fall === 0) {
    for (let i = 1; i <= 3; i++) {
      g.alpha(0.18 - i * 0.04, () =>
        g.circle(a.x - a.vx * 0.035 * i, a.y - a.vy * 0.035 * i, r * (1 - i * 0.08), col),
      )
    }
  }
  const lift = o.stomp * 26
  // Blue's wrestler is turned for blue in local 2P, so its face reads upright for its player.
  const flip = g.orient(a.side) - g.orient(0)
  // The gaze is a screen direction: turn it back into the blob's own frame.
  const gx = lx * Math.cos(flip) + ly * Math.sin(flip)
  const gy = -lx * Math.sin(flip) + ly * Math.cos(flip)
  g.alpha(1 - o.fall * 0.7, () => {
    g.shadow(a.x + 10, a.y + r * 0.92, r * (1.02 - o.stomp * 0.12), r * 0.38, 0.45)
    const by = a.y - lift
    const sx = 1 - k + o.stomp * -0.06
    const sy = 1 + k + o.stomp * 0.06
    const angle = o.fall * 2.4 * (a.side === 0 ? 1 : -1) + flip
    g.blob(a.x, by, r, col, { mood: o.mood, look: [gx, gy], sx, sy, outline: true, angle })
    if (o.mood === 'angry') g.at(a.x, by, angle, () => scowl(g, r, col), sx, sy)
    // Topknot and forehead mark, drawn in the wrestler's own frame.
    g.at(a.x, by, flip, () => {
      if (o.fall < 0.5) {
        const ty = -r * (1 + k) * 0.98
        g.ellipse(0, ty, r * 0.2, r * 0.13, C.ink)
        g.ellipse(0, ty + r * 0.1, r * 0.09, r * 0.06, shade(C.ink, 0.25))
        g.ellipse(-r * 0.06, ty - r * 0.04, r * 0.06, r * 0.03, alpha('#ffffff', 0.35))
        // Side marker on the forehead: red circle, blue square.
        g.sideMark(a.side, 0, -r * (1 + k) * 0.66, r * 0.1, alpha('#ffffff', 0.85))
      }
    })
  })
}

/**
 * Heavy lids over the blob's eyes, slanting down toward the nose: a proper
 * fighting scowl. Painted with the blob's own body gradient (same space) so the
 * lids read as skin, with a dark lid edge as the brow.
 */
function scowl(g: Draw, r: number, col: string): void {
  const body = g.rad(
    0,
    0,
    r * 0.1,
    r * 1.05,
    [
      [0, shade(col, 0.35)],
      [0.6, col],
      [1, shade(col, -0.3)],
    ],
    -r * 0.3,
    -r * 0.45,
  )
  const ex = r * 0.36
  const ey = -r * 0.12
  const er = r * 0.24
  for (const s of [-1, 1]) {
    const inner = s * (ex - er * 1.25)
    const outer = s * (ex + er * 1.3)
    const yi = ey - er * 0.15
    const yo = ey - er * 0.8
    g.poly([inner, yi, outer, yo, outer, ey - er * 1.75, inner, ey - er * 1.75], body)
    g.line(inner - s * er * 0.1, yi + er * 0.08, outer, yo - er * 0.05, C.ink, r * 0.1)
  }
}

/**
 * Dash readiness: an arc around the wrestler's feet that fills while the dash
 * recharges, then flashes yellow once it is ready.
 */
export function drawDashMeter(g: Draw, a: Wrestler, time: number): void {
  const left = a.cool - time
  const r = a.r + 16
  if (left > 0) {
    const k = 1 - left / DASH_COOL
    g.arc(a.x, a.y, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2, alpha('#ffffff', 0.45), 7)
  } else if (left > -0.25) {
    g.alpha(1 + left / 0.25, () => g.ring(a.x, a.y, r + 10 * (1 + left / 0.25), C.yellow, 8))
  }
}

/** The floating stick under a human's finger: base where it went down, knob where it is. */
export function drawStick(
  g: Draw,
  side: Side,
  x0: number,
  y0: number,
  x: number,
  y: number,
  reach: number,
): void {
  const dx = x - x0
  const dy = y - y0
  const d = Math.hypot(dx, dy)
  const k = d > reach ? reach / d : 1
  const kx = x0 + dx * k
  const ky = y0 + dy * k
  const col = SIDE[side]
  g.circle(x0, y0, reach, alpha(col.main, 0.14))
  g.ring(x0, y0, reach, alpha(col.light, 0.4), 6)
  if (d > 12) g.line(x0, y0, kx, ky, alpha(col.light, 0.5), 14)
  g.circle(kx, ky + 6, 46, alpha(col.dark, 0.8))
  g.circle(kx, ky, 46, col.main)
  g.circle(kx - 12, ky - 14, 14, alpha('#ffffff', 0.45))
}
