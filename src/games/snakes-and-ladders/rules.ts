/**
 * Snakes & Ladders rules: a 10 × 10 track numbered 1–100 in boustrophedon
 * order, six ladders and six snakes generated from a fixed seed (the same
 * board on every device, every game), and an exact landing on 100. Pure
 * logic, unit-tested.
 */
import { Rng } from '../../core/rng.ts'

export const GOAL = 100

/** A ladder (`to` > `from`) or a snake (`to` < `from`). */
export interface Link {
  from: number
  to: number
}

export interface Board {
  ladders: Link[]
  snakes: Link[]
}

/** Seed of the board every game plays on. */
export const BOARD_SEED = 0x5a4e11

/** Row of square `n` counted from the bottom, 0..9 (square 1 is bottom-left). */
export const rowOf = (n: number): number => Math.floor((n - 1) / 10)

/** Column of square `n`, 0..9 from the left: row 1 runs right to left, and so on. */
export function colOf(n: number): number {
  const c = (n - 1) % 10
  return rowOf(n) % 2 === 0 ? c : 9 - c
}

/** Centre of square `n` in cell units (x right, y up), for spacing links apart. */
function cellPos(n: number): { x: number; y: number } {
  return { x: colOf(n), y: rowOf(n) }
}

/** Distance from point `p` to the segment a–b. */
function pointSeg(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** True when the segments a–b and c–d cross. */
function crosses(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const o = (p: typeof a, q: typeof a, r: typeof a) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
}

/** Closest approach of two links drawn as straight lines, in cells (0 when they cross). */
export function gap(l: Link, m: Link): number {
  const a = cellPos(l.from)
  const b = cellPos(l.to)
  const c = cellPos(m.from)
  const d = cellPos(m.to)
  if (crosses(a, b, c, d)) return 0
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b))
}

/** Links keep at least this far apart (cells), so every snake and ladder reads on its own. */
export const MIN_GAP = 0.9

/**
 * Six ladders and six snakes, placed by a seeded generator. Every start and
 * end square is distinct, so no link ever chains into another one; each link
 * crosses two to six rows, leans at most four columns, and stays clear of the
 * others (no crossings, at least `MIN_GAP` cells apart) so the board reads.
 */
export function makeBoard(seed: number = BOARD_SEED): Board {
  const rng = new Rng(seed)
  const taken = new Set<number>([1, GOAL])
  const ladders: Link[] = []
  const snakes: Link[] = []
  const fits = (l: Link): boolean => {
    const rows = Math.abs(rowOf(l.to) - rowOf(l.from))
    if (rows < 2 || rows > 6) return false
    if (Math.abs(colOf(l.to) - colOf(l.from)) > 4) return false
    if (taken.has(l.from) || taken.has(l.to)) return false
    return [...ladders, ...snakes].every((m) => gap(l, m) >= MIN_GAP)
  }
  let guard = 0
  while ((ladders.length < 6 || snakes.length < 6) && guard++ < 20000) {
    // Alternate so ladders and snakes share the board fairly.
    const ladder = ladders.length < 6 && (snakes.length >= 6 || guard % 2 === 0)
    const l: Link = ladder
      ? (() => {
          const from = rng.int(2, 80)
          return { from, to: from + rng.int(14, 50) }
        })()
      : (() => {
          const from = rng.int(22, 99)
          return { from, to: from - rng.int(14, 55) }
        })()
    if (l.to < 2 || l.to >= GOAL || l.from >= GOAL || !fits(l)) continue
    taken.add(l.from)
    taken.add(l.to)
    ;(ladder ? ladders : snakes).push(l)
  }
  return { ladders, snakes }
}

/** The link that starts on square `n`, if any. */
export function linkAt(b: Board, n: number): Link | undefined {
  return b.ladders.find((l) => l.from === n) ?? b.snakes.find((s) => s.from === n)
}

export interface Move {
  /** Squares the token passes over, one per die pip, ending on the square it stops on. */
  path: number[]
  /** Where the token finally rests, after any ladder or snake. */
  to: number
  /** The link it climbed or slid down, if it landed on one. */
  link: Link | undefined
}

/**
 * A token on `pos` (0 = off the board) rolls `roll`. It moves square by square;
 * past 100 it bounces back by the excess, so 100 needs an exact roll. Only the
 * square it stops on can carry a ladder or snake.
 */
export function move(pos: number, roll: number, board: Board): Move {
  const path: number[] = []
  let cur = pos
  let dir = 1
  for (let i = 0; i < roll; i++) {
    cur += dir
    if (cur === GOAL) dir = -1
    path.push(cur)
  }
  const link = linkAt(board, cur)
  return { path, to: link ? link.to : cur, link }
}

/** True when a token resting on `pos` has finished. */
export const finished = (pos: number): boolean => pos === GOAL
