import { other, type Side } from '../../core/game.ts'

/** Pure rules: no rendering, no timing, no randomness. Everything here is unit-tested. */

export const N = 8
export type Cell = Side | null
/** Index is `row * N + col`. Row 0 is the top row. */
export type Board = Cell[]

const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
]

/** Standard start. Red (side 0) moves first, as black does in the standard game. */
export function startBoard(): Board {
  const b: Board = Array<Cell>(N * N).fill(null)
  b[3 * N + 3] = 1
  b[3 * N + 4] = 0
  b[4 * N + 3] = 0
  b[4 * N + 4] = 1
  return b
}

/** Rival discs that `side` flips by playing on empty square `i`. Empty when the move is not legal. */
export function flipsAt(b: readonly Cell[], i: number, side: Side): number[] {
  if (b[i] !== null || b[i] === undefined) return []
  const r0 = Math.floor(i / N)
  const c0 = i % N
  const rival = other(side)
  const out: number[] = []
  for (const [dr, dc] of DIRS) {
    const run: number[] = []
    let r = r0 + dr
    let c = c0 + dc
    while (r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === rival) {
      run.push(r * N + c)
      r += dr
      c += dc
    }
    if (run.length && r >= 0 && r < N && c >= 0 && c < N && b[r * N + c] === side) out.push(...run)
  }
  return out
}

export interface Move {
  at: number
  flips: number[]
}

/** Every legal move for `side`, in square order. */
export function legalMoves(b: readonly Cell[], side: Side): Move[] {
  const out: Move[] = []
  for (let i = 0; i < N * N; i++) {
    const flips = flipsAt(b, i, side)
    if (flips.length) out.push({ at: i, flips })
  }
  return out
}

export function hasMove(b: readonly Cell[], side: Side): boolean {
  for (let i = 0; i < N * N; i++) if (flipsAt(b, i, side).length) return true
  return false
}

/** Board after `side` plays `move`: the disc lands and every flip changes colour. */
export function apply(b: readonly Cell[], move: Move, side: Side): Board {
  const next = b.slice()
  next[move.at] = side
  for (const i of move.flips) next[i] = side
  return next
}

/** Play square `i` for `side`. Throws if it is not a legal move. */
export function play(b: readonly Cell[], i: number, side: Side): { cells: Board; flips: number[] } {
  const flips = flipsAt(b, i, side)
  if (flips.length === 0) throw new Error(`Square ${i} is not a legal move for ${side}`)
  return { cells: apply(b, { at: i, flips }, side), flips }
}

export function counts(b: readonly Cell[]): [number, number] {
  let red = 0
  let blue = 0
  for (const c of b) {
    if (c === 0) red++
    else if (c === 1) blue++
  }
  return [red, blue]
}

export type Ending = { winner: Side | 'draw'; counts: [number, number] } | null

/** Game over only when neither side can move. Most discs wins. */
export function ending(b: readonly Cell[]): Ending {
  if (hasMove(b, 0) || hasMove(b, 1)) return null
  const c = counts(b)
  const winner: Side | 'draw' = c[0] > c[1] ? 0 : c[1] > c[0] ? 1 : 'draw'
  return { winner, counts: c }
}

/**
 * Who moves after `mover` has just played. The other side passes when it has
 * no move; `mover` then goes again. Null when nobody can move.
 */
export function nextTurn(b: readonly Cell[], mover: Side): { turn: Side; passed: boolean } | null {
  if (hasMove(b, other(mover))) return { turn: other(mover), passed: false }
  if (hasMove(b, mover)) return { turn: mover, passed: true }
  return null
}
