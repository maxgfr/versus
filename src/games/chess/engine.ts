/**
 * A small, fast chess engine for the computer player: a 0x88 board with
 * make / unmake, legal move generation (castling, en passant, promotions to a
 * queen as the game plays them), and an α-β search with iterative deepening,
 * quiescence, MVV-LVA and killer ordering and a node budget (so an answer is
 * the same on every device). Pure, no DOM; chess.js stays the referee.
 */

// Pieces: 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king; black adds 8.
const P = 1
const N = 2
const B = 3
const R = 4
const Q = 5
const K = 6
const BLACK = 8

const FLAG_CAP = 1
const FLAG_EP = 2
const FLAG_CASTLE = 4
const FLAG_DOUBLE = 8
const FLAG_PROMO = 16

const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33]
const KING = [-17, -16, -15, -1, 1, 15, 16, 17]
const DIAG = [-17, -15, 15, 17]
const ORTHO = [-16, -1, 1, 16]

export const MATE = 100000
const VALUE = [0, 100, 320, 330, 500, 900, 0]

// Piece-square tables, white's view, row 0 = rank 8 (as in the old bot).
const PST: readonly (readonly number[])[] = [
  [],
  [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
    10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
    -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0,
    0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0,
    5, 5, 0, 0, 0,
  ],
  [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
    -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
    -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0,
    10, 30, 20,
  ],
]
/** The king in the endgame: come to the middle. */
const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30,
  20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10,
  20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
]

const MAX_PLY = 64

export interface Engine {
  b: Int8Array
  /** 0 white, 1 black to move. */
  side: number
  /** Castling rights: 1 white short, 2 white long, 4 black short, 8 black long. */
  castle: number
  /** En passant target square (0x88) or -1. */
  ep: number
  kings: [number, number]
  // Undo stack.
  stack: number[]
  nodes: number
}

const sq88 = (file: number, rank: number) => rank * 16 + file
export const nameOf = (s: number) => `${'abcdefgh'[s & 7]}${(s >> 4) + 1}`
const parseSq = (n: string) => sq88('abcdefgh'.indexOf(n[0] as string), Number(n[1]) - 1)

export function fromFen(fen: string): Engine {
  const [place = '', turn = 'w', cast = '-', ep = '-'] = fen.split(' ')
  const b = new Int8Array(128)
  const kings: [number, number] = [-1, -1]
  const rows = place.split('/')
  rows.forEach((row, i) => {
    const rank = 7 - i
    let file = 0
    for (const ch of row) {
      const n = Number(ch)
      if (n) {
        file += n
        continue
      }
      const lower = ch.toLowerCase()
      const t = ' pnbrqk'.indexOf(lower)
      const black = ch === lower
      const s = sq88(file, rank)
      b[s] = t + (black ? BLACK : 0)
      if (t === K) kings[black ? 1 : 0] = s
      file++
    }
  })
  let castle = 0
  if (cast.includes('K')) castle |= 1
  if (cast.includes('Q')) castle |= 2
  if (cast.includes('k')) castle |= 4
  if (cast.includes('q')) castle |= 8
  return {
    b,
    side: turn === 'w' ? 0 : 1,
    castle,
    ep: ep === '-' ? -1 : parseSq(ep),
    kings,
    stack: [],
    nodes: 0,
  }
}

/** Is `s` attacked by side `by`? */
export function attacked(e: Engine, s: number, by: number): boolean {
  const b = e.b
  const col = by === 0 ? 0 : BLACK
  // Pawns: a white pawn attacks up (+15, +17), so it sits below the square.
  const pd = by === 0 ? -1 : 1
  for (const d of [15 * pd, 17 * pd]) {
    const t = s + d
    if (!(t & 0x88) && b[t] === P + col) return true
  }
  for (const d of KNIGHT) {
    const t = s + d
    if (!(t & 0x88) && b[t] === N + col) return true
  }
  for (const d of KING) {
    const t = s + d
    if (!(t & 0x88) && b[t] === K + col) return true
  }
  for (const d of DIAG) {
    let t = s + d
    while (!(t & 0x88)) {
      const p = b[t] as number
      if (p) {
        if (p === B + col || p === Q + col) return true
        break
      }
      t += d
    }
  }
  for (const d of ORTHO) {
    let t = s + d
    while (!(t & 0x88)) {
      const p = b[t] as number
      if (p) {
        if (p === R + col || p === Q + col) return true
        break
      }
      t += d
    }
  }
  return false
}

export const inCheck = (e: Engine): boolean => attacked(e, e.kings[e.side] as number, e.side ^ 1)

const enc = (from: number, to: number, flags: number) => from | (to << 7) | (flags << 14)
export const fromOf = (m: number) => m & 127
export const toOf = (m: number) => (m >> 7) & 127
const flagsOf = (m: number) => m >> 14

/** Pseudo-legal moves into `out` (from index `n`); returns the new count. */
function generate(e: Engine, out: Int32Array, n: number, capsOnly: boolean): number {
  const b = e.b
  const us = e.side
  const col = us === 0 ? 0 : BLACK
  const them = us === 0 ? BLACK : 0
  const up = us === 0 ? 16 : -16
  const startRank = us === 0 ? 1 : 6
  const lastRank = us === 0 ? 7 : 0
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) {
      s += 7
      continue
    }
    const p = b[s] as number
    if (!p || (p & BLACK) !== col) continue
    const t = p & 7
    if (t === P) {
      const one = s + up
      if (!(one & 0x88) && !b[one]) {
        if (one >> 4 === lastRank) out[n++] = enc(s, one, FLAG_PROMO)
        else if (!capsOnly) {
          out[n++] = enc(s, one, 0)
          const two = one + up
          if (s >> 4 === startRank && !b[two]) out[n++] = enc(s, two, FLAG_DOUBLE)
        }
      }
      for (const d of [up - 1, up + 1]) {
        const c = s + d
        if (c & 0x88) continue
        const v = b[c] as number
        if (v && (v & BLACK) === them) {
          out[n++] = enc(s, c, FLAG_CAP | (c >> 4 === lastRank ? FLAG_PROMO : 0))
        } else if (c === e.ep) out[n++] = enc(s, c, FLAG_CAP | FLAG_EP)
      }
      continue
    }
    if (t === N || t === K) {
      for (const d of t === N ? KNIGHT : KING) {
        const c = s + d
        if (c & 0x88) continue
        const v = b[c] as number
        if (!v) {
          if (!capsOnly) out[n++] = enc(s, c, 0)
        } else if ((v & BLACK) === them) out[n++] = enc(s, c, FLAG_CAP)
      }
      continue
    }
    const dirs = t === B ? DIAG : t === R ? ORTHO : KING
    for (const d of dirs) {
      let c = s + d
      while (!(c & 0x88)) {
        const v = b[c] as number
        if (!v) {
          if (!capsOnly) out[n++] = enc(s, c, 0)
        } else {
          if ((v & BLACK) === them) out[n++] = enc(s, c, FLAG_CAP)
          break
        }
        c += d
      }
    }
  }
  if (!capsOnly) {
    // Castling: rights, empty squares between, and the king never in or through check.
    const k = e.kings[us] as number
    const home = us === 0 ? 4 : 0x74
    if (k === home) {
      const short = us === 0 ? 1 : 4
      const long = us === 0 ? 2 : 8
      const opp = us ^ 1
      if (
        e.castle & short &&
        !b[home + 1] &&
        !b[home + 2] &&
        b[home + 3] === R + col &&
        !attacked(e, home, opp) &&
        !attacked(e, home + 1, opp) &&
        !attacked(e, home + 2, opp)
      )
        out[n++] = enc(home, home + 2, FLAG_CASTLE)
      if (
        e.castle & long &&
        !b[home - 1] &&
        !b[home - 2] &&
        !b[home - 3] &&
        b[home - 4] === R + col &&
        !attacked(e, home, opp) &&
        !attacked(e, home - 1, opp) &&
        !attacked(e, home - 2, opp)
      )
        out[n++] = enc(home, home - 2, FLAG_CASTLE)
    }
  }
  return n
}

/** Castling rights lost when a piece leaves or lands on a square. */
function rightsMask(s: number): number {
  switch (s) {
    case 0x00:
      return ~2
    case 0x07:
      return ~1
    case 0x04:
      return ~3
    case 0x70:
      return ~8
    case 0x77:
      return ~4
    case 0x74:
      return ~12
    default:
      return ~0
  }
}

/** Make a pseudo-legal move; returns false (and takes it back) if it leaves the mover in check. */
export function make(e: Engine, m: number): boolean {
  const b = e.b
  const from = fromOf(m)
  const to = toOf(m)
  const f = flagsOf(m)
  const piece = b[from] as number
  let captured = b[to] as number
  let capSq = to
  if (f & FLAG_EP) {
    capSq = to + (e.side === 0 ? -16 : 16)
    captured = b[capSq] as number
    b[capSq] = 0
  }
  e.stack.push(m, captured, e.castle, e.ep, capSq)
  b[to] = f & FLAG_PROMO ? Q + (piece & BLACK) : piece
  b[from] = 0
  if ((piece & 7) === K) {
    e.kings[e.side] = to
    if (f & FLAG_CASTLE) {
      if (to > from) {
        b[to - 1] = b[to + 1] as number
        b[to + 1] = 0
      } else {
        b[to + 1] = b[to - 2] as number
        b[to - 2] = 0
      }
    }
  }
  e.castle &= rightsMask(from) & rightsMask(to)
  e.ep = f & FLAG_DOUBLE ? (from + to) >> 1 : -1
  e.side ^= 1
  if (attacked(e, e.kings[e.side ^ 1] as number, e.side)) {
    unmake(e)
    return false
  }
  return true
}

export function unmake(e: Engine): void {
  const st = e.stack
  const capSq = st.pop() as number
  const ep = st.pop() as number
  const castle = st.pop() as number
  const captured = st.pop() as number
  const m = st.pop() as number
  e.side ^= 1
  e.castle = castle
  e.ep = ep
  const b = e.b
  const from = fromOf(m)
  const to = toOf(m)
  const f = flagsOf(m)
  const moved = b[to] as number
  b[from] = f & FLAG_PROMO ? P + (moved & BLACK) : moved
  b[to] = 0
  b[capSq] = captured
  if ((moved & 7) === K) {
    e.kings[e.side] = from
    if (f & FLAG_CASTLE) {
      if (to > from) {
        b[to + 1] = b[to - 1] as number
        b[to - 1] = 0
      } else {
        b[to - 2] = b[to + 1] as number
        b[to + 1] = 0
      }
    }
  }
}

/** Legal moves of the side to move. */
export function legal(e: Engine): number[] {
  const buf = new Int32Array(256)
  const n = generate(e, buf, 0, false)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const m = buf[i] as number
    if (make(e, m)) {
      unmake(e)
      out.push(m)
    }
  }
  return out
}

/** Score from the side to move, in centipawns. */
export function evaluate(e: Engine): number {
  const b = e.b
  let score = 0
  let heavy = 0
  let wk = 0
  let bk = 0
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) {
      s += 7
      continue
    }
    const p = b[s] as number
    if (!p) continue
    const t = p & 7
    const rank = s >> 4
    const file = s & 7
    if (t === K) {
      if (p & BLACK) bk = s
      else wk = s
      continue
    }
    if (t !== P) heavy += VALUE[t] as number
    const pst = PST[t] as readonly number[]
    if (p & BLACK) score -= (VALUE[t] as number) + (pst[rank * 8 + file] ?? 0)
    else score += (VALUE[t] as number) + (pst[(7 - rank) * 8 + file] ?? 0)
  }
  // Kings: shelter in the middlegame, the centre in the endgame.
  const end = heavy <= 2600
  const kt = end ? KING_END : (PST[K] as readonly number[])
  score += kt[(7 - (wk >> 4)) * 8 + (wk & 7)] ?? 0
  score -= kt[(bk >> 4) * 8 + (bk & 7)] ?? 0
  // Mop-up: well ahead in the endgame, drive the lone king to the edge and close in.
  if (end && Math.abs(score) > 300) {
    const loser = score > 0 ? bk : wk
    const winner = score > 0 ? wk : bk
    const lf = loser & 7
    const lr = loser >> 4
    const edge = Math.max(3 - lf, lf - 4) + Math.max(3 - lr, lr - 4)
    const near = Math.abs(lf - (winner & 7)) + Math.abs(lr - (winner >> 4))
    const bonus = edge * 12 + (14 - near) * 5
    score += score > 0 ? bonus : -bonus
  }
  return e.side === 0 ? score : -score
}

// ---------- search ----------

interface Ctx {
  e: Engine
  budget: number
  stop: boolean
  buf: Int32Array[]
  scores: Int32Array[]
  killers: Int32Array
}

function moveScore(e: Engine, m: number, ply: number, c: Ctx): number {
  const f = flagsOf(m)
  if (f & FLAG_CAP) {
    const victim = f & FLAG_EP ? P : (e.b[toOf(m)] as number) & 7
    const attacker = (e.b[fromOf(m)] as number) & 7
    return 100000 + (VALUE[victim] as number) * 10 - (VALUE[attacker] as number) / 10
  }
  if (f & FLAG_PROMO) return 90000
  if (c.killers[ply * 2] === m || c.killers[ply * 2 + 1] === m) return 80000
  return 0
}

/** Moves at `ply`, best-first. */
function ordered(c: Ctx, ply: number, capsOnly: boolean): number {
  const buf = c.buf[ply] as Int32Array
  const sc = c.scores[ply] as Int32Array
  const n = generate(c.e, buf, 0, capsOnly)
  for (let i = 0; i < n; i++) sc[i] = moveScore(c.e, buf[i] as number, ply, c)
  // Insertion sort, high first: lists are short.
  for (let i = 1; i < n; i++) {
    const m = buf[i] as number
    const v = sc[i] as number
    let j = i - 1
    while (j >= 0 && (sc[j] as number) < v) {
      buf[j + 1] = buf[j] as number
      sc[j + 1] = sc[j] as number
      j--
    }
    buf[j + 1] = m
    sc[j + 1] = v
  }
  return n
}

function quiesce(c: Ctx, a: number, b: number, ply: number): number {
  const e = c.e
  e.nodes++
  const stand = evaluate(e)
  if (stand >= b) return stand
  if (stand > a) a = stand
  if (e.nodes > c.budget) {
    c.stop = true
    return stand
  }
  if (ply >= MAX_PLY - 1) return stand
  const n = ordered(c, ply, true)
  const buf = c.buf[ply] as Int32Array
  for (let i = 0; i < n; i++) {
    const m = buf[i] as number
    if (!make(e, m)) continue
    const v = -quiesce(c, -b, -a, ply + 1)
    unmake(e)
    if (c.stop) return 0
    if (v >= b) return v
    if (v > a) a = v
  }
  return a
}

function search(c: Ctx, depth: number, a: number, b: number, ply: number): number {
  const e = c.e
  e.nodes++
  if (e.nodes > c.budget) {
    c.stop = true
    return 0
  }
  const check = inCheck(e)
  // Never stop the search while in check: answer it first.
  if (depth <= 0 && !check) return quiesce(c, a, b, ply)
  if (ply >= MAX_PLY - 1) return evaluate(e)
  const n = ordered(c, ply, false)
  const buf = c.buf[ply] as Int32Array
  let best = -Infinity
  let any = false
  for (let i = 0; i < n; i++) {
    const m = buf[i] as number
    if (!make(e, m)) continue
    any = true
    const v = -search(c, depth - 1, -b, -a, ply + 1)
    unmake(e)
    if (c.stop) return 0
    if (v > best) best = v
    if (v > a) a = v
    if (a >= b) {
      if (!(flagsOf(m) & FLAG_CAP)) {
        c.killers[ply * 2 + 1] = c.killers[ply * 2] as number
        c.killers[ply * 2] = m
      }
      break
    }
  }
  if (!any) return check ? -(MATE - ply) : 0
  return best
}

export interface Scored {
  move: number
  score: number
}

/**
 * Scores of every legal root move after the deepest search that finished
 * inside the budget. `avoid` marks root moves that walk into a repetition:
 * they are worth a draw, scored `-contempt` (a computer that would rather play
 * on takes a repetition only when it is worse off).
 */
export function rootScores(
  e: Engine,
  maxDepth: number,
  budget: number,
  avoid: (m: number) => boolean = () => false,
  contempt = 0,
): Scored[] {
  const c: Ctx = {
    e,
    budget,
    stop: false,
    buf: Array.from({ length: MAX_PLY }, () => new Int32Array(256)),
    scores: Array.from({ length: MAX_PLY }, () => new Int32Array(256)),
    killers: new Int32Array(MAX_PLY * 2),
  }
  e.nodes = 0
  let order = legal(e)
  let done: Scored[] = order.map((move) => ({ move, score: 0 }))
  for (let depth = 1; depth <= maxDepth; depth++) {
    const scored: Scored[] = []
    let a = -Infinity
    for (const m of order) {
      make(e, m)
      // Full window for every root move: the bot wants true scores to pick among (and add its noise).
      const v = avoid(m) ? -contempt : -search(c, depth - 1, -Infinity, Infinity, 1)
      unmake(e)
      if (c.stop) break
      if (v > a) a = v
      scored.push({ move: m, score: v })
    }
    if (c.stop) break
    scored.sort((x, y) => y.score - x.score)
    done = scored
    order = scored.map((x) => x.move)
    // A forced mate found: no need to look deeper.
    if (Math.abs(a) > MATE - 100) break
  }
  return done
}

/** The current position's key for repetition (placement, side, castling, en passant). */
export function keyOf(e: Engine): string {
  let s = ''
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++)
      s += String.fromCharCode(48 + (e.b[rank * 16 + file] as number))
  }
  return `${s}${e.side}${e.castle}${e.ep}`
}
