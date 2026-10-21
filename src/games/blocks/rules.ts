import { Rng } from '../../core/rng.ts'

/**
 * Pure block puzzle. The grid is N × N, row-major: 0 = empty, otherwise
 * colour + 1. A piece is a code `shape * COLORS + colour`. Trays are dealt from
 * one seeded sequence, so both players get the same pieces in the same order.
 */

export const N = 8
export const COLORS = 6
export const TRAY = 3

/** A block of a piece, as [column, row] offsets from the piece's top-left. */
export type Cell = readonly [number, number]

export interface Shape {
  cells: Cell[]
  /** Bounding box in blocks. */
  w: number
  h: number
  /** Relative chance of being dealt. */
  weight: number
}

/** Shapes as art: X is a block, rows read top to bottom. */
const ART: readonly (readonly [number, readonly string[]])[] = [
  [3, ['X']],
  [3, ['XX']],
  [3, ['X', 'X']],
  [2, ['XXX']],
  [2, ['X', 'X', 'X']],
  [3, ['XX', 'XX']],
  [2, ['X.', 'XX']],
  [2, ['XX', 'X.']],
  [2, ['.X', 'XX']],
  [2, ['XX', '.X']],
  [1, ['XXXX']],
  [1, ['X', 'X', 'X', 'X']],
  [1, ['XXX', '.X.']],
  [1, ['XXX', 'X..']],
  [1, ['XXX', '..X']],
  [1, ['X.', 'X.', 'XX']],
  [1, ['.X', '.X', 'XX']],
  [1, ['XX.', '.XX']],
  [1, ['.XX', 'XX.']],
  [1, ['X..', 'X..', 'XXX']],
  [1, ['..X', '..X', 'XXX']],
  [1, ['.X.', 'XXX', '.X.']],
  [0.5, ['XXX', 'XXX', 'XXX']],
]

export const SHAPES: readonly Shape[] = ART.map(([weight, rows]) => {
  const cells: Cell[] = []
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === 'X') cells.push([x, y])
    })
  })
  return { cells, w: Math.max(...rows.map((r) => r.length)), h: rows.length, weight }
})

export const codeOf = (shape: number, color: number): number => shape * COLORS + color
export const shapeOf = (code: number): number => Math.floor(code / COLORS)
export const colorOf = (code: number): number => code % COLORS

/** Trays in the shared deal: long enough for any game (later trays wrap around). */
export const SEQUENCE_TRAYS = 240

/** Piece codes for `trays` trays, three per tray, from one seed. */
export function pieceSequence(seed: number, trays = SEQUENCE_TRAYS): number[] {
  const rng = new Rng(seed)
  const total = SHAPES.reduce((t, s) => t + s.weight, 0)
  const out: number[] = []
  for (let i = 0; i < trays * TRAY; i++) {
    let r = rng.next() * total
    let s = 0
    while (s < SHAPES.length - 1 && r >= (SHAPES[s] as Shape).weight) {
      r -= (SHAPES[s] as Shape).weight
      s++
    }
    out.push(codeOf(s, rng.int(0, COLORS - 1)))
  }
  return out
}

/** The k-th tray (0-based) of the shared sequence. */
export function trayAt(seq: readonly number[], k: number): (number | null)[] {
  const trays = Math.max(1, Math.floor(seq.length / TRAY))
  return Array.from({ length: TRAY }, (_, i) => seq[(k % trays) * TRAY + i] ?? null)
}

/** Does the piece fit with its top-left at (x, y): every block on an empty cell inside the grid? */
export function fits(
  grid: readonly number[],
  cells: readonly Cell[],
  x: number,
  y: number,
): boolean {
  return cells.every(([cx, cy]) => {
    const gx = x + cx
    const gy = y + cy
    return gx >= 0 && gy >= 0 && gx < N && gy < N && grid[gy * N + gx] === 0
  })
}

/** Grid indices covered by a piece at (x, y). */
export function covered(cells: readonly Cell[], x: number, y: number): number[] {
  return cells.map(([cx, cy]) => (y + cy) * N + x + cx)
}

/** Can this shape go anywhere on the grid? */
export function anyFit(grid: readonly number[], shape: Shape): boolean {
  for (let y = 0; y <= N - shape.h; y++) {
    for (let x = 0; x <= N - shape.w; x++) if (fits(grid, shape.cells, x, y)) return true
  }
  return false
}

/** Can any piece still in the tray be placed? */
export function canPlaceAny(grid: readonly number[], tray: readonly (number | null)[]): boolean {
  return tray.some((code) => code !== null && anyFit(grid, SHAPES[shapeOf(code)] as Shape))
}

/**
 * Clear every full row and column at once. Returns the grid without them, the
 * cleared indices, and how many lines went (a row and a column count as two).
 */
export function clearLines(grid: readonly number[]): {
  grid: number[]
  cleared: number[]
  lines: number
} {
  const kill = new Set<number>()
  let lines = 0
  for (let r = 0; r < N; r++) {
    const row = Array.from({ length: N }, (_, c) => r * N + c)
    if (row.every((i) => grid[i] !== 0)) {
      lines++
      for (const i of row) kill.add(i)
    }
  }
  for (let c = 0; c < N; c++) {
    const col = Array.from({ length: N }, (_, r) => r * N + c)
    if (col.every((i) => grid[i] !== 0)) {
      lines++
      for (const i of col) kill.add(i)
    }
  }
  const out = grid.slice()
  for (const i of kill) out[i] = 0
  return { grid: out, cleared: [...kill].sort((a, b) => a - b), lines }
}

/** Bonus for clearing `lines` at once: it grows with the square, so double clears pay well. */
export const clearPoints = (lines: number): number => lines * lines * 10

export interface Board {
  grid: number[]
  tray: (number | null)[]
  /** Index of the tray on the table (0 for the first). */
  k: number
}

export interface Step {
  board: Board
  placed: number[]
  /** Cleared cells with the value they held (for the fade-out). */
  cleared: { cell: number; value: number }[]
  lines: number
  /** Blocks placed plus the clear bonus. */
  points: number
  /** No piece left in the tray fits anywhere: this player is out. */
  dead: boolean
}

/**
 * Drop tray piece `slot` with its top-left at (x, y). Clears lines, deals a new
 * tray when the old one is used up, and reports whether the player is now out.
 * Null when the piece does not fit there.
 */
export function step(
  b: Board,
  seq: readonly number[],
  slot: number,
  x: number,
  y: number,
): Step | null {
  const code = b.tray[slot]
  if (code === null || code === undefined) return null
  const shape = SHAPES[shapeOf(code)] as Shape
  if (!fits(b.grid, shape.cells, x, y)) return null
  const placedGrid = b.grid.slice()
  const placed = covered(shape.cells, x, y)
  for (const i of placed) placedGrid[i] = colorOf(code) + 1
  const cl = clearLines(placedGrid)
  const cleared = cl.cleared.map((cell) => ({ cell, value: placedGrid[cell] as number }))
  let tray = b.tray.slice()
  tray[slot] = null
  let k = b.k
  if (tray.every((t) => t === null)) {
    k++
    tray = trayAt(seq, k)
  }
  return {
    board: { grid: cl.grid, tray, k },
    placed,
    cleared,
    lines: cl.lines,
    points: placed.length + clearPoints(cl.lines),
    dead: !canPlaceAny(cl.grid, tray),
  }
}

/**
 * Where a piece lands when dragged so its centre sits at (gx, gy), in block
 * units from the grid's corner: the nearest fit within one block either way,
 * so a near miss still lands. `ok` is false when nothing fits there.
 */
export function snap(
  grid: readonly number[],
  shape: Shape,
  gx: number,
  gy: number,
): { x: number; y: number; ok: boolean } {
  const tx = gx - shape.w / 2
  const ty = gy - shape.h / 2
  const x0 = Math.round(tx)
  const y0 = Math.round(ty)
  let best: { x: number; y: number } | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx
      const y = y0 + dy
      if (!fits(grid, shape.cells, x, y)) continue
      const d = (x - tx) ** 2 + (y - ty) ** 2
      if (d < bestD) {
        bestD = d
        best = { x, y }
      }
    }
  }
  if (best) return { ...best, ok: true }
  return { x: x0, y: y0, ok: false }
}
