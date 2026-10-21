import type { Side } from '../../core/game.ts'
import { lerp, outBack, outCubic, prog } from '../../core/fx/ease.ts'
import type { Draw } from '../../core/render/draw.ts'
import { C, SIDE, alpha, mix, shade } from '../../core/render/palette.ts'
import { HEADER } from '../../engines/puzzle/index.ts'
import { CELLS, colOf, rowOf, SIZE } from './rules.ts'

/** How long a slide takes to glide into place (s). */
export const SLIDE_TIME = 0.15

export interface Layout {
  x0: number
  y0: number
  /** Tile size and the gutter between tiles (world units). */
  c: number
  gap: number
}

/**
 * The board inside a panel of w × h (a half: 1000 × 900, or the whole stage in
 * solo). In solo the board stays right of x = 110 so no tile sits under the
 * pause button (left edge, mid-height).
 */
export function layout(w: number, h: number): Layout {
  const solo = h > 1000
  const c = solo ? 184 : 152
  const gap = solo ? 12 : 12
  const size = c * SIZE + gap * (SIZE - 1)
  const x0 = (w - size) / 2
  const y0 = HEADER + (h - HEADER - size) / 2 - (solo ? 20 : 24)
  return { x0, y0, c, gap }
}

/** The cell under a panel-local point (nearest cell, so the gutters count too), or -1 well outside the board. */
export function cellAt(l: Layout, x: number, y: number): number {
  const pitch = l.c + l.gap
  const col = Math.round((x - l.x0 - l.c / 2) / pitch)
  const row = Math.round((y - l.y0 - l.c / 2) / pitch)
  if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return -1
  return row * SIZE + col
}

/** Panel-local centre of a cell. */
export function cellCentre(l: Layout, i: number): { x: number; y: number } {
  const pitch = l.c + l.gap
  return { x: l.x0 + colOf(i) * pitch + l.c / 2, y: l.y0 + rowOf(i) * pitch + l.c / 2 }
}

/**
 * A tile's colour: a gradient through the side's family, so a solved board
 * reads as one smooth sweep (red: orange → red → pink, blue: cyan → blue → purple).
 */
export function tileColor(side: Side, value: number): string {
  const [a, b, c] = side === 0 ? [C.orange, C.red, C.pink] : [C.cyan, C.blue, C.purple]
  const t = (value - 1) / (CELLS - 2)
  return t < 0.5 ? mix(a, b, t * 2) : mix(b, c, (t - 0.5) * 2)
}

export interface BoardView {
  side: Side
  tiles: readonly number[]
  from: readonly number[]
  movedAt: number
  /** Cells of a row / column that just fell into place, and when. */
  glow: readonly number[]
  glowAt: number
  /** A tap that could not move anything: the tile shakes its head. */
  nope: number
  nopeAt: number
  /** Show the tiles that can move (start of a human's game). */
  hint: boolean
  /** When the board was solved (null while playing): the tiles do a wave. */
  doneAt: number | null
  now: number
}

function tileBlock(
  g: Draw,
  x: number,
  y: number,
  c: number,
  value: number,
  side: Side,
  home: boolean,
): void {
  const depth = Math.round(c * 0.1)
  const color = tileColor(side, value)
  g.tile(x, y, c, c, c * 0.18, color, depth)
  // A soft sheen across the top third, over the gloss the tile already has.
  g.rrect(
    x + c * 0.08,
    y + c * 0.07,
    c * 0.84,
    (c - depth) * 0.3,
    c * 0.1,
    g.lin(0, y, 0, y + c * 0.4, [
      [0, alpha('#ffffff', 0.24)],
      [1, alpha('#ffffff', 0)],
    ]),
  )
  const cy = y + (c - depth) / 2 + 3
  g.text(value, x + c / 2, cy, {
    size: c * 0.5,
    weight: 700,
    color: C.white,
    drop: alpha(shade(color, -0.6), 0.55),
  })
  // A tile on its home cell wears a little light: you can see what is done.
  if (home) {
    const r = c * 0.055
    g.circle(x + c - c * 0.16, y + c - depth - c * 0.15, r + 3, alpha(shade(color, -0.5), 0.5))
    g.circle(x + c - c * 0.16, y + c - depth - c * 0.15, r, C.white)
  }
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

export function drawBoard(g: Draw, l: Layout, v: BoardView): void {
  const { x0, y0, c, gap } = l
  const pitch = c + gap
  const size = pitch * SIZE - gap
  const col = SIDE[v.side]
  floodlight(g, v.side, x0 + size / 2, y0 + size / 2, size * 1.05)
  // The tray the tiles sit in: a lipped frame in the side's colour around a sunken well.
  g.rrect(x0 - 28, y0 - 14, size + 56, size + 56, 46, alpha('#000000', 0.4))
  g.rrect(
    x0 - 28,
    y0 - 28,
    size + 56,
    size + 56,
    46,
    g.lin(0, y0 - 28, 0, y0 + size + 28, [
      [0, shade(col.main, -0.05)],
      [1, shade(col.dark, -0.35)],
    ]),
  )
  g.rrect(x0 - 16, y0 - 16, size + 32, size + 32, 34, shade(col.dark, -0.72))
  // Inner shadow along the top of the well: it reads as a recess.
  g.rrect(
    x0 - 16,
    y0 - 16,
    size + 32,
    40,
    20,
    g.lin(0, y0 - 16, 0, y0 + 24, [
      [0, alpha('#000000', 0.45)],
      [1, alpha('#000000', 0)],
    ]),
  )
  // Sockets, so the gap reads as a hole.
  for (let i = 0; i < CELLS; i++) {
    const p = cellCentre(l, i)
    g.rrect(p.x - c / 2, p.y - c / 2, c, c, c * 0.18, alpha('#000000', 0.3))
    g.rrect(p.x - c / 2, p.y - c / 2 + c - 8, c, 8, 4, alpha(col.light, 0.05))
  }

  // Rows / columns that just fell into place glow under their tiles.
  const glow = 1 - prog(v.now - v.glowAt, 0, 0.7)
  if (glow > 0) {
    for (const i of v.glow) {
      const p = cellCentre(l, i)
      g.alpha(glow, () =>
        g.rrect(p.x - c / 2 - 8, p.y - c / 2 - 8, c + 16, c + 16, c * 0.24, alpha(C.yellow, 0.75)),
      )
    }
  }

  const gapCell = v.tiles.indexOf(0)
  const t = prog(v.now - v.movedAt, 0, SLIDE_TIME)
  const e = outCubic(t)
  // The tiles that just arrived squash a touch as they hit the stop.
  const land = prog(v.now - v.movedAt, SLIDE_TIME * 0.7, SLIDE_TIME + 0.16)
  const squash = land > 0 && land < 1 ? Math.sin(land * Math.PI) * 0.07 : 0
  const pulse = 0.5 + 0.5 * Math.sin(v.now * 7)
  for (let i = 0; i < CELLS; i++) {
    const value = v.tiles[i] as number
    if (!value) continue
    const from = v.from[i] as number
    const moved = from !== i
    const fx = moved ? lerp(colOf(from), colOf(i), e) : colOf(i)
    const fy = moved ? lerp(rowOf(from), rowOf(i), e) : rowOf(i)
    let x = x0 + fx * pitch
    let y = y0 + fy * pitch
    let sx = 1
    let sy = 1
    if (moved && squash > 0) {
      const horiz = rowOf(from) === rowOf(i)
      sx = horiz ? 1 - squash : 1 + squash * 0.6
      sy = horiz ? 1 + squash * 0.6 : 1 - squash
    }
    if (i === v.nope) {
      const k = prog(v.now - v.nopeAt, 0, 0.3)
      if (k < 1) x += Math.sin(k * Math.PI * 6) * 10 * (1 - k)
    }
    if (v.doneAt !== null) {
      // The win wave: tiles hop one after another in reading order.
      const k = prog(v.now - v.doneAt - i * 0.045, 0, 0.32)
      const hop = Math.sin(k * Math.PI)
      y -= hop * c * 0.16
      sx = sy = 1 + hop * 0.06
    }
    if (v.hint && !moved && gapCell >= 0 && isNext(i, gapCell)) {
      g.alpha(0.35 + 0.5 * pulse, () =>
        g.rrect(x - 7, y - 7, c + 14, c + 14, c * 0.22, undefined, C.yellow, 7),
      )
    }
    const home = value === i + 1 && (!moved || t >= 1)
    if (sx !== 1 || sy !== 1) {
      g.at(x + c / 2, y + c, 0, () => tileBlock(g, -c / 2, -c, c, value, v.side, home), sx, sy)
    } else tileBlock(g, x, y, c, value, v.side, home)
  }
}

function isNext(a: number, b: number): boolean {
  return (
    (rowOf(a) === rowOf(b) && Math.abs(colOf(a) - colOf(b)) === 1) ||
    (colOf(a) === colOf(b) && Math.abs(rowOf(a) - rowOf(b)) === 1)
  )
}

/** A small chip (move count, best time) under the board, with an optional emoji. */
export function chip(g: Draw, x: number, y: number, label: string, side: Side, icon = ''): void {
  const w = g.measure(label, 34, 600) + 60 + (icon ? 44 : 0)
  if (icon) {
    g.rrect(x - w / 2, y - 26, w, 52, 26, alpha(shade(SIDE[side].main, -0.6), 0.9))
    g.emoji(icon, x - w / 2 + 44, y, 32)
    g.text(label, x + 22, y + 2, { size: 34, weight: 600, color: alpha(C.white, 0.8) })
    return
  }
  g.rrect(x - w / 2, y - 26, w, 52, 26, alpha(shade(SIDE[side].main, -0.6), 0.9))
  g.text(label, x, y + 2, { size: 34, weight: 600, color: alpha(C.white, 0.8) })
}

/** Scale for a value that pops in when it changes. */
export function popAt(now: number, at: number): number {
  const k = prog(now - at, 0, 0.25)
  return k >= 1 ? 1 : 0.85 + 0.15 * outBack(k)
}
