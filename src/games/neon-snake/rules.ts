import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Neon Snake, pure rules. Two snakes share one grid. Each tick both move one
 * cell in the direction their player last asked for. Eating a dot grows the
 * snake by one. Running into any body or wall ends it; if both heads reach the
 * same cell the round is a draw. Nothing here draws or touches the browser.
 */

export const COLS = 18
export const ROWS = 28
export const CELL = 50
/** Top-left of the grid in world units (centred; the pills sit above and below). */
export const X0 = (1000 - COLS * CELL) / 2
export const Y0 = 200
/** Seconds between two moves of every snake. */
export const TICK = 0.13
/** Countdown before a round starts moving (s). */
export const COUNT = 2.4
/** Dots on the board at any time. */
export const DOTS = 3

/**
 * Wall blocks on both side edges at mid-height (rows BLOCK_Y0..BLOCK_Y1 of the
 * first and last column): the left one sits under the pause button, the right
 * one mirrors it. They count as outside the board.
 */
export const BLOCK_Y0 = 12
export const BLOCK_Y1 = 15

/** Directions: 0 north, 1 east, 2 south, 3 west. */
export const DX = [0, 1, 0, -1] as const
export const DY = [-1, 0, 1, 0] as const

export interface Cell {
  x: number
  y: number
}

export interface Snake {
  side: Side
  /** Head first. */
  body: Cell[]
  /** Direction the snake is moving in. */
  dir: number
  /** Direction its player asked for; applied on the next tick. */
  want: number
  alive: boolean
  /** Time it crashed (s), -1 while alive. */
  diedT: number
  /** Dots eaten. */
  eaten: number
}

export interface Board {
  snakes: [Snake, Snake]
  dots: Cell[]
  /** Seconds since the last tick, for drawing. */
  acc: number
  /** Time the snakes start moving (s). */
  go: number
}

export type Ev =
  { k: 'eat'; side: Side; x: number; y: number } | { k: 'crash'; side: Side; x: number; y: number }

export function cellCentre(c: Cell): { x: number; y: number } {
  return { x: X0 + (c.x + 0.5) * CELL, y: Y0 + (c.y + 0.5) * CELL }
}

/** The direction (0..3) a stick or swipe vector points to, favouring the dominant axis. */
export function dirOf(x: number, y: number): number {
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 1 : 3
  return y > 0 ? 2 : 0
}

export function inside(c: Cell): boolean {
  if (c.x < 0 || c.y < 0 || c.x >= COLS || c.y >= ROWS) return false
  return !((c.x === 0 || c.x === COLS - 1) && c.y >= BLOCK_Y0 && c.y <= BLOCK_Y1)
}

/** Every cell a snake body or a dot occupies (heads included). */
export function occupied(b: Board, x: number, y: number): boolean {
  for (const s of b.snakes) for (const c of s.body) if (c.x === x && c.y === y) return true
  return false
}

/** A cell a head may enter: on the board and not under a body. Dots are fine. */
export function passable(b: Board, x: number, y: number): boolean {
  return inside({ x, y }) && !occupied(b, x, y)
}

export function newBoard(now: number, rng: Rng): Board {
  const mk = (side: Side, x: number, y: number, dir: number): Snake => {
    const back = (dir + 2) % 4
    const body = [0, 1, 2].map((i) => ({
      x: x + (DX[back] ?? 0) * i,
      y: y + (DY[back] ?? 0) * i,
    }))
    return { side, body, dir, want: dir, alive: true, diedT: -1, eaten: 0 }
  }
  const b: Board = {
    snakes: [mk(0, 9, ROWS - 6, 0), mk(1, COLS - 1 - 9, ROWS - 1 - (ROWS - 6), 2)],
    dots: [],
    acc: 0,
    go: now + COUNT,
  }
  for (let i = 0; i < DOTS; i++) spawnDot(b, rng)
  return b
}

/** Put a dot on a random free cell. */
export function spawnDot(b: Board, rng: Rng): void {
  for (let tries = 0; tries < 400; tries++) {
    const x = rng.int(0, COLS - 1)
    const y = rng.int(0, ROWS - 1)
    if (passable(b, x, y) && !b.dots.some((d) => d.x === x && d.y === y)) {
      b.dots.push({ x, y })
      return
    }
  }
}

/** Ask for a direction. A reversal (straight back into the body) is ignored. */
export function want(s: Snake, d: number): void {
  if (!s.alive) return
  if (d === (s.dir + 2) % 4) return
  s.want = d
}

/**
 * Advance one tick: apply each snake's wanted direction, then move the heads.
 * A head that leaves the board or enters any body crashes; two heads on the
 * same cell both crash. Returns the side still standing: 'draw' when nobody is,
 * null while the round goes on.
 */
export function tick(b: Board, now: number, ev: Ev[], rng: Rng): Side | 'draw' | null {
  for (const s of b.snakes) {
    if (!s.alive) continue
    if (s.want !== (s.dir + 2) % 4) s.dir = s.want
  }
  const heads = b.snakes.map((s) => {
    const h = s.body[0] ?? { x: 0, y: 0 }
    return { x: h.x + (DX[s.dir] ?? 0), y: h.y + (DY[s.dir] ?? 0) }
  })
  const die = new Set<number>()
  b.snakes.forEach((s, i) => {
    if (!s.alive) return
    const h = heads[i] ?? { x: 0, y: 0 }
    if (!inside(h) || occupied(b, h.x, h.y)) die.add(i)
  })
  const [h0, h1] = heads
  if (b.snakes[0].alive && b.snakes[1].alive && h0 && h1 && h0.x === h1.x && h0.y === h1.y) {
    die.add(0)
    die.add(1)
  }
  b.snakes.forEach((s, i) => {
    if (!s.alive) return
    const h = heads[i] ?? { x: 0, y: 0 }
    if (die.has(i)) {
      s.alive = false
      s.diedT = now
      const c = cellCentre(h)
      ev.push({ k: 'crash', side: s.side, x: c.x, y: c.y })
      return
    }
    s.body.unshift(h)
    const di = b.dots.findIndex((d) => d.x === h.x && d.y === h.y)
    if (di >= 0) {
      b.dots.splice(di, 1)
      s.eaten++
      const c = cellCentre(h)
      ev.push({ k: 'eat', side: s.side, x: c.x, y: c.y })
      spawnDot(b, rng)
    } else s.body.pop()
  })
  return roundWinner(b)
}

/** The side still moving: 'draw' when both crashed, null while both are alive. */
export function roundWinner(b: Board): Side | 'draw' | null {
  const [a, c] = b.snakes
  if (a.alive && c.alive) return null
  if (!a.alive && !c.alive) return 'draw'
  return a.alive ? 0 : 1
}

/** Free cells reachable from (x, y) (counted up to `cap`). */
export function room(b: Board, x: number, y: number, cap = 200): number {
  if (!passable(b, x, y)) return 0
  const seen = new Set<number>([y * COLS + x])
  const q: Cell[] = [{ x, y }]
  for (let qi = 0; qi < q.length && q.length < cap; qi++) {
    const cur = q[qi] as Cell
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + (DX[d] ?? 0)
      const ny = cur.y + (DY[d] ?? 0)
      if (!passable(b, nx, ny) || seen.has(ny * COLS + nx)) continue
      seen.add(ny * COLS + nx)
      q.push({ x: nx, y: ny })
    }
  }
  return Math.min(q.length, cap)
}

/** Steps from (x, y) to the nearest dot over free cells, or -1 when none is reachable. */
export function foodDistance(b: Board, x: number, y: number): number {
  if (b.dots.some((d) => d.x === x && d.y === y)) return 0
  const seen = new Set<number>([y * COLS + x])
  let frontier: Cell[] = [{ x, y }]
  for (let steps = 1; frontier.length; steps++) {
    const next: Cell[] = []
    for (const cur of frontier) {
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + (DX[d] ?? 0)
        const ny = cur.y + (DY[d] ?? 0)
        if (!inside({ x: nx, y: ny }) || seen.has(ny * COLS + nx)) continue
        seen.add(ny * COLS + nx)
        if (b.dots.some((k) => k.x === nx && k.y === ny)) return steps
        if (occupied(b, nx, ny)) continue
        next.push({ x: nx, y: ny })
      }
    }
    frontier = next
  }
  return -1
}
