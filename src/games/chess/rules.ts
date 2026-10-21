import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'
import type { Side } from '../../core/game.ts'

/**
 * Pure chess rules, with chess.js doing the legality. No DOM, no canvas, no
 * randomness. Red is White (side 0, at the bottom); blue is Black (side 1, top).
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
/** The game ends by material on this many plies (computer-vs-computer always finishes). */
export const MAX_PLIES = 150
export const FILES = 'abcdefgh'

/** Everything the rules need: the position and how it was reached (for repetition). */
export interface Pos {
  fen: string
  /** Moves so far in SAN, from the standard start. */
  history: string[]
}

export type Status = 'playing' | 'check' | 'mate' | 'draw' | 'limit'

/** A move as the board sees it. Promotions are always to a queen. */
export interface Step {
  from: string
  to: string
  promotion?: 'q'
}

export interface Played {
  pos: Pos
  san: string
  from: string
  to: string
  color: Color
  piece: PieceSymbol
  captured: PieceSymbol | null
  /** Square the captured piece stood on (differs from `to` for en passant). */
  capturedAt: string | null
  promoted: boolean
  check: boolean
}

export interface Verdict {
  status: Status
  /** Set once the game is decided. 'draw' for any drawn ending. */
  winner?: Side | 'draw'
  note?: string
}

export interface Piece {
  type: PieceSymbol
  color: Color
}

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

export const START: Pos = { fen: START_FEN, history: [] }

export function sideOf(color: Color): Side {
  return color === 'w' ? 0 : 1
}

export function colorOf(side: Side): Color {
  return side === 0 ? 'w' : 'b'
}

/** Square name for board coordinates: column 0..7 (a..h), row 0..7 from the top (rank 8). */
export function squareAt(c: number, r: number): string {
  return `${FILES[c]}${8 - r}`
}

export function coordsOf(sq: string): { c: number; r: number } {
  return { c: FILES.indexOf(sq[0] as string), r: 8 - Number(sq[1]) }
}

/** The pieces of a FEN placement, indexed row * 8 + column (row 0 is rank 8). */
export function boardOf(fen: string): (Piece | null)[] {
  const out: (Piece | null)[] = []
  const rows = (fen.split(' ')[0] ?? '').split('/')
  for (const row of rows) {
    for (const ch of row) {
      const n = Number(ch)
      if (n) for (let i = 0; i < n; i++) out.push(null)
      else {
        const lower = ch.toLowerCase() as PieceSymbol
        out.push({ type: lower, color: ch === lower ? 'b' : 'w' })
      }
    }
  }
  return out
}

/** Square of a colour's king, or null. */
export function findKing(fen: string, color: Color): string | null {
  const i = boardOf(fen).findIndex((p) => p?.type === 'k' && p.color === color)
  return i < 0 ? null : squareAt(i % 8, Math.floor(i / 8))
}

/** White's material minus black's, in pawns. */
export function material(fen: string): number {
  let sum = 0
  for (const p of boardOf(fen)) {
    if (!p) continue
    sum += p.color === 'w' ? VALUE[p.type] : -VALUE[p.type]
  }
  return sum
}

/** Legal moves for the side to move, promotions reduced to queen. */
export function legalMoves(fen: string): Step[] {
  return new Chess(fen)
    .moves({ verbose: true })
    .filter((m) => !m.promotion || m.promotion === 'q')
    .map((m) => ({ from: m.from, to: m.to, promotion: m.promotion === 'q' ? 'q' : undefined }))
}

/** Where the piece on `from` may go. Empty when `from` holds nothing movable. */
export function targetsFrom(fen: string, from: string): Step[] {
  return new Chess(fen)
    .moves({ verbose: true, square: from as Square })
    .filter((m) => !m.promotion || m.promotion === 'q')
    .map((m) => ({ from: m.from, to: m.to, promotion: m.promotion === 'q' ? 'q' : undefined }))
}

/** Rebuild a position from the standard start by replaying its SAN history. */
export function replay(history: readonly string[]): Chess {
  const c = new Chess()
  for (const san of history) c.move(san)
  return c
}

/** Play a legal move. Throws on an illegal one. */
export function play(pos: Pos, from: string, to: string): Played {
  const c = new Chess(pos.fen)
  const pawn = c.get(from as Square)?.type === 'p'
  const last = to[1] === '8' || to[1] === '1'
  const m = c.move({ from, to, promotion: pawn && last ? 'q' : undefined })
  const captured = m.captured ?? null
  let capturedAt: string | null = null
  if (captured) capturedAt = m.isEnPassant() ? `${to[0]}${from[1]}` : to
  return {
    pos: { fen: c.fen(), history: [...pos.history, m.san] },
    san: m.san,
    from,
    to: m.to,
    color: m.color,
    piece: m.piece,
    captured,
    capturedAt,
    promoted: m.isPromotion(),
    check: c.inCheck(),
  }
}

/** Is the game decided, drawn, or still going? */
export function verdict(pos: Pos): Verdict {
  const c = new Chess(pos.fen)
  if (c.isCheckmate())
    return { status: 'mate', winner: sideOf(c.turn() === 'w' ? 'b' : 'w'), note: 'Checkmate' }
  if (c.isStalemate()) return { status: 'draw', winner: 'draw', note: 'Stalemate' }
  if (c.isInsufficientMaterial())
    return { status: 'draw', winner: 'draw', note: 'Not enough material' }
  if (pos.history.length >= 8) {
    const r = replay(pos.history)
    if (r.fen() === pos.fen && r.isThreefoldRepetition())
      return { status: 'draw', winner: 'draw', note: 'Threefold repetition' }
  }
  if (c.isDrawByFiftyMoves()) return { status: 'draw', winner: 'draw', note: 'Fifty-move rule' }
  if (pos.history.length >= MAX_PLIES) {
    const m = material(pos.fen)
    return {
      status: 'limit',
      winner: m > 0 ? 0 : m < 0 ? 1 : 'draw',
      note: m === 0 ? 'Move limit, level material' : 'Move limit, ahead in material',
    }
  }
  return { status: c.inCheck() ? 'check' : 'playing' }
}
