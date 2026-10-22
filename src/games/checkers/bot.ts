import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Cell, colOf, isKing, legalMoves, type Move, owner, rowOf } from './rules.ts'

/**
 * The computer player: negamax with α-β over whole moves (multi-jumps
 * included) on one mutable board (make / unmake, no copies), with captures
 * searched to the end of every line (they are forced anyway), killer-move
 * ordering and iterative deepening under a node budget. Score is material (a
 * king is 1.6 men), how far each man has come, kings in the middle, and in a
 * won ending the hunt. Easy reads 2 plies with noise and sometimes plays at
 * random; normal 6; hard as deep as its budget goes. ai.ts runs it in a Web
 * Worker.
 */

export interface Pos {
  board: Cell[]
  turn: Side
  ply: number
}

const DEPTH: Record<Difficulty, number> = { easy: 2, normal: 6, hard: 20 }
const BUDGET: Record<Difficulty, number> = { easy: 3000, normal: 30000, hard: 150000 }
/** Noise on each score: easy blunders a little, normal wobbles, hard is exact. */
const NOISE: Record<Difficulty, number> = { easy: 0.6, normal: 0.05, hard: 0 }
/** How often the computer just plays any move. */
const RANDOM: Record<Difficulty, number> = { easy: 0.2, normal: 0, hard: 0 }

/** How far a piece has come toward crowning, 0 at its own back row. */
function advance(side: Side, row: number): number {
  return side === 0 ? 7 - row : row
}

/** Score for `side`: material, advancement, kings in the middle, and in a won ending, the hunt. */
export function evaluate(board: ArrayLike<number>, side: Side): number {
  let score = 0
  let mine = 0
  let theirs = 0
  const kings: number[] = []
  const prey: number[] = []
  for (let i = 0; i < 64; i++) {
    const cell = (board[i] ?? 0) as Cell
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

function kingsOf(board: ArrayLike<number>, side: Side): number[] {
  const out: number[] = []
  for (let i = 0; i < 64; i++) {
    const cell = (board[i] ?? 0) as Cell
    if (owner(cell) === side && isKing(cell)) out.push(i)
  }
  return out
}

function piecesOf(board: ArrayLike<number>, side: Side): number[] {
  const out: number[] = []
  for (let i = 0; i < 64; i++) if (owner((board[i] ?? 0) as Cell) === side) out.push(i)
  return out
}

/** A move on the search board: the squares it stands on and the pieces it takes. */
interface FastMove {
  path: number[]
  caps: number[]
  /** Ordering key. */
  key: number
}

/** Marks a jumped piece during a capture walk: neither enemy nor empty, so it is never taken twice or landed on. */
const TAKEN = 5

function enemyOf(cell: number, side: Side): boolean {
  if (cell === 0 || cell === TAKEN) return false
  return (cell <= 2 ? 0 : 1) !== side
}

/** Every capture sequence from `pos` onward, pushed into `out` as it ends. */
function walk(
  b: Int8Array,
  side: Side,
  king: boolean,
  pos: number,
  path: number[],
  taken: number[],
  out: FastMove[],
): void {
  const r = pos >> 3
  const c = pos & 7
  const fwd = side === 0 ? -1 : 1
  let extended = false
  for (let d = 0; d < 4; d++) {
    const dr = d < 2 ? -1 : 1
    const dc = d % 2 === 0 ? -1 : 1
    if (!king && dr !== fwd) continue
    const lr = r + 2 * dr
    const lc = c + 2 * dc
    if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue
    const mid = (r + dr) * 8 + c + dc
    const land = lr * 8 + lc
    const v = b[mid] as number
    if (!enemyOf(v, side) || b[land] !== 0) continue
    extended = true
    b[mid] = TAKEN
    path.push(land)
    taken.push(mid)
    walk(b, side, king, land, path, taken, out)
    taken.pop()
    path.pop()
    b[mid] = v
  }
  if (!extended && taken.length > 0)
    out.push({ path: path.slice(), caps: taken.slice(), key: taken.length * 100 })
}

/** Can the piece on `i` jump anything right now? (A cheap test before the full walk.) */
function canJump(b: Int8Array, side: Side, king: boolean, i: number): boolean {
  const r = i >> 3
  const c = i & 7
  const fwd = side === 0 ? -1 : 1
  for (let d = 0; d < 4; d++) {
    const dr = d < 2 ? -1 : 1
    const dc = d % 2 === 0 ? -1 : 1
    if (!king && dr !== fwd) continue
    const lr = r + 2 * dr
    const lc = c + 2 * dc
    if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue
    if (enemyOf(b[(r + dr) * 8 + c + dc] as number, side) && b[lr * 8 + lc] === 0) return true
  }
  return false
}

/** Legal moves for `side` on a mutable board (the same rules as `legalMoves`, without the copies). */
function generate(b: Int8Array, side: Side): FastMove[] {
  const caps: FastMove[] = []
  const fwd = side === 0 ? -1 : 1
  for (let i = 0; i < 64; i++) {
    const cell = b[i] as number
    if (cell === 0 || (cell <= 2 ? 0 : 1) !== side) continue
    const king = cell === 2 || cell === 4
    if (!canJump(b, side, king, i)) continue
    // The piece leaves its square first, so a king can circle back through where it stood.
    b[i] = 0
    walk(b, side, king, i, [i], [], caps)
    b[i] = cell
  }
  if (caps.length) return caps
  const quiet: FastMove[] = []
  for (let i = 0; i < 64; i++) {
    const cell = b[i] as number
    if (cell === 0 || (cell <= 2 ? 0 : 1) !== side) continue
    const king = cell === 2 || cell === 4
    const r = i >> 3
    const c = i & 7
    for (let d = 0; d < 4; d++) {
      const dr = d < 2 ? -1 : 1
      const dc = d % 2 === 0 ? -1 : 1
      if (!king && dr !== fwd) continue
      const nr = r + dr
      const nc = c + dc
      if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue
      const to = nr * 8 + nc
      if (b[to] !== 0) continue
      quiet.push({ path: [i, to], caps: [], key: king ? 0 : advance(side, nr) })
    }
  }
  return quiet
}

/** Play a move on the search board; returns what `unmake` needs. */
function make(b: Int8Array, m: FastMove): number[] {
  const from = m.path[0] as number
  const to = m.path[m.path.length - 1] as number
  const piece = b[from] as number
  const undo = [piece]
  for (const c of m.caps) {
    undo.push(c, b[c] as number)
    b[c] = 0
  }
  b[from] = 0
  const crowned = (piece === 1 && to >> 3 === 0) || (piece === 3 && to >> 3 === 7)
  b[to] = crowned ? piece + 1 : piece
  return undo
}

function unmake(b: Int8Array, m: FastMove, undo: number[]): void {
  const from = m.path[0] as number
  const to = m.path[m.path.length - 1] as number
  b[to] = 0
  b[from] = undo[0] as number
  for (let k = 1; k < undo.length; k += 2) b[undo[k] as number] = undo[k + 1] as number
}

const moveId = (m: FastMove) => (m.path[0] as number) * 64 + (m.path[m.path.length - 1] as number)

interface Fast {
  b: Int8Array
  nodes: number
  budget: number
  stop: boolean
  killers: Int32Array
}

const MAX_PLY = 48

function search(
  f: Fast,
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  f.nodes++
  if (f.nodes > f.budget) {
    f.stop = true
    return 0
  }
  const moves = generate(f.b, side)
  if (moves.length === 0) return -(1000 - ply)
  // Captures are forced: keep going until the position is quiet.
  const forced = (moves[0]?.caps.length ?? 0) > 0
  if ((depth <= 0 && !forced) || ply >= MAX_PLY) return evaluate(f.b, side)
  const k0 = f.killers[ply * 2]
  const k1 = f.killers[ply * 2 + 1]
  for (const m of moves) {
    const id = moveId(m)
    if (id === k0) m.key += 50
    else if (id === k1) m.key += 40
  }
  moves.sort((a, b) => b.key - a.key)
  let best = -Infinity
  let a = alpha
  const opp: Side = side === 0 ? 1 : 0
  for (const m of moves) {
    const undo = make(f.b, m)
    const v = -search(f, opp, depth - 1, -beta, -a, ply + 1)
    unmake(f.b, m, undo)
    if (f.stop) return 0
    if (v > best) best = v
    if (best > a) a = best
    if (a >= beta) {
      if (!m.caps.length) {
        f.killers[ply * 2 + 1] = f.killers[ply * 2] as number
        f.killers[ply * 2] = moveId(m)
      }
      break
    }
  }
  return best
}

/** Best move for the side to move. Captures are forced by the rules, so this is always legal. */
export function choose(pos: Pos, difficulty: Difficulty, rng: Rng): Move {
  const legal = legalMoves(pos.board, pos.turn)
  if (legal.length <= 1) return legal[0] as Move
  if (rng.chance(RANDOM[difficulty])) return rng.pick(legal)
  const f: Fast = {
    b: Int8Array.from(pos.board),
    nodes: 0,
    budget: BUDGET[difficulty],
    stop: false,
    killers: new Int32Array(MAX_PLY * 2).fill(-1),
  }
  const other: Side = pos.turn === 0 ? 1 : 0
  let order = generate(f.b, pos.turn).sort((a, b) => b.key - a.key)
  let scored: { m: FastMove; v: number }[] = order.map((m) => ({ m, v: 0 }))
  for (let depth = 1; depth <= DEPTH[difficulty]; depth++) {
    const round: { m: FastMove; v: number }[] = []
    for (const m of order) {
      const undo = make(f.b, m)
      const v = -search(f, other, depth - 1, -Infinity, Infinity, 1)
      unmake(f.b, m, undo)
      if (f.stop) break
      round.push({ m, v })
    }
    // Out of budget: the deeper search is incomplete, so keep the last full one.
    if (f.stop) break
    round.sort((x, y) => y.v - x.v)
    scored = round
    order = round.map((x) => x.m)
    // A forced win found: no need to look deeper.
    if (Math.abs(round[0]?.v ?? 0) > 900) break
  }
  const noise = NOISE[difficulty]
  const noisy = scored.map(({ m, v }) => ({ m, v: v + rng.range(-noise, noise) }))
  const pick = bestOf(noisy, rng)
  const same = (m: Move) =>
    pick !== undefined &&
    m.path.length === pick.path.length &&
    m.path.every((sq, i) => sq === pick.path[i])
  return legal.find(same) ?? (legal[0] as Move)
}

/** Highest score, ties broken at random. */
function bestOf(scored: { m: FastMove; v: number }[], rng: Rng): FastMove | undefined {
  let best = -Infinity
  let ties: FastMove[] = []
  for (const { m, v } of scored) {
    if (v > best + 1e-9) {
      best = v
      ties = [m]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(m)
  }
  return ties.length ? ties[rng.int(0, ties.length - 1)] : undefined
}

/** The search's own move list for a position, as rules moves (tests check it against `legalMoves`). */
export function searchMoves(board: readonly Cell[], side: Side): Move[] {
  return generate(Int8Array.from(board), side).map((m) => ({ path: m.path, captured: m.caps }))
}
