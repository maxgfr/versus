import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Number Match. The board is a list of digits in rows of nine
 * (0 = crossed out). Two numbers pair when they are equal or sum to ten and
 * see each other: they touch (including diagonally), or only crossed-out cells
 * lie between them along a row, a column or a diagonal, or in reading order
 * (the end of a row runs on to the start of the next). A row that is entirely
 * crossed out collapses. Add (three per game) copies every number still on the
 * board after the last one.
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

/** Only crossed-out cells strictly between lo and hi, stepping by `by`. */
function clearBetween(vals: readonly number[], lo: number, hi: number, by: number): boolean {
  for (let k = lo + by; k < hi; k += by) if (vals[k]) return false
  return true
}

/**
 * Do cells lo < hi see each other: touching, or only crossed-out cells between
 * them in reading order, down a column, or along a diagonal (never wrapping)?
 */
export function inSight(vals: readonly number[], lo: number, hi: number): boolean {
  if (touching(lo, hi)) return true
  if (clearBetween(vals, lo, hi, 1)) return true
  const dr = row(hi) - row(lo)
  const dc = col(hi) - col(lo)
  if (dc === 0) return clearBetween(vals, lo, hi, COLS)
  if (dr === dc) return clearBetween(vals, lo, hi, COLS + 1)
  if (dr === -dc) return clearBetween(vals, lo, hi, COLS - 1)
  return false
}

/** Equal digits, or two that make ten. */
export function matches(a: number, b: number): boolean {
  return a > 0 && b > 0 && (a === b || a + b === 10)
}

/** Can the numbers at i and j be crossed out together? */
export function canPair(vals: readonly number[], i: number, j: number): boolean {
  if (i === j) return false
  if (!matches(vals[i] ?? 0, vals[j] ?? 0)) return false
  return inSight(vals, Math.min(i, j), Math.max(i, j))
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
  // Columns and diagonals reach any distance, so every later cell is a candidate.
  for (let i = 0; i < vals.length; i++) {
    const a = vals[i] ?? 0
    if (!a) continue
    for (let j = i + 1; j < vals.length; j++)
      if (matches(a, vals[j] ?? 0) && inSight(vals, i, j)) return true
  }
  return false
}

/** Would an Add put at least one number on the board (Adds left, and room below the last number)? */
export function canAdd(vals: readonly number[], addsLeft: number): boolean {
  if (addsLeft <= 0 || left(vals) === 0) return false
  let end = vals.length
  while (end > 0 && !vals[end - 1]) end--
  return end < CAPACITY
}

/** Out of moves for good: numbers left, no pair to cross out and no Add that would help. */
export function isStuck(vals: readonly number[], addsLeft: number): boolean {
  return left(vals) > 0 && !anyPair(vals) && !canAdd(vals, addsLeft)
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
