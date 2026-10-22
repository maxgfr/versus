import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'

/**
 * Pure 15-puzzle on a 4 × 4 board. Cell i = row·4 + col; a cell holds tile
 * 1..15, or 0 for the gap. Solved = tiles 1..15 in reading order, gap last.
 */

export const SIZE = 4
export const CELLS = SIZE * SIZE
export const SCRAMBLE_MOVES = 60
/**
 * A random walk can wander back near home: a 60-step walk lands anywhere from
 * 12 to 42 tile steps from solved. Walks closer than this are redrawn, so every
 * race (and every round of a match) is a real puzzle of similar size.
 */
export const MIN_DISTANCE = 22

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
export function scramble(rng: Rng, moves = SCRAMBLE_MOVES, min = MIN_DISTANCE): Scramble {
  let best = walk(rng, moves)
  // A few redraws at most; keep the farthest walk if none reaches the bar.
  for (let k = 0; k < 40 && distance(best.tiles) < Math.min(min, moves); k++) {
    const next = walk(rng, moves)
    if (distance(next.tiles) > distance(best.tiles)) best = next
  }
  return best
}

function walk(rng: Rng, moves: number): Scramble {
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

/** Scramble size per level: steps of the walk and the least tile distance it must reach. */
const SIZES: Record<Difficulty, { moves: number; min: number }> = {
  easy: { moves: 40, min: 14 },
  normal: { moves: 60, min: 24 },
  hard: { moves: 90, min: 32 },
}

/**
 * The scramble for race `round` of a match on level `d`: each race walks a
 * little further from solved than the last (up to a cap), so a long match
 * ramps up instead of staying flat.
 */
export function scrambleSize(d: Difficulty, round: number): { moves: number; min: number } {
  const base = SIZES[d]
  const r = Math.min(round, 4)
  return { moves: base.moves + 10 * r, min: Math.min(40, base.min + 2 * r) }
}

/**
 * The taps that undo a scramble, last move first. Each one slides a tile that
 * sits next to the gap, so replaying them from the scrambled board solves it.
 */
export function solvePlan(path: readonly number[]): number[] {
  return path.slice(0, -1).reverse()
}

/**
 * The same plan with straight runs folded into one tap: when the gap would walk
 * two or more steps the same way along a row or column, tapping the far cell
 * slides the whole run at once (as a quick player does). `gap` is where the
 * gap is before the first tap.
 */
export function foldPlan(gap: number, plan: readonly number[]): number[] {
  const out: number[] = []
  let g = gap
  let i = 0
  while (i < plan.length) {
    let to = plan[i] as number
    const step = to - g
    let j = i + 1
    while (j < plan.length) {
      const next = plan[j] as number
      const inLine = Math.abs(step) === 1 ? rowOf(next) === rowOf(g) : true
      if (next - to !== step || !inLine) break
      to = next
      j++
    }
    out.push(to)
    g = to
    i = j
  }
  return out
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

/** Manhattan distance plus linear conflicts: an estimate of the moves left. */
export function estimate(tiles: ArrayLike<number>): number {
  let h = 0
  for (let i = 0; i < CELLS; i++) {
    const v = tiles[i] as number
    if (!v) continue
    const home = v - 1
    h += Math.abs(rowOf(i) - rowOf(home)) + Math.abs(colOf(i) - colOf(home))
  }
  // Two tiles in their home row (or column) but in the wrong order: one must step aside.
  for (let line = 0; line < SIZE; line++) {
    for (let a = 0; a < SIZE; a++) {
      const ia = line * SIZE + a
      const va = tiles[ia] as number
      const ja = a * SIZE + line
      const wa = tiles[ja] as number
      for (let b = a + 1; b < SIZE; b++) {
        const vb = tiles[line * SIZE + b] as number
        if (va && vb && rowOf(va - 1) === line && rowOf(vb - 1) === line && va > vb) h += 2
        const wb = tiles[b * SIZE + line] as number
        if (wa && wb && colOf(wa - 1) === line && colOf(wb - 1) === line && wa > wb) h += 2
      }
    }
  }
  return h
}

/**
 * Solve a board from what is on it (weighted A*: `weight` 1 is shortest, higher
 * finds a longer route much faster). Returns the cells to tap, one step of the
 * gap each, or null if `maxNodes` boards were looked at without a solution.
 */
export function solveTaps(
  tiles: readonly number[],
  weight: number,
  maxNodes = 200_000,
): number[] | null {
  const key = (t: ArrayLike<number>): string => String.fromCharCode(...Array.from(t))
  const start = key(tiles)
  const goal = key(solvedBoard())
  if (start === goal) return []
  // Each seen board: moves so far, the board it came from, and the cell tapped.
  const seen = new Map<string, { g: number; from: string; tap: number }>()
  seen.set(start, { g: 0, from: '', tap: -1 })
  // Binary heap of [f, h, board].
  const heap: [number, number, string][] = []
  const push = (n: [number, number, string]): void => {
    heap.push(n)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      const a = heap[p] as [number, number, string]
      if (a[0] < n[0] || (a[0] === n[0] && a[1] <= n[1])) break
      heap[i] = a
      i = p
    }
    heap[i] = n
  }
  const pop = (): [number, number, string] => {
    const top = heap[0] as [number, number, string]
    const last = heap.pop() as [number, number, string]
    if (heap.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        const at = (k: number) => (k === i ? last : (heap[k] as [number, number, string]))
        const less = (x: [number, number, string], y: [number, number, string]) =>
          x[0] < y[0] || (x[0] === y[0] && x[1] < y[1])
        if (l < heap.length && less(at(l), at(m))) m = l
        if (r < heap.length && less(at(r), at(m))) m = r
        if (m === i) break
        heap[i] = heap[m] as [number, number, string]
        i = m
      }
      heap[i] = last
    }
    return top
  }
  const h0 = estimate(tiles)
  push([weight * h0, h0, start])
  const board = Array<number>(CELLS).fill(0)
  let expanded = 0
  while (heap.length) {
    const [, , k] = pop()
    if (k === goal) {
      const taps: number[] = []
      let cur = k
      for (;;) {
        const n = seen.get(cur) as { g: number; from: string; tap: number }
        if (n.tap < 0) break
        taps.push(n.tap)
        cur = n.from
      }
      return taps.reverse()
    }
    if (++expanded > maxNodes) return null
    const node = seen.get(k) as { g: number; from: string; tap: number }
    for (let i = 0; i < CELLS; i++) board[i] = k.charCodeAt(i)
    const gap = board.indexOf(0)
    for (const n of neighbours(gap)) {
      board[gap] = board[n] as number
      board[n] = 0
      const nk = key(board)
      const g = node.g + 1
      const old = seen.get(nk)
      if (!old || g < old.g) {
        seen.set(nk, { g, from: k, tap: n })
        const h = estimate(board)
        push([g + weight * h, h, nk])
      }
      board[n] = board[gap] as number
      board[gap] = 0
    }
  }
  return null
}
