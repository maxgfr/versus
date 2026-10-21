import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Number Match. The board is a list of digits in rows of nine
 * (0 = crossed out). Two numbers pair when they are equal or sum to ten and
 * either touch (including diagonally) or have only crossed-out numbers between
 * them in reading order. A row that is entirely crossed out collapses. Add
 * (three per game) copies every number still on the board after the last one.
 */

export const COLS = 9
export const START_ROWS = 4
export const ADDS = 3
/** Numbers on the opening board. */
export const START = START_ROWS * COLS
/** The most cells a board may hold: an Add stops copying once the board is this long. */
export const CAPACITY = 10 * COLS

/** The opening digits: the same for both halves, from the seed. */
export function startNumbers(seed: number): number[] {
  const rng = new Rng(seed)
  return Array.from({ length: START }, () => rng.int(1, 9))
}

/**
 * Add: the numbers still on the board are copied, in reading order, after the
 * last number on the board (up to CAPACITY cells). Crossed-out cells after the
 * last number are reused. Returns the new board and where the copy starts.
 */
export function addRest(vals: readonly number[]): { vals: number[]; from: number } {
  let end = vals.length
  while (end > 0 && !vals[end - 1]) end--
  const rest = vals.filter((v) => v > 0)
  const next = vals.slice(0, end).concat(rest).slice(0, CAPACITY)
  return { vals: next, from: end }
}

const row = (i: number) => Math.floor(i / COLS)
const col = (i: number) => i % COLS

/** Are cells a and b neighbours on the grid (horizontally, vertically or diagonally)? */
export function touching(a: number, b: number): boolean {
  return a !== b && Math.abs(row(a) - row(b)) <= 1 && Math.abs(col(a) - col(b)) <= 1
}

/** Can the numbers at i and j be crossed out together? */
export function canPair(vals: readonly number[], i: number, j: number): boolean {
  if (i === j) return false
  const a = vals[i] ?? 0
  const b = vals[j] ?? 0
  if (!a || !b) return false
  if (a !== b && a + b !== 10) return false
  const lo = Math.min(i, j)
  const hi = Math.max(i, j)
  if (touching(lo, hi)) return true
  for (let k = lo + 1; k < hi; k++) if (vals[k]) return false
  return true
}

/** Every pair (i < j) that can be crossed out now. */
export function pairs(vals: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i]) continue
    for (let j = i + 1; j < vals.length; j++) if (canPair(vals, i, j)) out.push([i, j])
  }
  return out
}

/** Is there any pair to cross out? (Stops at the first one.) */
export function anyPair(vals: readonly number[]): boolean {
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i]) continue
    for (let j = i + 1; j < vals.length; j++) {
      if (canPair(vals, i, j)) return true
      // Past the next number in reading order and out of touch: nothing further can pair.
      if (vals[j] && j > i + COLS + 1) break
    }
  }
  return false
}

/**
 * Empty rows are removed and the rest move up (a last, partial row that is
 * empty goes too). `removed` lists the original indices of the rows removed.
 */
export function collapse(vals: readonly number[]): {
  vals: number[]
  rows: number
  removed: number[]
} {
  const out = vals.slice()
  const removed: number[] = []
  for (let r = Math.ceil(out.length / COLS) - 1; r >= 0; r--) {
    const start = r * COLS
    if (out.slice(start, start + COLS).every((v) => v === 0)) {
      out.splice(start, COLS)
      removed.unshift(r)
    }
  }
  return { vals: out, rows: removed.length, removed }
}

/** The board after crossing out the pair (i, j), with empty rows collapsed. */
export function cross(
  vals: readonly number[],
  i: number,
  j: number,
): { vals: number[]; rows: number; removed: number[] } {
  const next = vals.slice()
  next[i] = 0
  next[j] = 0
  return collapse(next)
}

/** Numbers still on the board. */
export function left(vals: readonly number[]): number {
  let n = 0
  for (const v of vals) if (v) n++
  return n
}
