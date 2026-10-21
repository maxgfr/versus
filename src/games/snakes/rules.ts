import type { Side } from '../../core/game.ts'

/**
 * Snakes (light-trail duel), pure rules. Each bike rides a grid of cells and
 * leaves a solid trail behind it. Every TICK seconds each bike moves one cell
 * forward; a turn button queues a 90° turn that takes effect on the next tick.
 * Any trail, any wall, or the other bike's head ends the bike. The last side
 * with a bike still riding wins the round.
 *
 * Nothing here draws or uses randomness: the online guest only renders the
 * board the host sends.
 */

export const COLS = 24
export const ROWS = 30
export const CELL = 40
/** Top-left of the board in world units (centred horizontally, strips above and below). */
export const X0 = (1000 - COLS * CELL) / 2
export const Y0 = 300
/** Seconds between two moves of every bike. */
export const TICK = 0.125
/** Countdown before the bikes start riding in each round (s). */
export const COUNT = 2.4
/** A bike can queue this many turns ahead. */
export const QUEUE = 2

/** Cell value of a fixed wall block (bikes use their id + 1). */
export const WALL = 255

/**
 * Wall blocks at mid-height on both side edges: the left one fills the cells
 * under the pause button, the right one mirrors it so the board stays fair.
 */
export const BLOCKS: readonly { x: number; y: number }[] = [0, 1].flatMap((x) =>
  [13, 14, 15, 16, 17].flatMap((y) => [
    { x, y },
    { x: COLS - 1 - x, y: ROWS - 1 - y },
  ]),
)

/** Headings: 0 north, 1 east, 2 south, 3 west. A turn of +1 is a right turn, -1 a left. */
export const DX = [0, 1, 0, -1] as const
export const DY = [-1, 0, 1, 0] as const

export interface Bike {
  id: number
  side: Side
  /** 2 vs 2: which of the side's two bikes (0 = red-frame left). */
  lane: 0 | 1
  /** Cell of the head. */
  x: number
  y: number
  dir: number
  /** Turns waiting for the next ticks: +1 right, -1 left. */
  q: number[]
  alive: boolean
  /** Time it crashed (s), -1 while riding. */
  diedT: number
}

export interface Board {
  /** Per cell: 0 free, otherwise bike id + 1 (heads included). Row-major. */
  cells: number[]
  bikes: Bike[]
  /** Seconds since the bikes last moved, 0..TICK (for the drawing). */
  acc: number
  /** Time when the bikes start riding (s). */
  go: number
}

export type Ev =
  { k: 'turn'; side: Side; x: number; y: number } | { k: 'crash'; side: Side; x: number; y: number }

/** A red-frame cell (as red sees the board) → the board cell for `side`. */
export function frameCell(side: Side, x: number, y: number): { x: number; y: number } {
  return side === 0 ? { x, y } : { x: COLS - 1 - x, y: ROWS - 1 - y }
}

export function cellCentre(x: number, y: number): { x: number; y: number } {
  return { x: X0 + (x + 0.5) * CELL, y: Y0 + (y + 0.5) * CELL }
}

/** Spawns in red's frame: [lane 0, lane 1]; blue mirrors them through the board's centre. */
function spawns(teams: boolean): { side: Side; lane: 0 | 1; x: number; y: number; dir: number }[] {
  const red: { lane: 0 | 1; x: number; y: number }[] = teams
    ? [
        // Off the rival lanes' columns, so no two bikes start nose to nose.
        { lane: 0, x: 4, y: ROWS - 5 },
        { lane: 1, x: COLS - 8, y: ROWS - 5 },
      ]
    : [{ lane: 0, x: 8, y: ROWS - 5 }]
  const out: { side: Side; lane: 0 | 1; x: number; y: number; dir: number }[] = []
  for (const s of red) out.push({ side: 0, lane: s.lane, x: s.x, y: s.y, dir: 0 })
  for (const s of red) {
    const c = frameCell(1, s.x, s.y)
    out.push({ side: 1, lane: s.lane, x: c.x, y: c.y, dir: 2 })
  }
  return out
}

export function newBoard(teams: boolean, now: number): Board {
  const cells = Array.from({ length: COLS * ROWS }, () => 0)
  for (const c of BLOCKS) cells[c.y * COLS + c.x] = WALL
  const bikes: Bike[] = spawns(teams).map((s, id) => {
    cells[s.y * COLS + s.x] = id + 1
    return {
      id,
      side: s.side,
      lane: s.lane,
      x: s.x,
      y: s.y,
      dir: s.dir,
      q: [],
      alive: true,
      diedT: -1,
    }
  })
  return { cells, bikes, acc: 0, go: now + COUNT }
}

/** Queue a turn for a bike (+1 right, -1 left); ignored when the queue is full. */
export function queueTurn(k: Bike, turn: 1 | -1): void {
  if (k.alive && k.q.length < QUEUE) k.q.push(turn)
}

export function free(b: Board, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return false
  return b.cells[y * COLS + x] === 0
}

/**
 * Cells reachable from (x, y) through free cells, counted up to `cap`. The cell
 * `block` (an index, or -1) counts as taken: use it for a cell that is about to
 * become a trail.
 */
export function floodFrom(b: Board, x: number, y: number, cap = 300, block = -1): number {
  if (!free(b, x, y) || y * COLS + x === block) return 0
  const seen = new Uint8Array(COLS * ROWS)
  const q: number[] = [y * COLS + x]
  seen[y * COLS + x] = 1
  for (let qi = 0; qi < q.length && q.length < cap; qi++) {
    const cur = q[qi] ?? 0
    const cx = cur % COLS
    const cy = Math.floor(cur / COLS)
    for (let d = 0; d < 4; d++) {
      const nx = cx + (DX[d] ?? 0)
      const ny = cy + (DY[d] ?? 0)
      if (!free(b, nx, ny)) continue
      const ni = ny * COLS + nx
      if (seen[ni] || ni === block) continue
      seen[ni] = 1
      q.push(ni)
    }
  }
  return Math.min(q.length, cap)
}

/** The side still riding: 'draw' when none is, null while both sides have a bike left. */
export function roundWinner(b: Board): Side | 'draw' | null {
  const red = b.bikes.some((k) => k.side === 0 && k.alive)
  const blue = b.bikes.some((k) => k.side === 1 && k.alive)
  if (red && blue) return null
  if (red) return 0
  if (blue) return 1
  return 'draw'
}

/**
 * Advance every bike one cell: apply each bike's next queued turn, then move
 * (or crash). Two bikes entering the same cell both crash, and so does a bike
 * that runs into any trail, wall or head. Events are appended to `ev`.
 */
export function tick(b: Board, now: number, ev: Ev[]): Side | 'draw' | null {
  for (const k of b.bikes) {
    if (!k.alive) continue
    const t = k.q.shift()
    if (t === undefined) continue
    k.dir = (k.dir + t + 4) % 4
    const c = cellCentre(k.x, k.y)
    ev.push({ k: 'turn', side: k.side, x: c.x, y: c.y })
  }
  const crash = new Set<number>()
  const target = new Map<number, number>()
  for (const k of b.bikes) {
    if (!k.alive) continue
    const nx = k.x + (DX[k.dir] ?? 0)
    const ny = k.y + (DY[k.dir] ?? 0)
    if (!free(b, nx, ny)) {
      crash.add(k.id)
      continue
    }
    const idx = ny * COLS + nx
    const other = target.get(idx)
    if (other !== undefined) {
      crash.add(k.id)
      crash.add(other)
    } else target.set(idx, k.id)
  }
  for (const k of b.bikes) {
    if (!k.alive) continue
    if (crash.has(k.id)) {
      k.alive = false
      k.diedT = now
      const c = cellCentre(k.x, k.y)
      const dx = (DX[k.dir] ?? 0) * (CELL / 2)
      const dy = (DY[k.dir] ?? 0) * (CELL / 2)
      ev.push({ k: 'crash', side: k.side, x: c.x + dx, y: c.y + dy })
      continue
    }
    k.x += DX[k.dir] ?? 0
    k.y += DY[k.dir] ?? 0
    b.cells[k.y * COLS + k.x] = k.id + 1
  }
  return roundWinner(b)
}
