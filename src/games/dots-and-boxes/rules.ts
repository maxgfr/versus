import type { Side } from '../../core/game.ts'

/** Pure rules: no rendering, no timing, no randomness. Everything here is unit-tested. */

/** Dots per row and per column. */
export const DOTS = 6
/** Boxes per row and per column. */
export const BOXES = DOTS - 1
/** Horizontal lines come first (30), then vertical (30). */
export const EDGES = 2 * DOTS * BOXES
export const BOX_COUNT = BOXES * BOXES
const H_COUNT = DOTS * BOXES

export type Owner = Side | null
export interface Board {
  /** Owner of each drawn line (null = not yet drawn). Indexed by edge. */
  lines: Owner[]
  /** Owner of each completed box. Indexed by box (`row * BOXES + col`). */
  boxes: Owner[]
}

export function emptyBoard(): Board {
  return { lines: Array<Owner>(EDGES).fill(null), boxes: Array<Owner>(BOX_COUNT).fill(null) }
}

/** Horizontal line from dot (r, c) to (r, c + 1): index `r * BOXES + c`. */
export const hLine = (r: number, c: number): number => r * BOXES + c
/** Vertical line from dot (r, c) to (r + 1, c): index `H_COUNT + r * DOTS + c`. */
export const vLine = (r: number, c: number): number => H_COUNT + r * DOTS + c

export function isHorizontal(e: number): boolean {
  return e < H_COUNT
}

/** The two dots a line joins, as [row, col] pairs. */
export function lineEnds(e: number): [[number, number], [number, number]] {
  if (isHorizontal(e)) {
    const r = Math.floor(e / BOXES)
    const c = e % BOXES
    return [
      [r, c],
      [r, c + 1],
    ]
  }
  const k = e - H_COUNT
  const r = Math.floor(k / DOTS)
  const c = k % DOTS
  return [
    [r, c],
    [r + 1, c],
  ]
}

/** The boxes a line borders (one or two). */
export function boxesOf(e: number): number[] {
  const out: number[] = []
  if (isHorizontal(e)) {
    const r = Math.floor(e / BOXES)
    const c = e % BOXES
    if (r >= 1) out.push((r - 1) * BOXES + c)
    if (r < BOXES) out.push(r * BOXES + c)
  } else {
    const k = e - H_COUNT
    const r = Math.floor(k / DOTS)
    const c = k % DOTS
    if (c >= 1) out.push(r * BOXES + c - 1)
    if (c < BOXES) out.push(r * BOXES + c)
  }
  return out
}

/** The four lines around a box: top, bottom, left, right. */
export function boxEdges(box: number): [number, number, number, number] {
  const r = Math.floor(box / BOXES)
  const c = box % BOXES
  return [hLine(r, c), hLine(r + 1, c), vLine(r, c), vLine(r, c + 1)]
}

export function drawnSides(b: Board, box: number): number {
  return boxEdges(box).filter((e) => b.lines[e] !== null).length
}

/** Lines not yet drawn. */
export function legalLines(b: Board): number[] {
  const out: number[] = []
  for (let e = 0; e < EDGES; e++) if (b.lines[e] === null) out.push(e)
  return out
}

/** Would drawing `e` complete at least one box? */
export function completes(b: Board, e: number): boolean {
  return boxesOf(e).some((box) => b.boxes[box] === null && drawnSides(b, box) === 3)
}

/** Would drawing `e` leave a box with three sides, handing the rival a box? */
export function givesBox(b: Board, e: number): boolean {
  return boxesOf(e).some((box) => b.boxes[box] === null && drawnSides(b, box) === 2)
}

/** Draw line `e` for `side`. Completed boxes take `side`'s colour. Throws if the line is already drawn. */
export function drawLine(b: Board, e: number, side: Side): { board: Board; completed: number[] } {
  if (b.lines[e] !== null) throw new Error(`Line ${e} is already drawn`)
  const lines = b.lines.slice()
  lines[e] = side
  const boxes = b.boxes.slice()
  const next: Board = { lines, boxes }
  const completed: number[] = []
  for (const box of boxesOf(e)) {
    if (boxes[box] === null && drawnSides(next, box) === 4) {
      boxes[box] = side
      completed.push(box)
    }
  }
  return { board: next, completed }
}

export function countBoxes(b: Board): [number, number] {
  let red = 0
  let blue = 0
  for (const o of b.boxes) {
    if (o === 0) red++
    else if (o === 1) blue++
  }
  return [red, blue]
}

export type Outcome = { winner: Side | 'draw'; counts: [number, number] } | null

/** Over when every line is drawn. Most boxes wins. */
export function outcome(b: Board): Outcome {
  if (b.lines.some((o) => o === null)) return null
  const counts = countBoxes(b)
  const winner: Side | 'draw' = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : 'draw'
  return { winner, counts }
}

/**
 * How many boxes a rival collects by taking every box that can be taken, one
 * after another (each take may open the next). Used by the computer to weigh a
 * sacrifice.
 */
export function takeAll(b: Board): number {
  const lines = b.lines.slice()
  const taken = Array<boolean>(BOX_COUNT).fill(false)
  let total = 0
  let again = true
  while (again) {
    again = false
    for (let box = 0; box < BOX_COUNT; box++) {
      if (b.boxes[box] !== null || taken[box]) continue
      const missing = boxEdges(box).filter((e) => lines[e] === null)
      if (missing.length !== 1) continue
      // Draw the last side (the owner does not matter here, only that it is no longer open).
      lines[missing[0] as number] = 0
      taken[box] = true
      total++
      again = true
    }
  }
  return total
}

/** Boxes with three sides drawn, still open, and the one line each is waiting on. */
export function waiting(b: Board): { box: number; missing: number }[] {
  const out: { box: number; missing: number }[] = []
  for (let box = 0; box < BOX_COUNT; box++) {
    if (b.boxes[box] !== null || drawnSides(b, box) !== 3) continue
    const missing = boxEdges(box).find((e) => b.lines[e] === null)
    if (missing !== undefined) out.push({ box, missing })
  }
  return out
}

/**
 * A "double-cross" move: draws `e` without completing a box, leaving exactly
 * two boxes that both wait on one shared line. The rival takes both with that
 * single line and must move again, which is how a player keeps control of a chain.
 */
export function doubleDealsAfter(b: Board, e: number, side: Side): boolean {
  if (completes(b, e)) return false
  const w = waiting(drawLine(b, e, side).board)
  return w.length === 2 && w[0]?.missing === w[1]?.missing
}
