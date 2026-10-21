import { other, type Side } from '../../core/game.ts'

/** Pure rules: no rendering, no timing, no randomness. Everything here is unit-tested. */

export const COLS = 7
export const ROWS = 6
/** Rounds are played first to this many wins. */
export const TARGET = 2

export type Cell = Side | null
/** Index is `row * COLS + col`. Row 0 is the top row, `ROWS - 1` the bottom one. */
export type Board = Cell[]

export function emptyBoard(): Board {
  return Array<Cell>(COLS * ROWS).fill(null)
}

/** Row a disc dropped into `col` would land on, or -1 when that column is full. */
export function dropRow(b: readonly Cell[], col: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (b[r * COLS + col] === null) return r
  return -1
}

export function legalColumns(b: readonly Cell[]): number[] {
  const out: number[] = []
  for (let c = 0; c < COLS; c++) if (dropRow(b, c) >= 0) out.push(c)
  return out
}

/** New board with `side`'s disc dropped into `col`. Throws on a full column. */
export function play(b: readonly Cell[], col: number, side: Side): Board {
  const row = dropRow(b, col)
  if (row < 0) throw new Error(`Column ${col} is full`)
  const next = b.slice()
  next[row * COLS + col] = side
  return next
}

/** Every run of four, as cell indexes in order from one end to the other. */
export const WINDOWS: readonly (readonly number[])[] = (() => {
  const out: number[][] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++) out.push([0, 1, 2, 3].map((k) => r * COLS + c + k))
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 4; r++) out.push([0, 1, 2, 3].map((k) => (r + k) * COLS + c))
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c <= COLS - 4; c++) out.push([0, 1, 2, 3].map((k) => (r + k) * COLS + c + k))
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 3; c < COLS; c++) out.push([0, 1, 2, 3].map((k) => (r + k) * COLS + c - k))
  return out
})()

export function winLine(b: readonly Cell[]): { side: Side; line: readonly number[] } | null {
  for (const w of WINDOWS) {
    const v = b[w[0] as number]
    if (v !== null && v !== undefined && w.every((i) => b[i] === v)) return { side: v, line: w }
  }
  return null
}

export type Outcome = { winner: Side; line: readonly number[] } | { winner: 'draw' } | null

export function outcome(b: readonly Cell[]): Outcome {
  const w = winLine(b)
  if (w) return { winner: w.side, line: w.line }
  if (legalColumns(b).length === 0) return { winner: 'draw' }
  return null
}

/** Starter of the next round: the starter alternates every round. */
export function nextStarter(starter: Side): Side {
  return other(starter)
}

/** Round wins after a round's outcome (a draw round adds nothing). */
export function addRound(wins: [number, number], o: Outcome): [number, number] {
  if (!o || o.winner === 'draw') return [wins[0], wins[1]]
  const next: [number, number] = [wins[0], wins[1]]
  next[o.winner]++
  return next
}

export function matchOver(wins: readonly number[]): Side | null {
  if ((wins[0] ?? 0) >= TARGET) return 0
  if ((wins[1] ?? 0) >= TARGET) return 1
  return null
}
