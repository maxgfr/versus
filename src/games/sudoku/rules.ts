import type { Difficulty, Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'

/** Pure Sudoku: generation from a seed (unique solution), checks, hints. 0 = empty. */

export const GIVENS: Record<Difficulty, number> = { easy: 38, normal: 32, hard: 27 }

/** Seed of round `r` of a match: round 0 is the game seed, later rounds get their own puzzle. */
export const roundSeed = (seed: number, r: number): number => seed + r * 7919

/** The side that has won `goal` rounds, if any (wins red first). */
export function matchWinner(wins: readonly number[], goal: number): Side | null {
  if ((wins[0] ?? 0) >= goal) return 0
  if ((wins[1] ?? 0) >= goal) return 1
  return null
}

const ROW = (i: number) => Math.floor(i / 9)
const COL = (i: number) => i % 9
const BOX = (i: number) => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3)

/** Peers of each cell (same row, column or box), precomputed. */
export const PEERS: readonly (readonly number[])[] = Array.from({ length: 81 }, (_, i) => {
  const out: number[] = []
  for (let j = 0; j < 81; j++)
    if (j !== i && (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i))) out.push(j)
  return out
})

/** Bitmask of digits (bit d) a cell may still take. */
export function candidates(grid: readonly number[], i: number): number {
  let used = 0
  for (const p of PEERS[i] as number[]) used |= 1 << (grid[p] as number)
  return ~used & 0b1111111110
}

const bits = (m: number) => {
  let n = 0
  while (m) {
    m &= m - 1
    n++
  }
  return n
}

/**
 * Count solutions up to `limit` (2 is enough to prove uniqueness). Picks the
 * most constrained empty cell first, which keeps it fast.
 */
export function countSolutions(grid: number[], limit = 2): number {
  let best = -1
  let bestMask = 0
  let bestN = 10
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue
    const m = candidates(grid, i)
    const n = bits(m)
    if (n === 0) return 0
    if (n < bestN) {
      best = i
      bestMask = m
      bestN = n
      if (n === 1) break
    }
  }
  if (best < 0) return 1
  let total = 0
  for (let d = 1; d <= 9 && total < limit; d++) {
    if (!(bestMask & (1 << d))) continue
    grid[best] = d
    total += countSolutions(grid, limit - total)
  }
  grid[best] = 0
  return total
}

function fill(grid: number[], rng: Rng): boolean {
  let best = -1
  let bestMask = 0
  let bestN = 10
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue
    const m = candidates(grid, i)
    const n = bits(m)
    if (n === 0) return false
    if (n < bestN) {
      best = i
      bestMask = m
      bestN = n
    }
  }
  if (best < 0) return true
  const digits = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).filter((d) => bestMask & (1 << d))
  for (const d of digits) {
    grid[best] = d
    if (fill(grid, rng)) return true
  }
  grid[best] = 0
  return false
}

export interface Puzzle {
  puzzle: number[]
  solution: number[]
}

/** Same seed → same puzzle on both halves and both phones. */
export function generate(seed: number, givens: number): Puzzle {
  const rng = new Rng(seed)
  const solution = Array<number>(81).fill(0)
  fill(solution, rng)
  const puzzle = solution.slice()
  const order = rng.shuffle(Array.from({ length: 81 }, (_, i) => i))
  let left = 81
  for (const i of order) {
    if (left <= givens) break
    const keep = puzzle[i] as number
    puzzle[i] = 0
    if (countSolutions(puzzle.slice()) !== 1) puzzle[i] = keep
    else left--
  }
  return { puzzle, solution }
}

export function isSolved(grid: readonly number[], solution: readonly number[]): boolean {
  for (let i = 0; i < 81; i++) if (grid[i] !== solution[i]) return false
  return true
}

/** Share of the blanks filled in (0..1). */
export function progress(grid: readonly number[], puzzle: readonly number[]): number {
  let blanks = 0
  let filled = 0
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== 0) continue
    blanks++
    if (grid[i] !== 0) filled++
  }
  return blanks ? filled / blanks : 1
}

/** How many of each digit are on the board (index 1..9). */
export function digitCounts(grid: readonly number[]): number[] {
  const c = Array<number>(10).fill(0)
  for (const v of grid) c[v] = (c[v] ?? 0) + 1
  return c
}

/** Cells completing a row, column or box that just became full because of cell `i`. */
export function completedUnits(grid: readonly number[], i: number): number[][] {
  const units: number[][] = []
  const all = Array.from({ length: 81 }, (_, j) => j)
  for (const pick of [ROW, COL, BOX]) {
    const u = all.filter((j) => pick(j) === pick(i))
    if (u.every((j) => grid[j] !== 0)) units.push(u)
  }
  return units
}

export const sameUnit = (a: number, b: number) =>
  ROW(a) === ROW(b) || COL(a) === COL(b) || BOX(a) === BOX(b)

/** The 27 units: rows, then columns, then boxes. */
export const UNITS: readonly (readonly number[])[] = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) =>
    Array.from(
      { length: 9 },
      (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3),
    ),
  ),
]

/**
 * What typing `d` into the selected cell does: nothing (no cell selected, a
 * filled cell, or a digit already placed nine times), a mistake, or a fill.
 * A finished digit can never be right, so its key is inert rather than a
 * free penalty.
 */
export function entry(
  cells: readonly number[],
  solution: readonly number[],
  sel: number,
  d: number,
): 'none' | 'wrong' | 'right' {
  if (sel < 0 || sel > 80 || cells[sel] !== 0 || d < 1 || d > 9) return 'none'
  let n = 0
  for (const v of cells) if (v === d) n++
  if (n >= 9) return 'none'
  return solution[sel] === d ? 'right' : 'wrong'
}

export interface Clock {
  /** Solved this round. */
  done: boolean
  /** Seconds on the clock, penalties included (frozen once done). */
  clock: number
}

/**
 * The race goes to the lowest time, penalties included: finishing first is
 * not enough when your mistakes cost more than the gap. A solver wins as soon
 * as the rival's running clock reaches its time; two solvers compare times
 * (equal is a draw). Null while it can still go either way.
 */
export function raceWinner(a: Clock, b: Clock): Side | 'draw' | null {
  if (a.done && b.done) return a.clock < b.clock ? 0 : b.clock < a.clock ? 1 : 'draw'
  if (a.done && b.clock >= a.clock) return 0
  if (b.done && a.clock >= b.clock) return 1
  return null
}

/** Cells with a single candidate, each with its digit (reading order). */
export function nakedSingles(grid: readonly number[]): { cell: number; digit: number }[] {
  const out: { cell: number; digit: number }[] = []
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue
    const m = candidates(grid, i)
    if (m && !(m & (m - 1))) out.push({ cell: i, digit: Math.log2(m) })
  }
  return out
}

/** Digits that fit in only one cell of some unit (a cell may appear more than once). */
export function hiddenSingles(grid: readonly number[]): { cell: number; digit: number }[] {
  const out: { cell: number; digit: number }[] = []
  for (const unit of UNITS) {
    let present = 0
    for (const j of unit) present |= 1 << (grid[j] as number)
    for (let d = 1; d <= 9; d++) {
      if (present & (1 << d)) continue
      let at = -1
      let n = 0
      for (const j of unit) {
        if (grid[j] !== 0 || !(candidates(grid, j) & (1 << d))) continue
        at = j
        if (++n > 1) break
      }
      if (n === 1) out.push({ cell: at, digit: d })
    }
  }
  return out
}

/** The digits a cell may still take, as a list. */
export function candidateList(grid: readonly number[], i: number): number[] {
  const m = candidates(grid, i)
  const out: number[] = []
  for (let d = 1; d <= 9; d++) if (m & (1 << d)) out.push(d)
  return out
}
