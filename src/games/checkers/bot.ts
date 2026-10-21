import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { apply, type Cell, colOf, isKing, legalMoves, type Move, owner, rowOf } from './rules.ts'

/**
 * The computer player: negamax with alpha-beta over whole moves (multi-jumps
 * included). Score is material (a king is 1.6 men) plus how far each man has
 * advanced toward crowning. Easy searches 2 plies and sometimes plays at random,
 * normal 4, hard 6. A node budget keeps every answer quick; ai.ts runs it in a
 * Web Worker.
 */

export interface Pos {
  board: Cell[]
  turn: Side
  ply: number
}

const DEPTH: Record<Difficulty, number> = { easy: 2, normal: 4, hard: 6 }
const BUDGET: Record<Difficulty, number> = { easy: 3000, normal: 15000, hard: 40000 }
/** Noise on each score: easy blunders a little, normal wobbles, hard is exact. */
const NOISE: Record<Difficulty, number> = { easy: 0.6, normal: 0.08, hard: 0 }

interface Search {
  nodes: number
  budget: number
  stop: boolean
}

/** How far a piece has come toward crowning, 0 at its own back row. */
function advance(side: Side, row: number): number {
  return side === 0 ? 7 - row : row
}

/** Score for `side`: material, advancement, kings in the middle, and in a won ending, the hunt. */
export function evaluate(board: readonly Cell[], side: Side): number {
  let score = 0
  let mine = 0
  let theirs = 0
  const kings: number[] = []
  const prey: number[] = []
  for (let i = 0; i < 64; i++) {
    const cell = board[i] ?? 0
    const who = owner(cell)
    if (who === null) continue
    const r = rowOf(i)
    const c = colOf(i)
    let v: number
    if (isKing(cell)) {
      v = 1.6 + (r >= 2 && r <= 5 && c >= 2 && c <= 5 ? 0.1 : 0)
    } else v = 1 + 0.07 * advance(who, r)
    score += who === side ? v : -v
    if (who === side) {
      mine += isKing(cell) ? 1.6 : 1
      if (isKing(cell)) kings.push(i)
    } else {
      theirs += isKing(cell) ? 1.6 : 1
      prey.push(i)
    }
  }
  // In a won ending, the side ahead wants to trade down and close in, so it is actually won
  // (kings that wander about let the move limit decide). Counted for one side, against the other.
  if (mine !== theirs && mine + theirs > 0) {
    const ahead = mine > theirs
    const hunters = ahead ? kings : kingsOf(board, side === 0 ? 1 : 0)
    const hunted = ahead ? prey : piecesOf(board, side)
    let h = Math.abs(mine - theirs) / (mine + theirs)
    // Average distance from each hunting king to its nearest prey (a new king is never a minus).
    let sum = 0
    for (const k of hunters) {
      let near = 8
      for (const p of hunted) {
        near = Math.min(
          near,
          Math.max(Math.abs(rowOf(k) - rowOf(p)), Math.abs(colOf(k) - colOf(p))),
        )
      }
      sum += near
    }
    if (hunters.length) h -= (0.1 * sum) / hunters.length
    score += ahead ? h : -h
  }
  return score
}

function kingsOf(board: readonly Cell[], side: Side): number[] {
  const out: number[] = []
  for (let i = 0; i < 64; i++)
    if (owner(board[i] ?? 0) === side && isKing(board[i] ?? 0)) out.push(i)
  return out
}

function piecesOf(board: readonly Cell[], side: Side): number[] {
  const out: number[] = []
  for (let i = 0; i < 64; i++) if (owner(board[i] ?? 0) === side) out.push(i)
  return out
}

/** Captures that take more pieces first, then moves that go furthest toward crowning. */
function ordered(moves: readonly Move[], side: Side): Move[] {
  const key = (m: Move): number => {
    const to = m.path[m.path.length - 1] ?? 0
    return m.captured.length * 100 + advance(side, rowOf(to))
  }
  return moves.slice().sort((a, b) => key(b) - key(a))
}

function negamax(
  s: Search,
  board: readonly Cell[],
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  s.nodes++
  if (s.nodes > s.budget) {
    s.stop = true
    return 0
  }
  const moves = legalMoves(board, side)
  if (moves.length === 0) return -(1000 - ply)
  if (depth === 0) return evaluate(board, side)
  let best = -Infinity
  let a = alpha
  for (const m of ordered(moves, side)) {
    const next = apply(board, m).board
    const v = -negamax(s, next, side === 0 ? 1 : 0, depth - 1, -beta, -a, ply + 1)
    if (s.stop) return 0
    if (v > best) best = v
    if (best > a) a = best
    if (a >= beta) break
  }
  return best
}

/** Best move for the side to move. Captures are forced by the rules, so this is always legal. */
export function choose(pos: Pos, difficulty: Difficulty, rng: Rng): Move {
  const moves = legalMoves(pos.board, pos.turn)
  if (moves.length <= 1) return moves[0] as Move
  if (difficulty === 'easy' && rng.chance(0.2)) return rng.pick(moves)
  const other: Side = pos.turn === 0 ? 1 : 0
  let order = ordered(moves, pos.turn)
  let picked = order[0] as Move
  for (let depth = 1; depth <= DEPTH[difficulty]; depth++) {
    const s: Search = { nodes: 0, budget: BUDGET[difficulty], stop: false }
    const scored: { m: Move; v: number }[] = []
    for (const m of order) {
      const next = apply(pos.board, m).board
      const v = -negamax(s, next, other, depth - 1, -Infinity, Infinity, 1)
      if (s.stop) break
      scored.push({ m, v: v + rng.range(-NOISE[difficulty], NOISE[difficulty]) })
    }
    // Out of budget: the deeper search is incomplete, so keep the last full one.
    if (s.stop) break
    picked = bestOf(scored, rng) ?? picked
    order = scored.sort((a, b) => b.v - a.v).map((x) => x.m)
  }
  return picked
}

/** Highest score, ties broken at random. */
function bestOf(scored: { m: Move; v: number }[], rng: Rng): Move | undefined {
  let best = -Infinity
  let ties: Move[] = []
  for (const { m, v } of scored) {
    if (v > best + 1e-9) {
      best = v
      ties = [m]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(m)
  }
  return ties.length ? ties[rng.int(0, ties.length - 1)] : undefined
}
