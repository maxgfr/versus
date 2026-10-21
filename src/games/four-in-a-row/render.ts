import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { W } from '../../core/stage.ts'
import { cellCenter, type Geom } from '../../engines/board/index.ts'
import type { State } from './index.ts'
import { COLS, ROWS } from './rules.ts'

/** The frame's plastic: a deep floodlit violet, neutral between the teams. */
const FRAME = mix(C.ink4, C.purple, 0.32)
/** Frame margin around the holes, and the lip under it. */
const PAD = 34
const DEPTH = 26
/** Hole and disc radii, as a share of the cell. */
const HOLE = 0.4
const DISC = 0.43
/** How high above the frame the next disc hovers, in cells. */
const HOVER = 0.95

/** Gravity of a dropped disc, world units / s². */
const G = 9000
/** Little bounces after the impact: [height in cells, seconds]. */
const BOUNCES: readonly (readonly [number, number])[] = [
  [0.16, 0.15],
  [0.045, 0.08],
]

/** Seconds from the drop until a disc falling into `row` first hits the stack. */
export function impactTime(geo: Geom, row: number): number {
  const dist = cellCenter(geo, 0, row).y - hoverY(geo)
  return Math.sqrt((2 * dist) / G)
}

/** Seconds from the drop until the disc has stopped bouncing. */
export function settleTime(geo: Geom, row: number): number {
  return impactTime(geo, row) + BOUNCES.reduce((a, [, d]) => a + d, 0)
}

/** Height above its resting spot of a disc `t` seconds after it was dropped into `row`. */
function lift(geo: Geom, row: number, t: number): number {
  const t0 = impactTime(geo, row)
  if (t < t0) {
    const dist = cellCenter(geo, 0, row).y - hoverY(geo)
    return dist - 0.5 * G * t * t
  }
  let u = t - t0
  for (const [h, d] of BOUNCES) {
    if (u < d) {
      const k = u / d
      return 4 * h * geo.cell * k * (1 - k)
    }
    u -= d
  }
  return 0
}

/** Seconds the spilled board takes to empty out of the bottom. */
export const SPILL = 0.95

/** Y of the hovering next disc. */
export function hoverY(geo: Geom): number {
  return geo.y - PAD - geo.cell * HOVER * 0.55
}

/**
 * X of the hovering next disc: centred for a human, wandering across the
 * middle columns while the computer makes up its mind.
 */
export function hoverX(geo: Geom, now: number, thinking: boolean): number {
  if (!thinking) return W / 2
  return W / 2 + Math.sin(now * 2.3) * Math.sin(now * 0.9 + 1) * geo.cell * 2.4
}

/**
 * A disc seen face-on. Red is plain with a groove; blue carries a square
 * inset, so the two sides never depend on colour alone.
 */
export function disc(g: Draw, side: Side, r: number): void {
  const col = SIDE[side]
  g.circle(0, r * 0.1, r, shade(col.main, -0.45))
  g.circle(
    0,
    0,
    r,
    g.rad(
      0,
      0,
      r * 0.05,
      r,
      [
        [0, shade(col.main, 0.32)],
        [0.62, col.main],
        [1, shade(col.main, -0.22)],
      ],
      -r * 0.35,
      -r * 0.4,
    ),
  )
  g.ring(0, 0, r * 0.7, alpha('#000000', 0.16), r * 0.1)
  g.arc(0, 0, r * 0.7, Math.PI * 0.15, Math.PI * 0.85, alpha('#ffffff', 0.22), r * 0.06)
  if (side === 1) {
    const k = r * 0.38
    g.rrect(-k, -k + r * 0.05, k * 2, k * 2, r * 0.14, shade(col.dark, -0.2))
    g.rrect(-k, -k, k * 2, k * 2, r * 0.14, col.dark)
    g.rrect(-k * 0.7, -k * 0.72, k * 1.4, k * 0.46, r * 0.08, alpha('#ffffff', 0.22))
  }
  g.alpha(0.55, () => g.ellipse(-r * 0.36, -r * 0.46, r * 0.26, r * 0.14, '#fff', -0.6))
}

/** The frame with its holes punched out, as one path (even-odd). */
function framePath(g: Draw, geo: Geom, x: number, y: number, w: number, h: number): void {
  const c = g.ctx
  c.beginPath()
  c.roundRect(x, y, w, h, 46)
  const r = geo.cell * HOLE
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const p = cellCenter(geo, col, row)
      c.moveTo(p.x + r, p.y)
      c.arc(p.x, p.y, r, 0, Math.PI * 2)
    }
  }
}

/** Behind the discs: the stand, the lip, the dark back panel and the wells. */
function back(g: Draw, geo: Geom): void {
  const x = geo.x - PAD
  const y = geo.y - PAD
  const w = geo.w + PAD * 2
  const h = geo.h + PAD * 2
  // Feet: the board stands on the table.
  g.shadow(W / 2, y + h + DEPTH + 52, w * 0.56, 40, 0.45)
  for (const fx of [x + 70, x + w - 70]) {
    g.tile(fx - 58, y + h - 10, 116, 70 + DEPTH, 22, shade(FRAME, -0.18), 18)
  }
  g.rrect(x, y + DEPTH, w, h, 46, shade(FRAME, -0.42))
  g.rrect(x + 6, y + 6, w - 12, h - 12, 40, shade(FRAME, -0.78))
  const r = geo.cell * HOLE
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const p = cellCenter(geo, col, row)
      g.circle(
        p.x,
        p.y,
        r,
        g.rad(p.x, p.y - r * 0.2, r * 0.2, r * 1.1, [
          [0, shade(FRAME, -0.6)],
          [1, shade(FRAME, -0.9)],
        ]),
      )
    }
  }
}

/** In front of the discs: the frame face, its gloss and a bevel on every hole. */
function front(g: Draw, geo: Geom): void {
  const x = geo.x - PAD
  const y = geo.y - PAD
  const w = geo.w + PAD * 2
  const h = geo.h + PAD * 2
  const c = g.ctx
  framePath(g, geo, x, y, w, h)
  c.fillStyle = g.lin(0, y, 0, y + h, [
    [0, shade(FRAME, 0.16)],
    [0.5, FRAME],
    [1, shade(FRAME, -0.12)],
  ])
  c.fill('evenodd')
  framePath(g, geo, x + 4, y + 3, w - 8, h * 0.42)
  c.fillStyle = g.lin(0, y, 0, y + h * 0.42, [
    [0, 'rgba(255,255,255,0.22)'],
    [1, 'rgba(255,255,255,0)'],
  ])
  c.save()
  c.beginPath()
  c.rect(x, y, w, h * 0.42)
  c.clip()
  framePath(g, geo, x + 4, y + 3, w - 8, h - 6)
  c.fill('evenodd')
  c.restore()
  // Each hole: shaded on top (inner wall), lit on the bottom lip.
  const r = geo.cell * HOLE
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const p = cellCenter(geo, col, row)
      g.arc(p.x, p.y, r + 2, Math.PI * 1.08, Math.PI * 1.92, alpha('#000000', 0.32), 7)
      g.arc(p.x, p.y, r + 3, Math.PI * 0.12, Math.PI * 0.88, alpha('#ffffff', 0.2), 5)
    }
  }
  g.rrect(x, y, w, h, 46, undefined, alpha('#ffffff', 0.1), 4)
}

/** The four-in-a-row line: a yellow bar through the winning discs, rings pulsing round them. */
function winLine(g: Draw, geo: Geom, s: State, now: number): void {
  if (!s.line || s.endedAt < 0) return
  const first = s.line[0] as number
  const last = s.line[3] as number
  const A = cellCenter(geo, first % COLS, Math.floor(first / COLS))
  const B = cellCenter(geo, last % COLS, Math.floor(last / COLS))
  const t = now - s.endedAt
  const p = outCubic(prog(t, 0.12, 0.45))
  if (p <= 0) return
  const ext = 0.18
  const x0 = A.x - (B.x - A.x) * ext
  const y0 = A.y - (B.y - A.y) * ext
  const x1 = x0 + (B.x - A.x) * (1 + 2 * ext) * p
  const y1 = y0 + (B.y - A.y) * (1 + 2 * ext) * p
  const pulse = 0.5 + 0.5 * Math.sin(t * 9)
  for (const i of s.line) {
    const { x, y } = cellCenter(geo, (i as number) % COLS, Math.floor((i as number) / COLS))
    g.alpha(0.55 + pulse * 0.45, () => g.ring(x, y, geo.cell * 0.49, C.yellow, 10))
  }
  g.line(x0, y0 + 8, x1, y1 + 8, alpha('#000000', 0.4), 30)
  g.line(x0, y0, x1, y1, C.yellow, 22)
  g.line(x0, y0 - 4, x1, y1 - 4, alpha('#ffffff', 0.5), 6)
}

/** Discs in the board (and the one still falling), dimmed once a round is decided. */
function discs(g: Draw, geo: Geom, s: State, now: number): void {
  const r = geo.cell * DISC
  const won = s.line && s.endedAt >= 0 ? s.line : null
  s.cells.forEach((cell, i) => {
    if (cell === null) return
    const row = Math.floor(i / COLS)
    const col = i % COLS
    const { x, y } = cellCenter(geo, col, row)
    const t = now - (s.placedAt[i] ?? 0)
    const T = settleTime(geo, row)
    const T0 = impactTime(geo, row)
    let px = x
    let py = y
    let sx = 1
    let sy = 1
    if (t < T) {
      // From the hover spot: swing over to the column, then drop and bounce.
      px = s.fromX + (x - s.fromX) * outCubic(prog(t, 0, 0.09))
      py = y - lift(geo, row, t)
      // Stretch while falling fast.
      const v = prog(t, 0, T0)
      if (v < 1) {
        sx = 1 - 0.08 * v
        sy = 1 + 0.12 * v
      }
    }
    const land = t - T0
    if (land >= 0 && land < 0.2) {
      const k = Math.sin((land / 0.2) * Math.PI) * 0.16
      sx = 1 + k
      sy = 1 - k
    }
    let dim = 1
    let pop = 1
    if (won) {
      const at = won.indexOf(i)
      if (at < 0) dim = 1 - 0.45 * prog(now - s.endedAt, 0.1, 0.5)
      else
        pop =
          1 + 0.18 * Math.sin(Math.PI * prog(now - s.endedAt, 0.12 + at * 0.08, 0.42 + at * 0.08))
    }
    g.alpha(dim, () => g.at(px, py, 0, () => disc(g, cell, r), sx * pop, sy * pop))
  })
}

/** The last board pouring out of the bottom between rounds. */
function spill(g: Draw, geo: Geom, s: State, now: number): void {
  if (!s.spill || s.spillAt < 0) return
  const r = geo.cell * DISC
  const bottom = geo.y + geo.h + PAD
  s.spill.forEach((cell, i) => {
    if (cell === null) return
    const row = Math.floor(i / COLS)
    const col = i % COLS
    const { x, y } = cellCenter(geo, col, row)
    const t = now - s.spillAt - (ROWS - 1 - row) * 0.035 - Math.abs(col - 3) * 0.02
    const dy = t > 0 ? 3600 * t * t : 0
    const yy = y + dy
    const fade = 1 - prog(yy, bottom + 60, bottom + 420)
    if (fade <= 0) return
    const spin = t > 0 ? (col - 3) * 0.05 * t * 10 : 0
    g.alpha(fade, () => g.at(x + spin * 12, yy, spin, () => disc(g, cell, r)))
  })
}

/** The next disc, hovering above the frame, for whoever is about to drop. */
function hovering(g: Draw, geo: Geom, side: Side, now: number, x: number, since: number): void {
  const r = geo.cell * DISC
  const y = hoverY(geo) + Math.sin(now * 4) * 7
  const s = outBack(prog(now - since, 0, 0.3))
  if (s <= 0) return
  g.circle(
    x,
    y,
    r * 1.5 * s,
    g.rad(x, y, r * 0.6, r * 1.5, [
      [0, alpha(SIDE[side].main, 0.45)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
  g.at(x, y, 0, () => disc(g, side, r), s)
}

export function renderBoard(
  g: Draw,
  s: State,
  geo: Geom,
  now: number,
  next: { side: Side; x: number; since: number } | null,
): void {
  back(g, geo)
  discs(g, geo, s, now)
  spill(g, geo, s, now)
  front(g, geo)
  winLine(g, geo, s, now)
  if (next) hovering(g, geo, next.side, now, next.x, next.since)
}
