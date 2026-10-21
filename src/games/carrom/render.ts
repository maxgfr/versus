import { outBack } from '../../core/fx/ease.ts'
import type { Side } from '../../core/game.ts'
import { hudY } from '../../core/hud.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { MID, W } from '../../core/stage.ts'
import {
  BASE_X,
  BASE_Y,
  BOARD,
  type Board,
  CENTRE,
  type Owner,
  POCKET_R,
  POCKETS,
  PIECE_R,
  STRIKER_R,
} from './rules.ts'

/** The flick the player is lining up (cosmetic). */
export interface Aim {
  dx: number
  dy: number
  power: number
}

/** A piece (or the striker, owner -1) dropping into a pocket, stamped with its time. */
export interface Sink {
  x: number
  y: number
  /** Centre of the pocket it fell into. */
  px: number
  py: number
  owner: Owner | -1
  side: Side
  at: number
}

export interface Look {
  board: Board
  time: number
  aim: Aim | null
  /** A human is to place / flick (shows the coaching). */
  hint: boolean
  /** The striker is the active thing: yellow ring. */
  live: boolean
  sinks: Sink[]
}

const RIM = 62
const PLY = '#efd3a0'
const FRAME = '#7a3f22'
const LIGHT = '#f6e6c4'
const DARK = '#2b2233'

export function backdrop(g: Draw): void {
  g.fillView(
    g.lin(0, 0, 0, 1800, [
      [0, shade(SIDE[1].main, -0.8)],
      [0.5, C.ink],
      [1, shade(SIDE[0].main, -0.8)],
    ]),
  )
  // The tabletop the board sits on: long dark planks, each end tinted in the
  // colour of the player sitting there.
  const v = g.stage.view
  const ph = 96
  for (let row = Math.floor(v.y / ph) - 1; row * ph < v.y + v.h; row++) {
    const y = row * ph
    const tint = y + ph / 2 < MID ? SIDE[1].main : SIDE[0].main
    if (row % 2) g.rect(v.x, y, v.w, ph, alpha(tint, 0.05))
    g.rect(v.x, y, v.w, 3, alpha('#000000', 0.22))
    const seam = ((row * 337) % 600) + 120
    g.rect(seam, y, 3, ph, alpha('#000000', 0.18))
    g.rect(seam + 520, y, 3, ph, alpha('#000000', 0.18))
  }
  g.fillView(
    g.rad(W / 2, MID, 100, 1050, [
      [0, alpha('#fff2d6', 0.12)],
      [0.55, alpha('#000000', 0)],
      [1, alpha('#000000', 0.5)],
    ]),
  )
}

function drawBoardFrame(g: Draw): void {
  const { x0, y0, x1, y1 } = BOARD
  const w = x1 - x0
  const h = y1 - y0
  g.shadow(CENTRE.x, y1 + RIM + 34, (w + RIM * 2) * 0.54, 44, 0.5)
  // Polished hardwood frame with a lip and a lit top edge.
  g.rrect(x0 - RIM, y0 - RIM + 18, w + RIM * 2, h + RIM * 2, 40, shade(FRAME, -0.5))
  g.rrect(
    x0 - RIM,
    y0 - RIM,
    w + RIM * 2,
    h + RIM * 2,
    40,
    g.lin(0, y0 - RIM, 0, y1 + RIM, [
      [0, shade(FRAME, 0.18)],
      [1, shade(FRAME, -0.12)],
    ]),
  )
  g.rrect(x0 - RIM + 40, y0 - RIM + 6, w + RIM * 2 - 80, 12, 6, alpha('#ffffff', 0.22))
  // Team ends of the frame: each side's rail carries its colour.
  g.rrect(x0 + 60, y1 + 14, w - 120, 12, 6, alpha(SIDE[0].main, 0.85))
  g.rrect(x0 + 60, y0 - 26, w - 120, 12, 6, alpha(SIDE[1].main, 0.85))
  // Inner bevel, then the plywood with its grain and the floodlight.
  g.rrect(x0 - 8, y0 - 8, w + 16, h + 16, 12, shade(FRAME, -0.35))
  g.rect(x0, y0, w, h, PLY)
  g.clip(x0, y0, w, h, 4, () => {
    for (let y = y0 + 14; y < y1; y += 26)
      g.rect(x0, y + Math.sin(y * 0.07) * 3, w, 2, alpha(C.woodDark, 0.07))
    g.fillView(
      g.rad(CENTRE.x, CENTRE.y, 40, w * 0.75, [
        [0, alpha('#ffffff', 0.18)],
        [1, alpha('#000000', 0.12)],
      ]),
    )
  })
}

function drawMarkings(g: Draw, turn: Side, live: boolean, t: number): void {
  const ink = alpha('#3b1d10', 0.55)
  // Baselines: a double line per side, a red-or-blue circle at each end.
  for (const side of [0, 1] as Side[]) {
    const y = BASE_Y[side]
    const on = live && side === turn
    const col = SIDE[side].main
    const a = on ? 0.75 + 0.25 * Math.sin(t * 5) : 0.5
    g.line(BASE_X.x0, y - 20, BASE_X.x1, y - 20, alpha(col, a), 5)
    g.line(BASE_X.x0, y + 20, BASE_X.x1, y + 20, alpha(col, a), 5)
    for (const x of [BASE_X.x0, BASE_X.x1]) {
      g.circle(x, y, 22, alpha(col, on ? 0.9 : 0.6))
      g.ring(x, y, 22, ink, 3)
    }
  }
  // Corner arrows pointing at the pockets.
  for (const k of POCKETS) {
    const ux = Math.sign(k.x - CENTRE.x)
    const uy = Math.sign(k.y - CENTRE.y)
    const ax = k.x - ux * 120
    const ay = k.y - uy * 120
    const bx = k.x - ux * 270
    const by = k.y - uy * 270
    g.line(bx, by, ax, ay, ink, 4)
    const dx = ux * Math.SQRT1_2
    const dy = uy * Math.SQRT1_2
    g.poly(
      [
        ax + dx * 16,
        ay + dy * 16,
        ax - dx * 10 - dy * 13,
        ay - dy * 10 + dx * 13,
        ax - dx * 10 + dy * 13,
        ay - dy * 10 - dx * 13,
      ],
      ink,
    )
    g.arc(bx, by, 22, 0, Math.PI * 2, ink, 3)
  }
  // Centre: two circles and a star.
  g.ring(CENTRE.x, CENTRE.y, 150, ink, 4)
  g.ring(CENTRE.x, CENTRE.y, 138, alpha('#3b1d10', 0.3), 3)
  g.star(CENTRE.x, CENTRE.y, 60, alpha('#b2462a', 0.35), 8, 0.45, 0)
  g.circle(CENTRE.x, CENTRE.y, 18, alpha('#b2462a', 0.55))
}

function drawPockets(g: Draw): void {
  for (const k of POCKETS) {
    g.circle(k.x, k.y, POCKET_R + 10, shade(FRAME, -0.3))
    g.circle(
      k.x,
      k.y,
      POCKET_R,
      g.rad(k.x, k.y, 4, POCKET_R, [
        [0, '#000000'],
        [0.75, shade(C.ink, 0.05)],
        [1, shade(C.ink, 0.3)],
      ]),
    )
    // The far wall of the hole catches the light.
    g.arc(k.x, k.y, POCKET_R - 6, 0.3, Math.PI - 0.3, alpha('#ffffff', 0.12), 6)
    g.ring(k.x, k.y, POCKET_R + 2, alpha('#ffffff', 0.18), 4)
  }
}

/** A light (red's) or dark (blue's) piece, or the queen. Side marks keep it readable without colour. */
export function drawPiece(g: Draw, x: number, y: number, owner: Owner, r = PIECE_R): void {
  g.shadow(x + 4, y + 9, r * 0.95, r * 0.55, 0.32)
  if (owner === 2) {
    g.disc(x, y, r, C.pink, r * 0.22)
    g.ring(x, y, r * 0.66, alpha(C.yellow, 0.95), r * 0.14)
    g.star(x, y, r * 0.34, C.yellow, 5, 0.5)
    return
  }
  const side = owner as Side
  const body = side === 0 ? LIGHT : DARK
  g.disc(x, y, r, body, r * 0.22)
  g.ring(x, y, r * 0.7, alpha(SIDE[side].main, 0.9), r * 0.13)
  g.sideMark(side, x, y, r * 0.26, SIDE[side].main)
  g.alpha(0.5, () => g.ellipse(x - r * 0.35, y - r * 0.45, r * 0.3, r * 0.14, '#fff', -0.5))
}

function drawStriker(g: Draw, b: Board, side: Side, live: boolean, t: number): void {
  const s = b.striker
  if (s.gone) return
  if (live) {
    const p = 0.5 + 0.5 * Math.sin(t * 6)
    g.circle(s.x, s.y, STRIKER_R + 18 + p * 5, alpha(C.yellow, 0.15))
    g.ring(s.x, s.y, STRIKER_R + 18 + p * 5, C.yellow, 6)
  }
  g.shadow(s.x + 6, s.y + 13, STRIKER_R, STRIKER_R * 0.55, 0.4)
  g.disc(s.x, s.y, STRIKER_R, SIDE[side].main, STRIKER_R * 0.24)
  g.ring(s.x, s.y, STRIKER_R * 0.72, alpha('#ffffff', 0.55), 5)
  g.sideMark(side, s.x, s.y, STRIKER_R * 0.3, alpha('#ffffff', 0.95))
  g.alpha(0.55, () =>
    g.ellipse(s.x - STRIKER_R * 0.35, s.y - STRIKER_R * 0.45, STRIKER_R * 0.3, 7, '#fff', -0.5),
  )
}

/**
 * First piece the striker would meet along its line, and where: a sweep of the
 * striker circle against every piece. Null if the line runs clear.
 */
function firstContact(
  b: Board,
  dx: number,
  dy: number,
): { cx: number; cy: number; px: number; py: number; t: number } | null {
  const s = b.striker
  let best: { cx: number; cy: number; px: number; py: number; t: number } | null = null
  const R = STRIKER_R + PIECE_R
  for (const p of b.pieces) {
    const ox = p.x - s.x
    const oy = p.y - s.y
    const along = ox * dx + oy * dy
    if (along <= 0) continue
    const perp2 = ox * ox + oy * oy - along * along
    if (perp2 > R * R) continue
    const t = along - Math.sqrt(R * R - perp2)
    if (!best || t < best.t) best = { cx: s.x + dx * t, cy: s.y + dy * t, px: p.x, py: p.y, t }
  }
  return best
}

function drawAim(g: Draw, b: Board, side: Side, aim: Aim): void {
  const s = b.striker
  const col = mix(SIDE[side].light, C.yellow, aim.power)
  const hit = firstContact(b, aim.dx, aim.dy)
  const reach = 120 + aim.power * 600
  const len = hit ? Math.min(hit.t, reach) : reach
  const n = Math.max(3, Math.round(len / 34))
  for (let i = 1; i <= n; i++) {
    const d = STRIKER_R + 16 + ((len - STRIKER_R - 16) * i) / n
    g.circle(s.x + aim.dx * d, s.y + aim.dy * d, 7, alpha(col, 0.9))
  }
  if (hit && hit.t <= reach) {
    // Ghost striker at the contact, and the line the piece would take.
    g.ring(hit.cx, hit.cy, STRIKER_R, alpha('#ffffff', 0.8), 4)
    const nx = hit.px - hit.cx
    const ny = hit.py - hit.cy
    const nl = Math.hypot(nx, ny) || 1
    const ex = hit.px + (nx / nl) * 170
    const ey = hit.py + (ny / nl) * 170
    g.line(hit.px, hit.py, ex, ey, alpha('#ffffff', 0.75), 6)
    g.circle(ex, ey, 8, alpha('#ffffff', 0.75))
  } else {
    const ex = s.x + aim.dx * (len + 24)
    const ey = s.y + aim.dy * (len + 24)
    const ang = Math.atan2(aim.dy, aim.dx)
    g.poly(
      [
        ex + Math.cos(ang) * 28,
        ey + Math.sin(ang) * 28,
        ex + Math.cos(ang + 2.5) * 22,
        ey + Math.sin(ang + 2.5) * 22,
        ex + Math.cos(ang - 2.5) * 22,
        ey + Math.sin(ang - 2.5) * 22,
      ],
      col,
    )
  }
  g.ring(s.x, s.y, STRIKER_R + 30, alpha('#000000', 0.25), 12)
  g.arc(s.x, s.y, STRIKER_R + 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * aim.power, col, 12)
}

/** Pieces dropping into pockets: they slide to the pocket's centre and shrink away. */
function drawSinks(g: Draw, sinks: Sink[], t: number): void {
  for (const k of sinks) {
    const f = (t - k.at) / 0.4
    if (f < 0 || f > 1) continue
    const x = k.x + (k.px - k.x) * f
    const y = k.y + (k.py - k.y) * f
    const r = (k.owner === -1 ? STRIKER_R : PIECE_R) * (1 - f * 0.7)
    g.alpha(1 - f * 0.6, () => {
      if (k.owner === -1) g.disc(x, y, r, SIDE[k.side].main, r * 0.2)
      else drawPiece(g, x, y, k.owner, r)
    })
  }
}

/** The board: frame, markings, pockets, pieces, striker, and the player's aim or hint. */
export function drawBoard(g: Draw, look: Look): void {
  const b = look.board
  const t = look.time
  drawBoardFrame(g)
  drawMarkings(g, b.turn, look.live, t)
  drawPockets(g)
  drawSinks(g, look.sinks, t)
  for (const p of b.pieces) drawPiece(g, p.x, p.y, p.owner)
  drawStriker(g, b, b.striker.side, look.live && !look.aim, t)
  if (look.aim && b.phase === 'flick') drawAim(g, b, b.striker.side, look.aim)
  if (look.hint && (b.phase === 'place' || b.phase === 'flick') && !look.aim) {
    const side = b.turn
    const y = side === 0 ? BOARD.y1 - 46 : BOARD.y0 + 46
    // Slide arrows either side of the striker while it is being placed.
    if (b.phase === 'place') {
      const s = b.striker
      const wob = Math.sin(t * 6) * 6
      for (const d of [-1, 1]) {
        const ax = s.x + d * (STRIKER_R + 34 + wob)
        g.poly([ax + d * 18, s.y, ax, s.y - 16, ax, s.y + 16], alpha('#ffffff', 0.85))
      }
    }
    const text = b.phase === 'place' ? 'Slide, then let go' : 'Pull back to flick'
    g.text(text, CENTRE.x, y, {
      size: 38,
      weight: 700,
      color: alpha('#3b1d10', 0.8),
      angle: g.orient(side),
    })
  }
}

/**
 * The tray of own pieces a side has pocketed: nine slots, filling up. First to
 * fill the tray wins the board. Upright for its player, above the name pill.
 */
export function drawTray(g: Draw, side: Side, kept: number, t: number, popAt: number): void {
  const y = hudY(g, side, 168)
  const gap = 46
  const w = gap * 9 + 30
  g.forSide(side, W / 2, y, () => {
    g.rrect(-w / 2, -32, w, 64, 32, alpha(C.ink, 0.8))
    g.rrect(-w / 2, -32, w, 64, 32, undefined, alpha(SIDE[side].main, 0.35), 4)
    for (let i = 0; i < 9; i++) {
      const x = -((9 - 1) * gap) / 2 + i * gap
      if (i < kept) {
        const k = i === kept - 1 ? Math.min(1, (t - popAt) / 0.3) : 1
        const s = k < 1 ? outBack(Math.max(0, k)) : 1
        g.at(x, 0, 0, () => drawPiece(g, 0, -2, side, 17), s)
      } else g.circle(x, 0, 15, alpha('#ffffff', 0.08))
    }
  })
}
