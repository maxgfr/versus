import type { Side } from '../../core/game.ts'
import { outBack, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix } from '../../core/render/palette.ts'
import { drawKeys, HEADER, type Key, keypad } from '../../engines/puzzle/index.ts'
import { sameUnit } from './rules.ts'

export interface Layout {
  x0: number
  y0: number
  c: number
  keys: Key[]
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** Board and number pad for a panel of w × h (a half: 1000 × 900, or the whole stage in solo). */
export function layout(w: number, h: number): Layout {
  const solo = h > 1000
  const c = solo ? 104 : 78
  const board = c * 9
  const keyH = solo ? 128 : 74
  const gap = solo ? 44 : 12
  const total = board + gap + keyH
  const y0 = solo ? HEADER + (h - HEADER - total) / 2 : HEADER + 10
  const x0 = (w - board) / 2
  const kw = solo ? board : 936
  return {
    x0,
    y0,
    c,
    keys: keypad(DIGITS, (w - kw) / 2, y0 + board + gap, kw, keyH, 9, solo ? 10 : 8),
  }
}

/**
 * Round wins as pips. In a half they run down the margin beside the board; on
 * the whole stage (solo) they sit in a row above it.
 */
export function drawRoundWins(
  g: Draw,
  side: Side,
  w: number,
  h: number,
  wins: number,
  goal: number,
): void {
  const solo = h > 1000
  const l = layout(w, h)
  const mid = l.y0 + (9 * l.c) / 2
  const gap = solo ? 64 : 60
  const col = SIDE[side].main
  for (let i = 0; i < goal; i++) {
    const off = (i - (goal - 1) / 2) * gap
    const x = solo ? w / 2 + off : 66
    const y = solo ? l.y0 - 70 : mid + off
    const on = i < wins
    g.circle(x, y, 18, on ? col : alpha(C.white, 0.14))
    if (on) g.circle(x - 5, y - 5, 6, alpha(C.white, 0.6))
  }
}

/** The how-to-play hint, a plate over the middle of the board for the first seconds. */
export function drawHint(g: Draw, l: Layout): void {
  const text = 'Tap a square, then a number'
  const cy = l.y0 + (9 * l.c) / 2
  const x = l.x0 + (9 * l.c) / 2
  const w = g.measure(text, 34, 600) + 60
  g.rrect(x - w / 2, cy - 36, w, 72, 36, alpha(C.ink, 0.82))
  g.text(text, x, cy + 2, { size: 34, weight: 600, color: C.white })
}

export function cellAt(l: Layout, x: number, y: number): number {
  const col = Math.floor((x - l.x0) / l.c)
  const row = Math.floor((y - l.y0) / l.c)
  if (col < 0 || row < 0 || col > 8 || row > 8) return -1
  return row * 9 + col
}

export interface PanelView {
  side: Side
  puzzle: readonly number[]
  cells: readonly number[]
  sel: number
  errCell: number
  errKey: number
  errAt: number
  last: number
  lastAt: number
  flash: readonly number[]
  flashAt: number
  counts: readonly number[]
  now: number
}

/** A soft pool of team-coloured light under the play area: the floodlit table. */
function floodlight(g: Draw, side: Side, x: number, y: number, r: number): void {
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 0, r, [
      [0, alpha(SIDE[side].main, 0.2)],
      [0.55, alpha(SIDE[side].main, 0.07)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
}

export function drawPanel(g: Draw, l: Layout, v: PanelView): void {
  const col = SIDE[v.side]
  const { x0, y0, c } = l
  const size = c * 9
  const selVal = v.sel >= 0 ? (v.cells[v.sel] ?? 0) : 0
  floodlight(g, v.side, x0 + size / 2, y0 + size / 2, size * 0.95)
  // Paper board on a lip.
  g.rrect(x0 - 14, y0 - 14 + 10, size + 28, size + 28, 26, alpha('#000000', 0.35))
  g.rrect(x0 - 14, y0 - 14, size + 28, size + 28, 26, C.cream)
  const err = Math.max(0, 1 - (v.now - v.errAt) * 2.5)
  const flash = Math.max(0, 1 - (v.now - v.flashAt) * 1.6)
  for (let i = 0; i < 81; i++) {
    const x = x0 + (i % 9) * c
    const y = y0 + Math.floor(i / 9) * c
    let bg: string | null = null
    if (v.sel >= 0 && sameUnit(i, v.sel)) bg = alpha(col.main, 0.1)
    if (selVal && v.cells[i] === selVal) bg = alpha(col.main, 0.26)
    if (i === v.sel) bg = mix(C.yellow, C.cream, 0.25)
    if (bg) g.rect(x, y, c, c, bg)
    if (flash > 0 && v.flash.includes(i)) g.alpha(flash * 0.7, () => g.rect(x, y, c, c, C.yellow))
    if (i === v.errCell && err > 0) g.alpha(err, () => g.rect(x, y, c, c, alpha(C.red, 0.75)))
  }
  // Grid: thin cell lines, bold box lines.
  for (let k = 0; k <= 9; k++) {
    const bold = k % 3 === 0
    const lw = bold ? 5 : 2
    const color = bold ? alpha(C.ink, 0.75) : alpha(C.ink, 0.16)
    g.line(x0 + k * c, y0, x0 + k * c, y0 + size, color, lw, 'square')
    g.line(x0, y0 + k * c, x0 + size, y0 + k * c, color, lw, 'square')
  }
  for (let i = 0; i < 81; i++) {
    const d = v.cells[i]
    if (!d) continue
    const x = x0 + (i % 9) * c + c / 2
    const y = y0 + Math.floor(i / 9) * c + c / 2 + c * 0.04
    const given = v.puzzle[i] !== 0
    const s = i === v.last ? outBack(prog(v.now - v.lastAt, 0, 0.3)) : 1
    g.at(
      x,
      y,
      0,
      () =>
        g.text(d, 0, 0, {
          size: c * 0.62,
          weight: given ? 700 : 600,
          color: given ? C.ink : col.dark,
        }),
      s,
    )
  }
  drawKeys(g, l.keys, col.main, {
    dim: (i) => (v.counts[i + 1] ?? 0) >= 9,
    flash: v.errKey,
    flashAt: v.errAt,
    now: v.now,
  })
}
