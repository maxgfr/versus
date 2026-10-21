import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { clearLines, fits, N, type Shape, SHAPES, shapeOf } from './rules.ts'

/** Seconds between the computer's drops. */
export const PACE: Record<Difficulty, number> = { easy: 2.2, normal: 1.4, hard: 0.8 }

/** Random score added to each option: easier computers pick less well. */
const NOISE: Record<Difficulty, number> = { easy: 60, normal: 14, hard: 0 }

export interface Move {
  slot: number
  x: number
  y: number
}

/** Blocks of a piece placed at (x, y) that touch a filled cell or the edge of the grid. */
function contacts(grid: readonly number[], shape: Shape, x: number, y: number): number {
  const own = new Set(shape.cells.map(([cx, cy]) => (y + cy) * N + x + cx))
  let n = 0
  for (const i of own) {
    const cx = i % N
    const cy = Math.floor(i / N)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) n++
      else if (!own.has(ny * N + nx) && grid[ny * N + nx] !== 0) n++
    }
  }
  return n
}

/**
 * The computer's drop: the placement that clears most, then keeps the board
 * compact (contact with what is already there), then with some noise on the
 * easier levels. Null when nothing fits.
 */
export function chooseMove(
  grid: readonly number[],
  tray: readonly (number | null)[],
  d: Difficulty,
  rng: Rng,
): Move | null {
  let best: Move | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (let slot = 0; slot < tray.length; slot++) {
    const code = tray[slot]
    if (code === null || code === undefined) continue
    const shape = SHAPES[shapeOf(code)] as Shape
    for (let y = 0; y <= N - shape.h; y++) {
      for (let x = 0; x <= N - shape.w; x++) {
        if (!fits(grid, shape.cells, x, y)) continue
        const filled = grid.slice()
        for (const [cx, cy] of shape.cells) filled[(y + cy) * N + x + cx] = 1
        const { lines } = clearLines(filled)
        const score =
          lines * 100 +
          contacts(grid, shape, x, y) * 3 +
          shape.cells.length * 0.5 +
          rng.range(0, NOISE[d])
        if (score > bestScore) {
          bestScore = score
          best = { slot, x, y }
        }
      }
    }
  }
  return best
}
