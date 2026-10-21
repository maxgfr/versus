import { other, type Side } from '../../core/game.ts'

/**
 * Pure rules for Color Wars: a 5 × 5 grid. A side's first move claims any empty
 * cell with three dots. Every later move adds a dot to one of its own cells. A
 * cell that reaches four dots bursts: its dots leave it and one goes to each
 * orthogonal neighbour, converting that neighbour to the bursting side. Bursts
 * chain. Once both sides have moved, a side with no cells has lost.
 */

export const SIZE = 5
export const CELLS = SIZE * SIZE
/** Dots that make a cell burst. */
export const BURST = 4
/** Dots a first move claims a cell with. */
export const CLAIM = 3

export interface Position {
  /** Side to move. */
  turn: Side
  /** Owner of each cell, null when empty. */
  owner: (Side | null)[]
  /** Dots in each cell. */
  dots: number[]
  /** Whether each side has made its first (claiming) move. */
  moved: [boolean, boolean]
}

export function emptyPosition(turn: Side): Position {
  return {
    turn,
    owner: Array<Side | null>(CELLS).fill(null),
    dots: Array<number>(CELLS).fill(0),
    moved: [false, false],
  }
}

/** Orthogonal neighbours of cell `i`. */
export function neighbours(i: number): number[] {
  const r = Math.floor(i / SIZE)
  const c = i % SIZE
  const out: number[] = []
  if (r > 0) out.push(i - SIZE)
  if (r < SIZE - 1) out.push(i + SIZE)
  if (c > 0) out.push(i - 1)
  if (c < SIZE - 1) out.push(i + 1)
  return out
}

export function cellsOf(p: Position, side: Side): number {
  let n = 0
  for (const o of p.owner) if (o === side) n++
  return n
}

/** Cells `side` may tap now: any empty cell for a first move, else its own cells. */
export function legalCells(p: Position, side: Side = p.turn): number[] {
  const claim = !p.moved[side]
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) {
    const o = p.owner[i] ?? null
    if (claim ? o === null : o === side) out.push(i)
  }
  return out
}

/** The winner once both sides have moved and one of them has no cells left. */
export function winner(p: Position): Side | null {
  if (!(p.moved[0] && p.moved[1])) return null
  if (cellsOf(p, 0) === 0) return 1
  if (cellsOf(p, 1) === 0) return 0
  return null
}

/**
 * Make the move for the side to move: claim an empty cell, or add a dot to one
 * of its own cells. Bursts are not resolved here; `unstable` and `burst` do that.
 * The turn passes to the rival straight away.
 */
export function apply(p: Position, cell: number): Position {
  const side = p.turn
  if (!legalCells(p, side).includes(cell)) throw new Error(`Cell ${cell} is not legal`)
  const owner = p.owner.slice()
  const dots = p.dots.slice()
  if (!p.moved[side]) {
    owner[cell] = side
    dots[cell] = CLAIM
  } else {
    dots[cell] = (dots[cell] ?? 0) + 1
  }
  const moved: [boolean, boolean] = [p.moved[0], p.moved[1]]
  moved[side] = true
  return { turn: other(side), owner, dots, moved }
}

/** Cells that hold enough dots to burst right now. */
export function unstable(p: Position): number[] {
  const out: number[] = []
  for (let i = 0; i < CELLS; i++) if ((p.dots[i] ?? 0) >= BURST) out.push(i)
  return out
}

/**
 * One wave: each listed cell that still holds `BURST` dots bursts, leaving
 * itself empty and giving one dot and its colour to each neighbour.
 */
export function burst(p: Position, cells: readonly number[]): Position {
  const owner = p.owner.slice()
  const dots = p.dots.slice()
  for (const c of cells) {
    const side = owner[c] ?? null
    if (side === null || (dots[c] ?? 0) < BURST) continue
    dots[c] = 0
    owner[c] = null
    for (const n of neighbours(c)) {
      dots[n] = (dots[n] ?? 0) + 1
      owner[n] = side
    }
  }
  return { ...p, owner, dots }
}

/** Resolve every chain reaction at once. Stops early once a side is eliminated. */
export function settle(p: Position): Position {
  let q = p
  for (let wave = 0; wave < 500 && winner(q) === null; wave++) {
    const u = unstable(q)
    if (u.length === 0) break
    q = burst(q, u)
  }
  return q
}

/**
 * Static score for `side`: its cells minus the rival's, with a small bonus for
 * cells one dot away from bursting. A finished game is ±1000.
 */
export function evaluate(p: Position, side: Side): number {
  const w = winner(p)
  if (w !== null) return w === side ? 1000 : -1000
  const rival = other(side)
  let v = 0
  for (let i = 0; i < CELLS; i++) {
    const o = p.owner[i] ?? null
    if (o === null) continue
    const near = (p.dots[i] ?? 0) === BURST - 1 ? 0.5 : 0
    if (o === side) v += 1 + near
    else if (o === rival) v -= 1 + near
  }
  return v
}
