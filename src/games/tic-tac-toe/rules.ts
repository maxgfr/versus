import type { Side } from '../../core/game.ts'

/** Pure rules: no rendering, no timing, no randomness. Everything here is unit-tested. */

export type Cell = Side | null

export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export function emptyBoard(): Cell[] {
  return Array<Cell>(9).fill(null)
}

export function moves(cells: readonly Cell[]): number[] {
  const out: number[] = []
  cells.forEach((c, i) => {
    if (c === null) out.push(i)
  })
  return out
}

export function lineWinner(cells: readonly Cell[]): { side: Side; line: readonly number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line
    const v = cells[a]
    if (v !== null && v !== undefined && v === cells[b] && v === cells[c]) return { side: v, line }
  }
  return null
}

/** Open lines `side` could complete next move: two of theirs and an empty third. */
export function threats(cells: readonly Cell[], side: Side): number {
  let n = 0
  for (const line of LINES) {
    let mine = 0
    let empty = 0
    for (const i of line) {
      if (cells[i] === side) mine++
      else if (cells[i] === null) empty++
    }
    if (mine === 2 && empty === 1) n++
  }
  return n
}

export type Outcome = { winner: Side; line: readonly number[] } | { winner: 'draw' } | null

export function outcome(cells: readonly Cell[]): Outcome {
  const w = lineWinner(cells)
  if (w) return { winner: w.side, line: w.line }
  if (cells.every((c) => c !== null)) return { winner: 'draw' }
  return null
}

export function place(cells: readonly Cell[], i: number, side: Side): Cell[] {
  if (cells[i] !== null) throw new Error(`Cell ${i} is taken`)
  const next = cells.slice()
  next[i] = side
  return next
}

/** Rounds are played first to this many wins (the players can change it). */
export const TARGET = 3
