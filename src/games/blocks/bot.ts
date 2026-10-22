import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Cell, clearPoints, N, type Shape, SHAPES, shapeOf } from './rules.ts'

/** Seconds between the computer's drops. */
export const PACE: Record<Difficulty, number> = { easy: 2.2, normal: 1.15, hard: 0.7 }

/**
 * How the computer picks a drop. Easy grabs the drop that clears most and
 * hugs what is there (with plenty of noise). Normal also judges the board it
 * leaves behind: holes, ragged edges, room for the big pieces. Hard looks one
 * drop further: every pair of pieces still in the tray, in both orders, and
 * never strands a piece it still has to place. It only knows what a player
 * sees: the grid and the tray, never the next tray.
 */
interface Skill {
  /** Random score added to each option. */
  noise: number
  /** Weight of the board-shape judgement (0: ignore it). */
  judge: number
  /** Drops searched ahead (1 or 2). */
  depth: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { noise: 60, judge: 0, depth: 1 },
  normal: { noise: 6, judge: 1, depth: 1 },
  hard: { noise: 0, judge: 1, depth: 2 },
}

export interface Move {
  slot: number
  x: number
  y: number
}

type Grid = Uint8Array

/** First drops searched a level deeper by the hard computer. */
const WIDTH = 14

function toGrid(grid: readonly number[]): Grid {
  const g = new Uint8Array(N * N)
  for (let i = 0; i < N * N; i++) g[i] = grid[i] ? 1 : 0
  return g
}

function fitsAt(g: Grid, cells: readonly Cell[], x: number, y: number): boolean {
  for (const [cx, cy] of cells) {
    const gx = x + cx
    const gy = y + cy
    if (gx < 0 || gy < 0 || gx >= N || gy >= N || g[gy * N + gx]) return false
  }
  return true
}

function anyFitAt(g: Grid, s: Shape): boolean {
  for (let y = 0; y <= N - s.h; y++)
    for (let x = 0; x <= N - s.w; x++) if (fitsAt(g, s.cells, x, y)) return true
  return false
}

/** Place and clear: the new grid and the points the drop scores. */
function place(
  g: Grid,
  s: Shape,
  x: number,
  y: number,
): { g: Grid; points: number; lines: number } {
  const out = g.slice()
  for (const [cx, cy] of s.cells) out[(y + cy) * N + x + cx] = 1
  const rows: number[] = []
  const cols: number[] = []
  for (let r = 0; r < N; r++) {
    let full = true
    for (let c = 0; c < N && full; c++) if (!out[r * N + c]) full = false
    if (full) rows.push(r)
  }
  for (let c = 0; c < N; c++) {
    let full = true
    for (let r = 0; r < N && full; r++) if (!out[r * N + c]) full = false
    if (full) cols.push(c)
  }
  for (const r of rows) for (let c = 0; c < N; c++) out[r * N + c] = 0
  for (const c of cols) for (let r = 0; r < N; r++) out[r * N + c] = 0
  const lines = rows.length + cols.length
  return { g: out, points: s.cells.length + clearPoints(lines), lines }
}

/** Blocks of a piece at (x, y) touching a filled cell or the edge. */
function contacts(g: Grid, s: Shape, x: number, y: number): number {
  let n = 0
  for (const [cx, cy] of s.cells) {
    const gx = x + cx
    const gy = y + cy
    for (const [dx, dy] of DIRS) {
      const nx = gx + dx
      const ny = gy + dy
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) n++
      else if (g[ny * N + nx] && !s.cells.some(([ax, ay]) => x + ax === nx && y + ay === ny)) n++
    }
  }
  return n
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

/** The pieces that hurt most to have no room for: the 3×3, the long bars, the big Ls. */
const SQUARE3 = SHAPES.find((s) => s.w === 3 && s.h === 3 && s.cells.length === 9) as Shape
const BIG = SHAPES.filter(
  (s) => s !== SQUARE3 && (s.w === 4 || s.h === 4 || (s.w === 3 && s.h === 3)),
)

/** How good a board is to play on: room, no holes, smooth edges. Higher is better. */
export function judge(g: Grid): number {
  let v = 0
  let holes = 0
  let rough = 0
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const f = g[y * N + x]
      if (!f) {
        v += 0.5
        let closed = 0
        for (const [dx, dy] of DIRS) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= N || ny >= N || g[ny * N + nx]) closed++
        }
        if (closed === 4) holes++
        else if (closed === 3) holes += 0.35
      }
      // Edges between filled and empty, along rows and columns.
      if (x + 1 < N && f !== g[y * N + x + 1]) rough++
      if (y + 1 < N && f !== g[(y + 1) * N + x]) rough++
    }
  }
  v -= holes * 9 + rough * 0.8
  if (anyFitAt(g, SQUARE3)) v += 12
  let big = 0
  for (const s of BIG) if (anyFitAt(g, s)) big++
  v += (big / BIG.length) * 14
  return v
}

interface Option {
  slot: number
  x: number
  y: number
  g: Grid
  points: number
  lines: number
  shape: Shape
}

function options(g: Grid, tray: readonly (number | null)[], skip = -1): Option[] {
  const out: Option[] = []
  for (let slot = 0; slot < tray.length; slot++) {
    const code = tray[slot]
    if (slot === skip || code === null || code === undefined) continue
    const shape = SHAPES[shapeOf(code)] as Shape
    for (let y = 0; y <= N - shape.h; y++) {
      for (let x = 0; x <= N - shape.w; x++) {
        if (!fitsAt(g, shape.cells, x, y)) continue
        const p = place(g, shape, x, y)
        out.push({ slot, x, y, g: p.g, points: p.points, lines: p.lines, shape })
      }
    }
  }
  return out
}

/** Pieces left in the tray after `used` slots, that no longer fit anywhere: each is a dead end. */
function stranded(g: Grid, tray: readonly (number | null)[], used: number[]): number {
  let n = 0
  for (let slot = 0; slot < tray.length; slot++) {
    const code = tray[slot]
    if (used.includes(slot) || code === null || code === undefined) continue
    if (!anyFitAt(g, SHAPES[shapeOf(code)] as Shape)) n++
  }
  return n
}

/**
 * The computer's drop. Null when nothing fits.
 */
export function chooseMove(
  grid: readonly number[],
  tray: readonly (number | null)[],
  d: Difficulty,
  rng: Rng,
): Move | null {
  const skill = SKILL[d]
  const g0 = toGrid(grid)
  let first = options(g0, tray)
  if (first.length === 0) return null
  const one = (o: Option) => o.points * 3 + judge(o.g) - stranded(o.g, tray, [o.slot]) * 400
  // Searching a drop further is costly: only the most promising first drops get it.
  if (skill.depth > 1 && first.length > WIDTH) {
    const scored = first.map((o) => ({ o, v: one(o) })).sort((a, b) => b.v - a.v)
    first = scored.slice(0, WIDTH).map((x) => x.o)
  }
  let best: Option | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const o of first) {
    let score: number
    if (skill.judge === 0) {
      score = o.lines * 100 + contacts(g0, o.shape, o.x, o.y) * 3 + o.shape.cells.length * 0.5
    } else if (skill.depth === 1) {
      score = one(o)
    } else {
      // The best follow-up with another piece of the tray (or none left to place).
      let follow = Number.NEGATIVE_INFINITY
      const next = options(o.g, tray, o.slot)
      for (const n of next) {
        const v = n.points * 3 + judge(n.g) - stranded(n.g, tray, [o.slot, n.slot]) * 400
        if (v > follow) follow = v
      }
      if (next.length === 0) {
        const left = stranded(o.g, tray, [o.slot])
        follow = judge(o.g) - left * 400
      }
      score = o.points * 3 + follow
    }
    score += rng.range(0, skill.noise)
    if (score > bestScore) {
      bestScore = score
      best = o
    }
  }
  return best ? { slot: best.slot, x: best.x, y: best.y } : null
}
