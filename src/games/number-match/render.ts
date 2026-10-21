import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { HEADER } from '../../engines/puzzle/index.ts'
import { floodlight } from './ending.ts'
import { ADDS, COLS } from './rules.ts'

/** Board and Add button in a panel of w × h (a half: 1000 × 900, or the whole stage in solo). */
export interface Geo {
  /** Pitch of the grid; a cell is the pitch less a gap. */
  p: number
  /** Top-left of the grid (row 0, col 0). */
  x0: number
  y0: number
  btn: { x: number; y: number; w: number; h: number }
}

/**
 * The grid shrinks as it grows so every row fits above the Add button. Solo
 * keeps the grid narrow enough to clear the pause button on the left edge.
 */
export function geometry(w: number, h: number, cells: number): Geo {
  const solo = h > 1000
  const btnH = solo ? 112 : 92
  const btnY = solo ? h - 190 : h - btnH - 22
  const y0 = HEADER + (solo ? 50 : 26)
  const rows = Math.max(1, Math.ceil(cells / COLS))
  // Solo: big cells while the grid ends above the pause button's band, narrower below it.
  const big = solo && y0 + rows * 104 <= 790
  const p = big ? 104 : Math.min(solo ? 86 : 92, Math.floor((btnY - 26 - y0) / rows))
  return {
    p,
    x0: (w - COLS * p) / 2,
    y0,
    btn: { x: 150, y: btnY, w: w - 300, h: btnH },
  }
}

/** Top-left of cell i in panel-local coordinates. */
export function cellOrigin(g: Geo, i: number): { x: number; y: number } {
  return { x: g.x0 + (i % COLS) * g.p, y: g.y0 + Math.floor(i / COLS) * g.p }
}

export function cellCenter(g: Geo, i: number): { x: number; y: number } {
  const o = cellOrigin(g, i)
  return { x: o.x + g.p / 2, y: o.y + g.p / 2 }
}

/** The cell under a panel-local point, or -1. */
export function cellAt(g: Geo, n: number, px: number, py: number): number {
  const col = Math.floor((px - g.x0) / g.p)
  const row = Math.floor((py - g.y0) / g.p)
  if (col < 0 || col >= COLS || row < 0) return -1
  const i = row * COLS + col
  return i < n ? i : -1
}

export function inButton(g: Geo, px: number, py: number): boolean {
  const b = g.btn
  return px >= b.x - 10 && px <= b.x + b.w + 10 && py >= b.y - 10 && py <= b.y + b.h + 10
}

/** A crossed-out pair, for its exit: where the two numbers stood (panel-local) and what they were. */
export interface Hit {
  ax: number
  ay: number
  bx: number
  by: number
  a: number
  b: number
  size: number
  at: number
}

/** Rows that just collapsed: their original indices and the pitch at the time. */
export interface Shift {
  rows: number[]
  p: number
  at: number
}

export interface BoardView {
  side: Side
  vals: readonly number[]
  sel: number
  /** Cells that would pair with the selection. */
  partner: readonly boolean[]
  bad: number
  badAt: number
  addFrom: number
  addAt: number
  hit: Hit | null
  shift: Shift | null
  now: number
}

const CELL_GAP = 10
const HIT_T = 0.38
const SHIFT_T = 0.24

/** How far down a cell in row r was before the last collapse moved it up (in pitches). */
function lifted(shift: Shift, r: number): number {
  let old = r
  for (const rm of shift.rows) if (rm <= old) old++
  return old - r
}

/** One number tile, centred on (0, 0). */
function numberTile(g: Draw, c: number, val: number, face: string, raised: number): void {
  g.tile(-c / 2, -c / 2 - raised, c, c, c * 0.24, face, Math.max(6, c * 0.12))
  g.text(String(val), 0, -c * 0.06 - raised, {
    // Readable floor (34 units) even when a 10-row board shrinks the cells.
    size: Math.max(c * 0.6, 34),
    weight: 700,
    color: face === C.cream ? C.ink : shade(face, -0.75),
  })
}

/** The grid: numbers on cream tiles, crossed-out cells as wells, and the animations of the last move. */
export function drawBoard(g: Draw, geo: Geo, v: BoardView): void {
  const col = SIDE[v.side]
  const p = geo.p
  const c = p - CELL_GAP
  const rows = Math.ceil(v.vals.length / COLS)
  // The tray the grid sits in.
  const bw = COLS * p + 24
  const bh = Math.max(1, rows) * p + 24
  g.rrect(geo.x0 - 12, geo.y0 - 12 + 8, bw, bh, 34, alpha('#000000', 0.35))
  g.rrect(geo.x0 - 12, geo.y0 - 12, bw, bh, 34, shade(col.main, -0.7), alpha(col.main, 0.45), 4)
  const sh = v.shift && v.now - v.shift.at < SHIFT_T ? v.shift : null
  const slide = sh ? 1 - outCubic(prog(v.now - sh.at, 0, SHIFT_T)) : 0
  const pulse = 0.5 + 0.5 * Math.sin(v.now * 8)
  v.vals.forEach((val, i) => {
    const o = cellOrigin(geo, i)
    const dy = sh ? lifted(sh, Math.floor(i / COLS)) * sh.p * slide : 0
    const cx = o.x + p / 2
    const cy = o.y + p / 2 + dy
    if (!val) {
      g.rrect(cx - c / 2, cy - c / 2, c, c, c * 0.24, alpha('#000000', 0.32))
      g.circle(cx, cy, c * 0.06, alpha(C.white, 0.1))
      return
    }
    const fresh = i >= v.addFrom && v.now - v.addAt < 1.2
    const s = fresh
      ? outBack(prog(v.now - v.addAt - Math.min(i - v.addFrom, 25) * 0.022, 0, 0.28))
      : 1
    if (s <= 0) return
    const sel = i === v.sel
    const hot = v.bad === i && v.now - v.badAt < 0.35
    const wob = hot ? Math.sin((v.now - v.badAt) * 60) * 0.12 * (1 - (v.now - v.badAt) / 0.35) : 0
    g.at(
      cx,
      cy,
      wob,
      () => {
        if (v.partner[i] && v.sel >= 0) {
          g.rrect(
            -c / 2 - 7,
            -c / 2 - 7,
            c + 14,
            c + 14,
            c * 0.3,
            undefined,
            alpha(col.light, 0.5 + pulse * 0.5),
            5,
          )
        }
        if (sel) g.rrect(-c / 2 - 8, -c / 2 - 6, c + 16, c + 16, c * 0.32, alpha(C.yellow, 0.3))
        numberTile(
          g,
          c,
          val,
          hot ? mix(C.cream, C.red, 0.55) : sel ? C.yellow : C.cream,
          sel ? 5 : 0,
        )
      },
      s * (sel ? 1.06 : 1),
    )
  })
  if (v.hit) drawHit(g, v.hit, v.now, col.light)
}

/** The crossed-out pair: a link flashes between them as both tiles spin away. */
function drawHit(g: Draw, h: Hit, now: number, light: string): void {
  const age = now - h.at
  if (age < 0 || age > HIT_T) return
  const t = age / HIT_T
  const link = 1 - prog(t, 0.2, 0.8)
  if (link > 0) {
    g.line(h.ax, h.ay, h.bx, h.by, alpha(C.yellow, link), 14 * link + 2)
    g.line(h.ax, h.ay, h.bx, h.by, alpha(C.white, link * 0.8), 5 * link + 1)
  }
  const s = 1 - outCubic(prog(t, 0.1, 1))
  if (s <= 0.02) return
  const spin = outCubic(t) * 0.9
  const pair: [number, number, number, number][] = [
    [h.ax, h.ay, h.a, -1],
    [h.bx, h.by, h.b, 1],
  ]
  for (const [x, y, val, dir] of pair) {
    g.at(
      x,
      y - outCubic(t) * 30,
      spin * dir,
      () => numberTile(g, h.size, val, mix(C.yellow, light, t), 0),
      0.2 + s * 0.95,
    )
  }
}

/** The Add button: Adds left as pips; it glows when no pair is left on the board. */
export function drawAdd(
  g: Draw,
  geo: Geo,
  side: Side,
  adds: number,
  o: { stuck: boolean; now: number; pressAt: number },
): void {
  const b = geo.btn
  const col = SIDE[side]
  const left = ADDS - adds
  const on = left > 0
  const call = on && o.stuck
  const pulse = call ? 0.5 + 0.5 * Math.sin(o.now * 7) : 0
  const pressed = Math.max(0, 1 - (o.now - o.pressAt) / 0.18)
  if (call) {
    g.rrect(b.x - 14, b.y - 12, b.w + 28, b.h + 26, 44, alpha(C.yellow, 0.18 + pulse * 0.3))
  }
  const face = call ? C.yellow : on ? col.main : shade(col.main, -0.6)
  g.tile(b.x, b.y, b.w, b.h, 34, face, 14, pressed)
  const ty = b.y + (b.h - 14) / 2 + 14 * pressed
  const ink = call ? C.ink : on ? C.white : alpha(C.white, 0.45)
  g.text(on ? 'Add numbers' : 'No adds left', b.x + b.w / 2 - (on ? 40 : 0), ty, {
    size: 40,
    weight: 700,
    color: ink,
  })
  if (!on) return
  for (let k = 0; k < ADDS; k++) {
    const x = b.x + b.w - 116 + k * 36
    const full = k < left
    g.circle(x, ty, 12, full ? (call ? C.ink : C.white) : alpha(call ? C.ink : C.white, 0.25))
  }
}

/** A floodlight pool behind the board. */
export function backdrop(g: Draw, side: Side, geo: Geo, rows: number): void {
  floodlight(g, side, geo.x0 + (COLS * geo.p) / 2, geo.y0 + (rows * geo.p) / 2, 640)
}
