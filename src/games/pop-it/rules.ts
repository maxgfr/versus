/**
 * Pure rules: the board, the one-row-per-turn lock, and misère Nim. No DOM, no
 * timing, no randomness. Each row is a heap: its unpopped bubbles.
 */

export const ROWS = 6
export const COLS = 6
export const BUBBLES = ROWS * COLS

export const rowOf = (i: number): number => Math.floor(i / COLS)
export const colOf = (i: number): number => i % COLS

/** Unpopped bubbles per row. */
export function heapsOf(popped: readonly boolean[]): number[] {
  const heaps = Array<number>(ROWS).fill(0)
  popped.forEach((p, i) => {
    if (!p) heaps[rowOf(i)] = (heaps[rowOf(i)] ?? 0) + 1
  })
  return heaps
}

export function bubblesLeft(popped: readonly boolean[]): number {
  return popped.reduce((n, p) => (p ? n : n + 1), 0)
}

/** A bubble can be popped if it is still whole and, once a row is locked, it is in that row. */
export function canPop(popped: readonly boolean[], i: number, lock: number): boolean {
  if (i < 0 || i >= BUBBLES || popped[i]) return false
  return lock < 0 || rowOf(i) === lock
}

export function popBubble(popped: readonly boolean[], i: number): boolean[] {
  if (i < 0 || i >= BUBBLES || popped[i]) throw new Error(`Bubble ${i} cannot be popped`)
  const next = popped.slice()
  next[i] = true
  return next
}

/** One turn: pop `count` bubbles from `row`. */
export interface Move {
  row: number
  count: number
}

export function legalMoves(heaps: readonly number[]): Move[] {
  const out: Move[] = []
  heaps.forEach((h, row) => {
    for (let count = 1; count <= h; count++) out.push({ row, count })
  })
  return out
}

export function applyMove(heaps: readonly number[], m: Move): number[] {
  const next = heaps.slice()
  next[m.row] = (next[m.row] ?? 0) - m.count
  return next
}

const BASE = COLS + 1
const memo = new Int8Array(BASE ** ROWS)

/**
 * Misère Nim: whoever takes the last bubble loses. True when the player to move
 * wins from these heaps. Solved exactly and memoised (at most 7^6 positions).
 */
export function mistereWin(heaps: readonly number[]): boolean {
  return solve(heaps.slice(0, ROWS))
}

function solve(h: number[]): boolean {
  let key = 0
  let total = 0
  for (let i = 0; i < ROWS; i++) {
    const v = h[i] ?? 0
    key = key * BASE + v
    total += v
  }
  const known = memo[key]
  if (known) return known === 1
  // Nothing left: the previous player took the last bubble and lost.
  let win = total === 0
  if (!win) {
    search: for (let i = 0; i < ROWS; i++) {
      const hi = h[i] ?? 0
      for (let n = 0; n < hi; n++) {
        h[i] = n
        const opponentWins = solve(h)
        h[i] = hi
        if (!opponentWins) {
          win = true
          break search
        }
      }
    }
  }
  memo[key] = win ? 1 : 2
  return win
}

/** Every move that leaves the opponent in a lost position. Empty when the position is lost. */
export function winningMoves(heaps: readonly number[]): Move[] {
  return legalMoves(heaps).filter((m) => !mistereWin(applyMove(heaps, m)))
}
