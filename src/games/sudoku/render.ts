import type { Side } from '../../core/game.ts'
import { outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { fmtTime, HEADER, type Key, keypad } from '../../engines/puzzle/index.ts'
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
 * the whole stage (solo) they sit in a row above it. The newest pip pops in.
 */
export function drawRoundWins(
  g: Draw,
  side: Side,
  w: number,
  h: number,
  wins: number,
  goal: number,
  wonAt = -10,
): void {
  const solo = h > 1000
  const l = layout(w, h)
  const mid = l.y0 + (9 * l.c) / 2
  const gap = solo ? 64 : 60
  const col = SIDE[side].main
  const pop = prog(g.t - wonAt, 0, 0.5)
  for (let i = 0; i < goal; i++) {
    const off = (i - (goal - 1) / 2) * gap
    const x = solo ? w / 2 + off : 66
    const y = solo ? l.y0 - 70 : mid + off
    const on = i < wins
    const fresh = on && i === wins - 1 && pop < 1
    const s = fresh ? outBack(pop) : 1
    if (fresh) g.alpha(1 - pop, () => g.ring(x, y, 18 + pop * 40, SIDE[side].light, 6))
    g.circle(x, y, 18, alpha(C.white, 0.14))
    if (on)
      g.at(
        x,
        y,
        0,
        () => {
          g.circle(0, 0, 18, col)
          g.circle(-5, -5, 6, alpha(C.white, 0.6))
        },
        s,
      )
  }
}

/** The how-to-play hint, a plate over the middle of the board for the first seconds. */
export function drawHint(g: Draw, l: Layout): void {
  const text = 'Tap a square, then a number'
  const cy = l.y0 + (9 * l.c) / 2
  const x = l.x0 + (9 * l.c) / 2
  const w = g.measure(text, 34, 600) + 60
  const bob = Math.sin(g.t * 3) * 4
  g.rrect(x - w / 2, cy - 36 + bob, w, 72, 36, alpha(C.ink, 0.82))
  g.text(text, x, cy + 2 + bob, { size: 34, weight: 600, color: C.white })
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
  /** Where the selection box is drawn this frame (cell units), gliding toward `sel`. */
  selVis: { x: number; y: number } | null
  errCell: number
  errKey: number
  errAt: number
  last: number
  lastAt: number
  flash: readonly number[]
  flashAt: number
  /** Last key pressed and when: it dips. */
  key: number
  keyAt: number
  counts: readonly number[]
  /** Game time the board was solved, or null. */
  doneAt: number | null
  /** The rival's finished time this side must still beat, or null. */
  beat: number | null
  /** Game time this puzzle was dealt (its cells pop in), or far in the past. */
  dealtAt: number
  now: number
  /** Draw the number pad (off for the rival's half online: each phone shows its own controls). */
  pad: boolean
}

/** A soft pool of team-coloured light under the play area: the floodlit table. */
function floodlight(g: Draw, side: Side, x: number, y: number, r: number, breath: number): void {
  g.circle(
    x,
    y,
    r,
    g.rad(x, y, 0, r, [
      [0, alpha(SIDE[side].main, 0.17 + 0.05 * breath)],
      [0.55, alpha(SIDE[side].main, 0.07)],
      [1, alpha(SIDE[side].main, 0)],
    ]),
  )
}

/** Cell distance (Chebyshev) between two cells, for waves that spread from a cell. */
const dist = (a: number, b: number): number =>
  Math.max(Math.abs((a % 9) - (b % 9)), Math.abs(Math.floor(a / 9) - Math.floor(b / 9)))

/** A digit's stamp: dropped in big, squashed on contact, settling with a wobble. */
function stamp(t: number): number {
  if (t >= 1) return 1
  if (t < 0.3) return 1.55 - 0.7 * outCubic(t / 0.3)
  return 0.85 + 0.15 * outBack((t - 0.3) / 0.7)
}

export function drawPanel(g: Draw, l: Layout, v: PanelView): void {
  const col = SIDE[v.side]
  const { x0, y0, c } = l
  const size = c * 9
  const now = v.now
  const selVal = v.sel >= 0 ? (v.cells[v.sel] ?? 0) : 0
  floodlight(g, v.side, x0 + size / 2, y0 + size / 2, size * 0.95, Math.sin(now * 1.6))
  // A fresh puzzle drops onto the table.
  const deal = prog(now - v.dealtAt, 0, 0.45)
  const ds = deal < 1 ? 0.9 + 0.1 * outBack(deal) : 1
  const board = (): void => {
    // Paper board on a lip.
    g.rrect(x0 - 14, y0 - 14 + 10, size + 28, size + 28, 26, alpha('#000000', 0.35))
    g.rrect(x0 - 14, y0 - 14, size + 28, size + 28, 26, C.cream)
    const err = Math.max(0, 1 - (now - v.errAt) * 2.5)
    const flashT = now - v.flashAt
    const solvedT = v.doneAt === null ? -1 : now - v.doneAt
    for (let i = 0; i < 81; i++) {
      const x = x0 + (i % 9) * c
      const y = y0 + Math.floor(i / 9) * c
      let bg: string | null = null
      if (v.sel >= 0 && sameUnit(i, v.sel)) bg = alpha(col.main, 0.1)
      if (selVal && v.cells[i] === selVal) bg = alpha(col.main, 0.26)
      if (bg) g.rect(x, y, c, c, bg)
      // A completed row / column / box lights up in a wave from the cell that closed it.
      if (flashT < 1.2 && v.flash.includes(i)) {
        const k = prog(flashT - dist(i, v.last) * 0.045, 0, 0.5)
        if (k > 0 && k < 1) g.alpha((1 - k) * 0.8, () => g.rect(x, y, c, c, C.yellow))
      }
      // Solved: a gold wave rolls over the whole board.
      if (solvedT >= 0 && solvedT < 1.6) {
        const k = prog(solvedT - dist(i, v.last) * 0.06, 0, 0.55)
        if (k > 0 && k < 1) g.alpha(Math.sin(k * Math.PI) * 0.7, () => g.rect(x, y, c, c, C.yellow))
      }
      if (i === v.errCell && err > 0) g.alpha(err, () => g.rect(x, y, c, c, alpha(C.red, 0.75)))
    }
    // The selection box glides between cells and breathes while it waits.
    if (v.selVis) {
      const sx = x0 + v.selVis.x * c
      const sy = y0 + v.selVis.y * c
      const breath = 0.5 + 0.5 * Math.sin(now * 4)
      g.rect(sx, sy, c, c, mix(C.yellow, C.cream, 0.25 + 0.15 * breath))
    }
    // Grid: thin cell lines, bold box lines.
    for (let k = 0; k <= 9; k++) {
      const bold = k % 3 === 0
      const lw = bold ? 5 : 2
      const color = bold ? alpha(C.ink, 0.75) : alpha(C.ink, 0.16)
      g.line(x0 + k * c, y0, x0 + k * c, y0 + size, color, lw, 'square')
      g.line(x0, y0 + k * c, x0 + size, y0 + k * c, color, lw, 'square')
    }
    if (v.selVis) {
      const sx = x0 + v.selVis.x * c
      const sy = y0 + v.selVis.y * c
      g.rrect(sx + 2, sy + 2, c - 4, c - 4, 8, undefined, shade(C.yellow, -0.25), 4)
    }
    // The last digit placed sends a ring out of its cell.
    const lastT = now - v.lastAt
    if (v.last >= 0 && lastT < 0.4) {
      const k = lastT / 0.4
      const cx = x0 + (v.last % 9) * c + c / 2
      const cy = y0 + Math.floor(v.last / 9) * c + c / 2
      g.alpha(1 - k, () =>
        g.ring(cx, cy, c * (0.35 + 0.5 * outCubic(k)), col.main, 5 * (1 - k) + 1),
      )
    }
    for (let i = 0; i < 81; i++) {
      const d = v.cells[i]
      if (!d) continue
      const x = x0 + (i % 9) * c + c / 2
      let y = y0 + Math.floor(i / 9) * c + c / 2 + c * 0.04
      const given = v.puzzle[i] !== 0
      let s = i === v.last ? stamp(prog(lastT, 0, 0.32)) : 1
      // Digits hop as the wave passes over them.
      if (flashT < 1.2 && v.flash.includes(i)) {
        const k = prog(flashT - dist(i, v.last) * 0.045, 0, 0.35)
        if (k > 0 && k < 1) y -= Math.sin(k * Math.PI) * c * 0.14
      }
      if (solvedT >= 0) {
        const k = prog(solvedT - dist(i, v.last) * 0.06, 0, 0.4)
        if (k > 0 && k < 1) {
          y -= Math.sin(k * Math.PI) * c * 0.2
          s *= 1 + Math.sin(k * Math.PI) * 0.15
        }
      }
      // A fresh puzzle's givens pop in, top-left first.
      if (deal < 1)
        s *= outBack(prog(now - v.dealtAt - ((i % 9) + Math.floor(i / 9)) * 0.012, 0, 0.3))
      if (s <= 0.01) continue
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
    // A wrong digit shows in red in its cell, shakes its head and fades away.
    if (v.errCell >= 0 && v.errKey >= 0 && now - v.errAt < 0.55) {
      const k = (now - v.errAt) / 0.55
      const x = x0 + (v.errCell % 9) * c + c / 2 + Math.sin(k * Math.PI * 7) * 9 * (1 - k)
      const y = y0 + Math.floor(v.errCell / 9) * c + c / 2 + c * 0.04
      g.alpha(1 - k * k, () =>
        g.text(v.errKey + 1, x, y, { size: c * 0.62, weight: 700, color: shade(C.red, -0.25) }),
      )
    }
  }
  if (ds !== 1)
    g.at(x0 + size / 2, y0 + size / 2, 0, () => g.at(-x0 - size / 2, -y0 - size / 2, 0, board), ds)
  else board()
  if (v.pad) drawPad(g, l.keys, col.main, v)
  if (v.beat !== null) drawBeat(g, l, v.side, v.beat, now)
}

/** The number pad: keys dip under the finger, a wrong key shakes, a finished digit greys out with a tick. */
function drawPad(g: Draw, keys: readonly Key[], color: string, v: PanelView): void {
  const now = v.now
  const errT = now - v.errAt
  const lastDigit = v.last >= 0 ? (v.cells[v.last] ?? 0) : 0
  keys.forEach((k, i) => {
    const done = (v.counts[i + 1] ?? 0) >= 9
    const wrong = v.errKey === i && errT < 0.3
    let s = 1
    if (v.key === i) {
      const t = prog(now - v.keyAt, 0, 0.22)
      if (t < 1) s = t < 0.3 ? 1 - 0.12 * (t / 0.3) : 0.88 + 0.12 * outBack((t - 0.3) / 0.7)
    }
    // The digit that just reached nine glows gold for a moment.
    const crowned = done && lastDigit === i + 1 ? Math.max(0, 1 - (now - v.lastAt) * 1.5) : 0
    const dx = wrong ? Math.sin(errT * 60) * 8 * (1 - errT / 0.3) : 0
    const fill = done ? shade(color, -0.55) : wrong ? C.red : color
    g.at(
      k.x + k.w / 2 + dx,
      k.y + k.h / 2,
      0,
      () => {
        if (crowned > 0)
          g.alpha(crowned, () =>
            g.rrect(-k.w / 2 - 8, -k.h / 2 - 8, k.w + 16, k.h + 16, 24, C.yellow),
          )
        g.tile(-k.w / 2, -k.h / 2, k.w, k.h, 18, fill, 9, wrong ? 1 : 0)
        g.text(k.label, 0, -9 / 2 + 2, {
          size: Math.min(k.h * 0.55, k.w * 0.6),
          weight: 700,
          color: done ? alpha(C.white, 0.35) : C.white,
        })
      },
      s,
    )
  })
}

/** The rival has finished: the time to beat, in the margin beside the board. */
function drawBeat(g: Draw, l: Layout, side: Side, beat: number, now: number): void {
  const x = l.x0 + l.c * 9 + (1000 - l.x0 - l.c * 9) / 2
  const y = l.y0 + l.c * 4.5
  const pulse = 1 + 0.04 * Math.sin(now * 6)
  g.at(
    x,
    y,
    0,
    () => {
      g.rrect(-62, -66, 124, 132, 28, alpha(SIDE[side === 0 ? 1 : 0].dark, 0.92))
      g.text('Beat', 0, -26, { size: 34, weight: 600, color: alpha(C.white, 0.85) })
      g.text(fmtTime(beat), 0, 24, { size: 38, weight: 700, color: C.yellow })
    },
    pulse,
  )
}
