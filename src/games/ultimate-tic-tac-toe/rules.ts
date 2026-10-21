import { other, type Side } from '../../core/game.ts'
import { type Cell, LINES, lineWinner, outcome as smallOutcome } from '../tic-tac-toe/rules.ts'

export type { Cell }

/**
 * Pure rules for Ultimate Tic Tac Toe: nine small boards make up one big board.
 * Cell `i` of small board `b` is index `b * 9 + i`. A move at cell `i` of board
 * `b` sends the rival to small board `i`. A small board is closed once it is won
 * or full; a rival sent to a closed board may play on any open board instead.
 * Three small boards in a row win the game. When every board is closed without
 * such a line, the side that won more small boards wins, else it is a draw.
 */

export interface Position {
  turn: Side
  /** 81 cells, `b * 9 + i`. */
  cells: Cell[]
  /** Owner of each small board (null while it is open or drawn). */
  won: Cell[]
  /** The small board the next move must go to, or -1 for any open board. */
  active: number
}

export interface Verdict {
  winner: Side | 'draw'
  /** The big-board line that decided the game, if one did. */
  line: number[] | null
  /** Small boards won by red and by blue. */
  boards: [number, number]
}

export function emptyPosition(turn: Side): Position {
  return { turn, cells: Array<Cell>(81).fill(null), won: Array<Cell>(9).fill(null), active: -1 }
}

export function boardFull(cells: readonly Cell[], b: number): boolean {
  for (let i = 0; i < 9; i++) if (cells[b * 9 + i] === null) return false
  return true
}

/** Won or full: nobody can play there any more. */
export function closed(p: Position, b: number): boolean {
  return p.won[b] !== null || boardFull(p.cells, b)
}

export function isLegal(p: Position, m: number): boolean {
  if (!Number.isInteger(m) || m < 0 || m > 80) return false
  const b = Math.floor(m / 9)
  if (p.cells[m] !== null || p.won[b] !== null) return false
  return p.active === -1 || p.active === b
}

export function legalMoves(p: Position): number[] {
  const out: number[] = []
  for (let b = 0; b < 9; b++) {
    if (p.active !== -1 && p.active !== b) continue
    if (p.won[b] !== null) continue
    for (let i = 0; i < 9; i++) if (p.cells[b * 9 + i] === null) out.push(b * 9 + i)
  }
  return out
}

/** Play move `m` for the side to move. Throws on an illegal move. */
export function play(p: Position, m: number): Position {
  if (!isLegal(p, m)) throw new Error(`Move ${m} is not legal`)
  const b = Math.floor(m / 9)
  const cells = p.cells.slice()
  cells[m] = p.turn
  const won = p.won.slice()
  const small = smallOutcome(cells.slice(b * 9, b * 9 + 9))
  if (small && small.winner !== 'draw') won[b] = small.winner
  const target = m % 9
  const active = won[target] !== null || boardFull(cells, target) ? -1 : target
  return { turn: other(p.turn), cells, won, active }
}

/** The game's result once it is decided, else null. */
export function verdict(p: Position): Verdict | null {
  const boards: [number, number] = [0, 0]
  for (const w of p.won) if (w !== null) boards[w]++
  const big = lineWinner(p.won)
  if (big) return { winner: big.side, line: [...big.line], boards }
  for (let b = 0; b < 9; b++) if (!closed(p, b)) return null
  const winner = boards[0] === boards[1] ? 'draw' : boards[0] > boards[1] ? 0 : 1
  return { winner, line: null, boards }
}

/** Cells of small board `b` where `side` would complete a small line right now. */
export function winningCells(cells: readonly Cell[], b: number, side: Side): number[] {
  const board = cells.slice(b * 9, b * 9 + 9)
  const out: number[] = []
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue
    board[i] = side
    if (lineWinner(board)?.side === side) out.push(i)
    board[i] = null
  }
  return out
}

/** Line value for one side on a small board (open boards) and on the big board. */
const POTENTIAL = [0, 1, 6, 0] as const
const BIG_POTENTIAL = [0, 4, 24, 0] as const

/** Heuristic from `side`'s point of view: ±1000 for a big line, else boards, threats and the centre. */
export function evaluate(p: Position, side: Side): number {
  const big = lineWinner(p.won)
  if (big) return big.side === side ? 1000 : -1000
  const rival = other(side)
  let v = 0
  for (const w of p.won) {
    if (w === side) v += 10
    else if (w === rival) v -= 10
  }
  if (p.won[4] === side) v += 4
  else if (p.won[4] === rival) v -= 4
  for (let b = 0; b < 9; b++) {
    if (p.won[b] !== null) continue
    for (const line of LINES) {
      let mine = 0
      let theirs = 0
      for (const i of line) {
        const c = p.cells[b * 9 + i]
        if (c === side) mine++
        else if (c === rival) theirs++
      }
      if (theirs === 0) v += POTENTIAL[mine] ?? 0
      if (mine === 0) v -= POTENTIAL[theirs] ?? 0
    }
  }
  for (const line of LINES) {
    let mine = 0
    let theirs = 0
    for (const i of line) {
      const w = p.won[i]
      if (w === side) mine++
      else if (w === rival) theirs++
    }
    if (theirs === 0) v += BIG_POTENTIAL[mine] ?? 0
    if (mine === 0) v -= BIG_POTENTIAL[theirs] ?? 0
  }
  return v
}
