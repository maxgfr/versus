import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Board,
  BOX_COUNT,
  boxEdges,
  boxesOf,
  completes,
  doubleDealsAfter,
  drawLine,
  givesBox,
  legalLines,
  takeAll,
  waiting,
} from './rules.ts'

/**
 * The computer player. It returns the line to draw.
 *
 * - easy: a random line, often taking a box when one is on offer.
 * - normal: takes the boxes it can, else a line that gives nothing, else the
 *   smallest sacrifice; at the end of a chain it keeps control (declines the
 *   last two boxes) when the rest of the board makes that pay.
 * - hard: plays the endgame by reading it out. Once the quiet lines are nearly
 *   gone, every candidate line is played forward to the end of the game (the
 *   rest played the normal way, a few times over for the quiet phase), and it
 *   keeps the line that ends best for it: which chain to hand over, how, and
 *   whether to take a chain whole or keep control. A clean chains-and-cycles
 *   ending is solved exactly.
 */
export function choose(board: Board, side: Side, difficulty: Difficulty, rng: Rng): number {
  const legal = legalLines(board)
  const completing = legal.filter((e) => completes(board, e))
  if (difficulty === 'easy') {
    if (completing.length && rng.chance(0.6)) return rng.pick(completing)
    return rng.pick(legal)
  }
  if (difficulty === 'hard') {
    const best = readOut(board, side, legal, completing, rng)
    if (best !== undefined) return best
  }
  return normal(board, side, legal, completing, rng)
}

/** The normal way: take, keep control when it pays, play quiet, else give the least. */
function normal(
  board: Board,
  side: Side,
  legal: readonly number[],
  completing: readonly number[],
  rng: Rng,
): number {
  if (completing.length) {
    const keep = control(board, side, legal)
    if (keep !== undefined) return keep
    return rng.pick(completing)
  }
  const safe = legal.filter((e) => !givesBox(board, e))
  if (safe.length) return rng.pick(safe)
  return sacrifice(board, side, legal, false, rng)
}

/** Quiet lines left below which hard starts reading the game out. */
const READ_FROM = 12
/** Playouts per quiet line (the quiet phase is played at random, so it is averaged). */
const PLAYOUTS = 12

/** Net boxes for `side` from here to the end, both sides playing the normal way. */
function playout(board: Board, toMove: Side, side: Side, seed: number): number {
  const rng = new SeededRng(seed)
  let b = board
  let turn = toMove
  let net = 0
  for (let guard = 0; guard < 80; guard++) {
    const legal = legalLines(b)
    if (!legal.length) break
    const completing = legal.filter((e) => completes(b, e))
    const e = normal(b, turn, legal, completing, rng as unknown as Rng)
    const r = drawLine(b, e, turn)
    b = r.board
    if (r.completed.length) net += turn === side ? r.completed.length : -r.completed.length
    else turn = turn === 0 ? 1 : 0
  }
  return net
}

/** A tiny deterministic generator for playouts (the game's rng stays untouched by them). */
class SeededRng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0 || 1
  }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0
    return this.s / 4294967296
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1))
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)] as T
  }
}

/**
 * Hard's look-ahead, once few quiet lines are left: every distinct candidate
 * played to the end. Undefined while the board is still wide open.
 */
function readOut(
  board: Board,
  side: Side,
  legal: readonly number[],
  completing: readonly number[],
  rng: Rng,
): number | undefined {
  const safe = legal.filter((e) => !completes(board, e) && !givesBox(board, e))
  if (safe.length > READ_FROM) return undefined
  const other: Side = side === 0 ? 1 : 0
  // Candidates: each quiet line; when boxes are on offer, taking one (they are alike) or
  // declining with a double-cross; with neither, every line (which region to open, and how).
  let cands: number[]
  if (completing.length) {
    const deal = legal.find((e) => doubleDealsAfter(board, e, side))
    cands = deal === undefined ? [completing[0] as number] : [completing[0] as number, deal]
    if (cands.length === 1) return cands[0]
  } else cands = safe.length ? safe : legal.slice()
  const runs = safe.length && !completing.length ? PLAYOUTS : 1
  let best = -Infinity
  let ties: number[] = []
  for (const e of cands) {
    const r = drawLine(board, e, side)
    const now = r.completed.length
    const next: Side = now ? side : other
    let total = 0
    for (let k = 0; k < runs; k++) total += playout(r.board, next, side, 7919 * (k + 1) + e * 31)
    const v = now + total / runs
    if (v > best + 1e-9) {
      best = v
      ties = [e]
    } else if (Math.abs(v - best) <= 1e-9) ties.push(e)
  }
  return ties.length ? rng.pick(ties) : undefined
}

// ---------- the endgame: chains and cycles ----------

/** A region still to play out once every line gives something away: a chain or a cycle of boxes. */
export interface Region {
  len: number
  cycle: boolean
}

/**
 * Split the open boxes into chains (ends at the board's edge or at a drawn-in
 * dead end) and cycles. Null when the position is not a plain chains-and-cycles
 * endgame (a box with three or four open sides: a junction).
 */
export function regions(b: Board, approx = false): Region[] | null {
  const open: boolean[] = []
  for (let box = 0; box < BOX_COUNT; box++) {
    if (b.boxes[box] !== null) {
      open.push(false)
      continue
    }
    const free = boxEdges(box).filter((e) => b.lines[e] === null).length
    // A junction (three or four open sides): exact play is out of reach; `approx`
    // treats its whole component as one chain, which keeps the count of long chains.
    if (free !== 2 && !approx) return null
    open.push(true)
  }
  const seen = Array<boolean>(BOX_COUNT).fill(false)
  const out: Region[] = []
  const neighbours = (box: number): number[] => {
    const n: number[] = []
    for (const e of boxEdges(box)) {
      if (b.lines[e] !== null) continue
      for (const o of boxesOf(e)) if (o !== box && open[o]) n.push(o)
    }
    return n
  }
  for (let start = 0; start < BOX_COUNT; start++) {
    if (!open[start] || seen[start]) continue
    // Flood the component, and count its ends (boxes with fewer than two open neighbours).
    const stack = [start]
    seen[start] = true
    let len = 0
    let ends = 0
    while (stack.length) {
      const box = stack.pop() as number
      len++
      const n = neighbours(box)
      if (n.length < 2) ends++
      for (const o of n) {
        if (seen[o]) continue
        seen[o] = true
        stack.push(o)
      }
    }
    out.push({ len, cycle: ends === 0 })
  }
  return out
}

const memo = new Map<string, number>()

const keyOf = (rs: readonly Region[]): string =>
  rs
    .map((r) => (r.cycle ? `c${r.len}` : `${r.len}`))
    .sort()
    .join(',')

/**
 * Net boxes (own minus rival's) still to come for the player who must open the
 * next region, both sides playing perfectly. The receiver of an opened region
 * either takes it all and must open the next, or (a chain of three or more, a
 * cycle of four or more) takes all but two (four) and leaves the rest to the
 * opener, keeping control.
 */
export function controlValue(rs: readonly Region[]): number {
  if (rs.length === 0) return 0
  const key = keyOf(rs)
  const hit = memo.get(key)
  if (hit !== undefined) return hit
  let worst = Infinity
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i] as Region
    const rest = rs.filter((_, k) => k !== i)
    const g = controlValue(rest)
    let receiver = r.len + g
    if (r.cycle && r.len >= 4) receiver = Math.max(receiver, r.len - 8 - g)
    else if (!r.cycle && r.len >= 3) receiver = Math.max(receiver, r.len - 4 - g)
    worst = Math.min(worst, receiver)
  }
  const v = worst === 0 ? 0 : -worst
  memo.set(key, v)
  return v
}

/** The board once every box on offer has been taken (who takes them does not matter here). */
function afterTaking(b: Board): Board {
  let cur = b
  for (;;) {
    const w = waiting(cur)
    if (!w.length) return cur
    cur = drawLine(cur, (w[0] as { missing: number }).missing, 0).board
  }
}

/**
 * Endgame control: with no safe line left and exactly two boxes on offer at the
 * end of a chain, decline them with a double-cross when keeping control is
 * worth more than the two boxes (never on the last chain: there is nothing left
 * to control).
 */
function control(board: Board, side: Side, legal: readonly number[]): number | undefined {
  if (legal.some((e) => !completes(board, e) && !givesBox(board, e))) return undefined
  if (takeAll(board) !== 2) return undefined
  const deal = legal.find((e) => doubleDealsAfter(board, e, side))
  if (deal === undefined) return undefined
  const rest = regions(afterTaking(board))
  if (rest === null) {
    // Not a clean endgame: decline only if plenty of boxes are still to come.
    const open = board.boxes.filter((o) => o === null).length - 2
    return open > 4 ? deal : undefined
  }
  const g = controlValue(rest)
  // Take both and open next (2 + g), or give both and make the rival open (-2 - g).
  return -2 - g > 2 + g ? deal : undefined
}

/** The line that gives the rival the fewest boxes. Hard avoids handing out a chain it can decline. */
function sacrifice(
  board: Board,
  side: Side,
  legal: readonly number[],
  hard: boolean,
  rng: Rng,
): number {
  let best = Infinity
  let ties: number[] = []
  for (const e of legal) {
    const after = drawLine(board, e, side).board
    let cost = takeAll(after)
    if (hard && cost >= 2) {
      const w = waiting(after)
      if (w.length === 2 && w[0]?.missing === w[1]?.missing) cost += 0.5
    }
    if (cost < best) {
      best = cost
      ties = [e]
    } else if (cost === best) ties.push(e)
  }
  return rng.pick(ties.length ? ties : legal)
}
