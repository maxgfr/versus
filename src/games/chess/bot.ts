import { Chess, type PieceSymbol, type Square } from 'chess.js'
import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { Pos, Step } from './rules.ts'

/**
 * The computer player. Alpha-beta over chess.js moves with material and
 * piece-square tables. Easy searches one ply and sometimes plays at random,
 * normal searches two plies, hard searches three plus captures to the end of
 * each line (quiescence). A node budget keeps every answer quick and the same
 * on every device; `ai.ts` runs it in a Web Worker.
 */

const MATE = 100000
const VALUE: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }

// Piece-square tables, white's view, row 0 = rank 8. Black reads them mirrored.
const PST: Record<PieceSymbol, readonly number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
    10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
    -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
    0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0,
    5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
    -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
    -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0,
    10, 30, 20,
  ],
}

interface Search {
  c: Chess
  nodes: number
  budget: number
  stop: boolean
  quiet: boolean
}

/** Score from the side to move. */
function evaluate(c: Chess): number {
  let score = 0
  const rows = c.board()
  for (let r = 0; r < 8; r++) {
    const row = rows[r] ?? []
    for (let f = 0; f < 8; f++) {
      const p = row[f]
      if (!p) continue
      if (p.color === 'w') score += VALUE[p.type] + (PST[p.type][r * 8 + f] ?? 0)
      else score -= VALUE[p.type] + (PST[p.type][(7 - r) * 8 + f] ?? 0)
    }
  }
  return c.turn() === 'w' ? score : -score
}

const TO = /([a-h][1-8])(?:=[QRBN])?[+#]?$/

/** Captures first (most valuable victim, least valuable attacker), then promotions, then checks. */
function orderMoves(c: Chess, moves: string[]): string[] {
  const keyed = moves.map((san) => {
    let k = 0
    if (san.includes('x')) {
      const to = TO.exec(san)?.[1] as Square | undefined
      const victim = to ? c.get(to) : undefined
      const attacker = /^[KQRBN]/.test(san) ? (san[0]?.toLowerCase() as PieceSymbol) : 'p'
      k += 10000 + (victim ? VALUE[victim.type] : 100) * 10 - VALUE[attacker]
    }
    if (san.includes('=')) k += 8000
    if (san.endsWith('+') || san.endsWith('#')) k += 50
    return { san, k }
  })
  keyed.sort((a, b) => b.k - a.k)
  return keyed.map((x) => x.san)
}

function quiesce(s: Search, a: number, b: number): number {
  s.nodes++
  const stand = evaluate(s.c)
  if (stand >= b) return stand
  if (stand > a) a = stand
  if (s.nodes > s.budget) {
    s.stop = true
    return stand
  }
  const caps = orderMoves(
    s.c,
    s.c.moves().filter((m) => m.includes('x') || m.includes('=')),
  )
  for (const san of caps) {
    s.c.move(san)
    const v = -quiesce(s, -b, -a)
    s.c.undo()
    if (s.stop) return 0
    if (v >= b) return v
    if (v > a) a = v
  }
  return a
}

function search(s: Search, depth: number, a: number, b: number, ply: number): number {
  s.nodes++
  if (s.nodes > s.budget) {
    s.stop = true
    return 0
  }
  const moves = s.c.moves()
  if (moves.length === 0) return s.c.inCheck() ? -(MATE - ply) : 0
  if (depth === 0) return s.quiet ? quiesce(s, a, b) : evaluate(s.c)
  let best = -Infinity
  for (const san of orderMoves(s.c, moves)) {
    s.c.move(san)
    const v = -search(s, depth - 1, -b, -a, ply + 1)
    s.c.undo()
    if (s.stop) return 0
    if (v > best) best = v
    if (best > a) a = best
    if (a >= b) break
  }
  return best
}

function toStep(c: Chess, san: string): Step {
  const m = c.move(san)
  const step: Step = { from: m.from, to: m.to }
  if (m.promotion) step.promotion = 'q'
  c.undo()
  return step
}

const DEPTH: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3 }
/** Nodes per move (about 50 µs each in chess.js): keeps hard well under 1.5 s on a phone. */
const BUDGET: Record<Difficulty, number> = { easy: 200, normal: 1000, hard: 4000 }
/** Centipawn noise on the scores: easy blunders, normal wobbles a little. */
const NOISE: Record<Difficulty, number> = { easy: 180, normal: 25, hard: 0 }

/** Best move for the side to move in `pos`. Always a legal move (promotions are queens). */
export function choose(pos: Pos, difficulty: Difficulty, rng: Rng): Step {
  const c = new Chess(pos.fen)
  const seen = positionsSeen(pos.history)
  const all = c.moves().filter((san) => !/=[RBN]/.test(san))
  if (difficulty === 'easy' && rng.chance(0.15)) return toStep(c, rng.pick(all))
  let picked = all[0] ?? ''
  // Root order from the previous, shallower iteration: better cut-offs at the next depth.
  let order = orderMoves(c, all)
  for (let depth = 1; depth <= DEPTH[difficulty]; depth++) {
    const s: Search = {
      c,
      nodes: 0,
      budget: BUDGET[difficulty],
      stop: false,
      quiet: difficulty === 'hard',
    }
    const scored: { san: string; v: number }[] = []
    for (const san of order) {
      c.move(san)
      // Going back to a position already seen heads for a repetition draw: worth 0, so
      // the side ahead avoids it and the side behind welcomes it.
      const v = seen.has(key(c.fen())) ? 0 : -search(s, depth - 1, -Infinity, Infinity, 1)
      c.undo()
      if (s.stop) break
      scored.push({ san, v: v + rng.range(-NOISE[difficulty], NOISE[difficulty]) })
    }
    // Out of budget: the deeper search is incomplete, so keep the last full one.
    if (s.stop) break
    picked = bestOf(scored, rng) ?? picked
    order = scored.sort((a, b) => b.v - a.v).map((x) => x.san)
  }
  return toStep(c, picked)
}

/** A position without its move clocks, as repetition counts it. */
const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

/** Every position the game has passed through. */
function positionsSeen(history: readonly string[]): Set<string> {
  const c = new Chess()
  const out = new Set([key(c.fen())])
  for (const san of history) {
    c.move(san)
    out.add(key(c.fen()))
  }
  return out
}

/** Highest score, ties broken at random so the computer is not predictable. */
function bestOf(scored: { san: string; v: number }[], rng: Rng): string | undefined {
  let best = -Infinity
  let ties: string[] = []
  for (const { san, v } of scored) {
    if (v > best + 1e-9) {
      best = v
      ties = [san]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(san)
  }
  return ties.length ? ties[rng.int(0, ties.length - 1)] : undefined
}
