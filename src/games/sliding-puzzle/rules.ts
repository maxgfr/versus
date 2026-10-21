import { Rng } from '../../core/rng.ts'

/**
 * Pure 15-puzzle on a 4 × 4 board. Cell i = row·4 + col; a cell holds tile
 * 1..15, or 0 for the gap. Solved = tiles 1..15 in reading order, gap last.
 */

export const SIZE = 4
export const CELLS = SIZE * SIZE
export const SCRAMBLE_MOVES = 60

export const rowOf = (i: number): number => Math.floor(i / SIZE)
export const colOf = (i: number): number => i % SIZE

export function solvedBoard(): number[] {
  return Array.from({ length: CELLS }, (_, i) => (i + 1) % CELLS)
}

/** Cells sharing an edge with `i`. */
export function neighbours(i: number): number[] {
  const out: number[] = []
  if (rowOf(i) > 0) out.push(i - SIZE)
  if (rowOf(i) < SIZE - 1) out.push(i + SIZE)
  if (colOf(i) > 0) out.push(i - 1)
  if (colOf(i) < SIZE - 1) out.push(i + 1)
  return out
}

export interface Scramble {
  tiles: number[]
  /** Gap cell after each move, starting from the solved gap cell. */
  path: number[]
}

/**
 * A random walk of the gap from the solved board. A move never undoes the one
 * before it, and every move is legal, so the result is always solvable.
 * Same seed → same board on both halves.
 */
export function scramble(rng: Rng, moves = SCRAMBLE_MOVES): Scramble {
  const tiles = solvedBoard()
  let gap = CELLS - 1
  let came = -1
  const path = [gap]
  for (let k = 0; k < moves; k++) {
    const next = rng.pick(neighbours(gap).filter((n) => n !== came))
    tiles[gap] = tiles[next] as number
    tiles[next] = 0
    came = gap
    gap = next
    path.push(gap)
  }
  return { tiles, path }
}

/**
 * The taps that undo a scramble, last move first. Each one slides a tile that
 * sits next to the gap, so replaying them from the scrambled board solves it.
 */
export function solvePlan(path: readonly number[]): number[] {
  return path.slice(0, -1).reverse()
}

export interface Slid {
  tiles: number[]
  /** For each cell, the cell its tile came from (its own index if it did not move). */
  from: number[]
}

/**
 * Tap `cell`. If it is next to the gap, its tile slides into the gap. If it
 * shares the gap's row or column, every tile between them slides one step
 * toward the gap. Null when `cell` is the gap or not in line with it. The
 * input is never changed.
 */
export function slide(tiles: readonly number[], cell: number): Slid | null {
  const gap = tiles.indexOf(0)
  if (gap < 0 || cell === gap || cell < 0 || cell >= CELLS) return null
  const sameRow = rowOf(cell) === rowOf(gap)
  const sameCol = colOf(cell) === colOf(gap)
  if (!sameRow && !sameCol) return null
  const step = (sameRow ? 1 : SIZE) * Math.sign(cell - gap)
  const out = tiles.slice()
  const from = out.map((_, i) => i)
  let g = gap
  while (g !== cell) {
    const src = g + step
    out[g] = out[src] as number
    from[g] = src
    g = src
  }
  out[cell] = 0
  return { tiles: out, from }
}

export function isSolved(tiles: readonly number[]): boolean {
  return tiles.every((v, i) => v === (i + 1) % CELLS)
}

/** Sum of each tile's distance from its home cell. 0 only when solved. */
export function distance(tiles: readonly number[]): number {
  let d = 0
  tiles.forEach((v, i) => {
    if (v === 0) return
    const home = v - 1
    d += Math.abs(rowOf(i) - rowOf(home)) + Math.abs(colOf(i) - colOf(home))
  })
  return d
}

/** 0..1 share of the way from the scrambled board to solved. */
export function progress(tiles: readonly number[], start: number): number {
  if (start <= 0) return 1
  return Math.max(0, Math.min(1, 1 - distance(tiles) / start))
}
