import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { type Cell, COLS, legalColumns, ROWS, WINDOWS } from './rules.ts'

/**
 * The computer's search. Pure and synchronous, so it runs both on the main
 * thread (easy / normal) and in a Web Worker via `think()` (hard). Negamax with
 * α-β pruning on one mutable board (drop, search, lift), centre-first move
 * ordering, a win test around the last disc only, and a window heuristic.
 */

const DEPTH: Record<Difficulty, number> = { easy: 2, normal: 6, hard: 10 }
/** Easy drops a random disc this often (but never misses a win or a block it can see). */
const SLIP: Record<Difficulty, number> = { easy: 0.3, normal: 0, hard: 0 }
const ORDER = [3, 2, 4, 1, 5, 0, 6] as const
const WIN = 1_000_000

export interface Position {
  cells: Cell[]
  turn: Side
}

/** Value from `side`'s point of view: open windows, plus a bonus for the centre column. */
function evaluate(b: readonly Cell[], side: Side): number {
  let total = 0
  for (const w of WINDOWS) {
    let own = 0
    let opp = 0
    for (const i of w) {
      const v = b[i]
      if (v === side) own++
      else if (v !== null) opp++
    }
    if (own > 0 && opp > 0) continue
    if (own === 3) total += 5
    else if (own === 2) total += 2
    else if (opp === 3) total -= 4
    else if (opp === 2) total -= 1
  }
  const mid = Math.floor(COLS / 2)
  for (let r = 0; r < ROWS; r++) {
    const v = b[r * COLS + mid]
    if (v === side) total += 3
    else if (v !== null) total -= 3
  }
  return total
}

/** Top free row of each column, kept in step with the board while searching. */
function heights(b: readonly Cell[]): number[] {
  const h: number[] = []
  for (let c = 0; c < COLS; c++) {
    let r = ROWS - 1
    while (r >= 0 && b[r * COLS + c] !== null) r--
    h.push(r)
  }
  return h
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

/** Does the disc at (col, row) make four for its side? */
function fourAt(b: readonly Cell[], col: number, row: number): boolean {
  const v = b[row * COLS + col]
  if (v === null || v === undefined) return false
  for (const [dc, dr] of DIRS) {
    let n = 1
    for (let k = 1; k < 4; k++) {
      const c = col + dc * k
      const r = row + dr * k
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS || b[r * COLS + c] !== v) break
      n++
    }
    for (let k = 1; k < 4; k++) {
      const c = col - dc * k
      const r = row - dr * k
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS || b[r * COLS + c] !== v) break
      n++
    }
    if (n >= 4) return true
  }
  return false
}

/** Would `side` win by dropping into `col` right now? */
function winsWith(b: Cell[], h: number[], col: number, side: Side): boolean {
  const row = h[col] as number
  if (row < 0) return false
  b[row * COLS + col] = side
  const w = fourAt(b, col, row)
  b[row * COLS + col] = null
  return w
}

function negamax(
  b: Cell[],
  h: number[],
  side: Side,
  depth: number,
  a: number,
  beta: number,
  ply: number,
  filled: number,
): number {
  if (filled === COLS * ROWS) return 0
  // A win on the spot ends the line; no need to look further.
  for (const col of ORDER) if (winsWith(b, h, col, side)) return WIN - ply
  if (depth === 0) return evaluate(b, side)
  let best = -Infinity
  for (const col of ORDER) {
    const row = h[col] as number
    if (row < 0) continue
    b[row * COLS + col] = side
    h[col] = row - 1
    const v = -negamax(b, h, other(side), depth - 1, -beta, -a, ply + 1, filled + 1)
    h[col] = row
    b[row * COLS + col] = null
    if (v > best) best = v
    if (best > a) a = best
    if (a >= beta) break
  }
  return best
}

/** Column scores for the side to move, one per legal column. */
export function scores(pos: Position, depth: number): Map<number, number> {
  const out = new Map<number, number>()
  const b = pos.cells.slice()
  const h = heights(b)
  const filled = b.filter((c) => c !== null).length
  for (const col of legalColumns(b)) {
    const row = h[col] as number
    b[row * COLS + col] = pos.turn
    h[col] = row - 1
    const v = fourAt(b, col, row)
      ? WIN
      : -negamax(b, h, other(pos.turn), depth - 1, -Infinity, Infinity, 1, filled + 1)
    h[col] = row
    b[row * COLS + col] = null
    out.set(col, v)
  }
  return out
}

/**
 * The column the computer drops into. Easy plays at random 30% of the time,
 * unless it can win or must block right now. Equal scores are broken by the
 * seeded rng on easy and normal. Hard takes the most central of them: a random
 * pick among equal scores is noticeably weaker, because the evaluation cannot
 * tell those moves apart.
 */
export function choose(pos: Position, difficulty: Difficulty, seed: number): number {
  const rng = new Rng(seed)
  const legal = legalColumns(pos.cells)
  if (rng.chance(SLIP[difficulty])) {
    const b = pos.cells.slice()
    const h = heights(b)
    const win = legal.find((c) => winsWith(b, h, c, pos.turn))
    if (win !== undefined) return win
    const block = legal.find((c) => winsWith(b, h, c, other(pos.turn)))
    return block ?? rng.pick(legal)
  }
  const table = scores(pos, DEPTH[difficulty])
  let best = -Infinity
  let ties: number[] = []
  for (const col of ORDER) {
    const v = table.get(col)
    if (v === undefined) continue
    if (v > best) {
      best = v
      ties = [col]
    } else if (v === best) ties.push(col)
  }
  if (!ties.length) return rng.pick(legal)
  if (difficulty !== 'hard') return rng.pick(ties)
  // Mostly the most central tie; now and then another, so two hard computers do not repeat one game forever.
  return rng.chance(0.8) ? (ties[0] as number) : rng.pick(ties)
}
