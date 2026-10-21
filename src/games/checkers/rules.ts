import type { Side } from '../../core/game.ts'

/**
 * English draughts on the dark squares of an 8 × 8 board. Pure rules: no DOM,
 * no canvas, no randomness. Red (side 0) starts at the bottom and moves up;
 * blue (side 1) starts at the top and moves down.
 *
 * The board is 64 cells, index = row * 8 + col, row 0 at the top. A dark square
 * has (row + col) odd, so red's back row (7) has dark squares in even columns.
 */

/** 0 empty, 1 red man, 2 red king, 3 blue man, 4 blue king. */
export type Cell = 0 | 1 | 2 | 3 | 4

/**
 * One whole move. A capture may jump several pieces: `path` lists every square
 * the piece stands on (start, each landing, end) and `captured` the squares of
 * the pieces taken, which stay on the board until the move is over.
 */
export interface Move {
  path: number[]
  captured: number[]
}

export interface Outcome {
  winner: Side | 'draw'
  note: string
}

/** Draughts is drawn out past this many plies: most material wins. */
export const MAX_PLIES = 200
const KING_VALUE = 1.6
const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
]

/** Seconds per jump: a moving piece hops square to square this fast. */
export const HOP = 0.22

export const EMPTY: Cell = 0

export const idx = (row: number, col: number): number => row * 8 + col
export const rowOf = (i: number): number => Math.floor(i / 8)
export const colOf = (i: number): number => i % 8
export const isDark = (row: number, col: number): boolean => (row + col) % 2 === 1

export function start(): Cell[] {
  const board: Cell[] = Array<Cell>(64).fill(EMPTY)
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (!isDark(r, c)) continue
      if (r >= 5) board[idx(r, c)] = 1
      else if (r <= 2) board[idx(r, c)] = 3
    }
  return board
}

export function owner(cell: Cell): Side | null {
  return cell === 0 ? null : cell <= 2 ? 0 : 1
}

export const isKing = (cell: Cell): boolean => cell === 2 || cell === 4

function enemy(cell: Cell, side: Side): boolean {
  return cell !== EMPTY && owner(cell) !== side
}

/** Directions a piece may go: a man only forward (up for red, down for blue), a king all four ways. */
function dirsFor(side: Side, king: boolean): readonly (readonly [number, number])[] {
  if (king) return DIRS
  const fwd = side === 0 ? -1 : 1
  return DIRS.filter(([dr]) => dr === fwd)
}

/**
 * Every complete capture sequence available to one piece (English draughts:
 * short jumps over an adjacent rival onto the empty square just beyond; men
 * jump forward only, kings both ways). A sequence ends when no jump is left;
 * a man that lands on the far row stops there (it cannot jump on as a man).
 */
function captureSequences(board: readonly Cell[], from: number, side: Side, king: boolean): Move[] {
  const found: Move[] = []
  // The piece leaves its square first, so a king can circle back through where it stood.
  const grid = board.slice()
  grid[from] = EMPTY
  const dirs = dirsFor(side, king)
  const walk = (pos: number, path: number[], caps: number[]): void => {
    const r = rowOf(pos)
    const c = colOf(pos)
    let extended = false
    for (const [dr, dc] of dirs) {
      const lr = r + 2 * dr
      const lc = c + 2 * dc
      if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue
      const mid = idx(r + dr, c + dc)
      const land = idx(lr, lc)
      // Jumped pieces stay on the board until the move ends: no piece is taken twice.
      if (!enemy(grid[mid] ?? EMPTY, side) || caps.includes(mid)) continue
      if (grid[land] !== EMPTY) continue
      extended = true
      walk(land, [...path, land], [...caps, mid])
    }
    if (!extended && caps.length > 0) found.push({ path, captured: caps })
  }
  walk(from, [from], [])
  return found
}

/** Simple (non-capturing) steps for one piece: one square diagonally, men forward only. */
function steps(board: readonly Cell[], from: number, side: Side, king: boolean): Move[] {
  const out: Move[] = []
  const r = rowOf(from)
  const c = colOf(from)
  for (const [dr, dc] of dirsFor(side, king)) {
    const nr = r + dr
    const nc = c + dc
    if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue
    if (board[idx(nr, nc)] === EMPTY) out.push({ path: [from, idx(nr, nc)], captured: [] })
  }
  return out
}

/**
 * Legal moves for `side`. If any capture exists, only captures are legal
 * (compulsory), and each must be played through to its end.
 */
export function legalMoves(board: readonly Cell[], side: Side): Move[] {
  const captures: Move[] = []
  const quiet: Move[] = []
  for (let i = 0; i < 64; i++) {
    const cell = board[i] ?? EMPTY
    if (cell === EMPTY || owner(cell) !== side) continue
    captures.push(...captureSequences(board, i, side, isKing(cell)))
  }
  if (captures.length) return captures
  for (let i = 0; i < 64; i++) {
    const cell = board[i] ?? EMPTY
    if (cell === EMPTY || owner(cell) !== side) continue
    quiet.push(...steps(board, i, side, isKing(cell)))
  }
  return quiet
}

/** Does this move take a piece? */
export const isCapture = (m: Move): boolean => m.captured.length > 0

/** The board after a move, and whether the moving man was crowned at its end. */
export function apply(board: readonly Cell[], m: Move): { board: Cell[]; crowned: boolean } {
  const next = board.slice()
  const from = m.path[0] ?? 0
  const to = m.path[m.path.length - 1] ?? 0
  const piece = next[from] ?? EMPTY
  next[from] = EMPTY
  for (const c of m.captured) next[c] = EMPTY
  const crowned = (piece === 1 && rowOf(to) === 0) || (piece === 3 && rowOf(to) === 7)
  next[to] = crowned ? (piece === 1 ? 2 : 4) : piece
  return { board: next, crowned }
}

/** Material in pawns, a king counting 1.6. */
export function material(board: readonly Cell[]): Record<Side, number> {
  const sum: Record<Side, number> = { 0: 0, 1: 0 }
  for (const cell of board) {
    const side = owner(cell)
    if (side !== null) sum[side] += isKing(cell) ? KING_VALUE : 1
  }
  return sum
}

export function count(board: readonly Cell[], side: Side): number {
  return board.filter((cell) => owner(cell) === side).length
}

/** The game is over for the side to move when it has no pieces or no legal move; past the cap, the material decides. */
export function outcome(board: readonly Cell[], toMove: Side, ply: number): Outcome | null {
  const other: Side = toMove === 0 ? 1 : 0
  if (count(board, toMove) === 0) return { winner: other, note: 'No pieces left' }
  if (legalMoves(board, toMove).length === 0) return { winner: other, note: 'No move left' }
  if (ply >= MAX_PLIES) {
    const m = material(board)
    if (m[0] === m[1]) return { winner: 'draw', note: 'Level at the move limit' }
    return {
      winner: m[0] > m[1] ? 0 : 1,
      note: 'Most material at the move limit',
    }
  }
  return null
}

/** For each step of a move's path, the squares of the pieces that step jumps (none for a plain step). */
export function hops(m: Move): number[][] {
  return m.path.slice(0, -1).map((from, i) => {
    const to = m.path[i + 1] ?? from
    const dr = Math.sign(rowOf(to) - rowOf(from))
    const dc = Math.sign(colOf(to) - colOf(from))
    const jumped: number[] = []
    let r = rowOf(from) + dr
    let c = colOf(from) + dc
    while (r !== rowOf(to)) {
      const sq = idx(r, c)
      if (m.captured.includes(sq)) jumped.push(sq)
      r += dr
      c += dc
    }
    return jumped
  })
}
