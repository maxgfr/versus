import type { Rng } from '../../core/rng.ts'

/**
 * Roll-to-paint mazes, pure logic. A ball rolls in one of four directions until
 * the next tile is a wall or the edge, painting every tile it passes. A level is
 * cleared once every floor tile is painted.
 *
 * Levels are carved by simulating rolls from a start tile. Each carved roll
 * stops against a wall that is never removed afterwards, so the recorded roll
 * sequence is a solution by construction (`solution`, checked in the tests).
 * Nothing here reads the screen or `Math.random`.
 */

/** Directions: 0 up, 1 right, 2 down, 3 left, in the player's own frame. */
export const DX = [0, 1, 0, -1]
export const DY = [-1, 0, 1, 0]
/** One maze per level, small to large. */
export const LEVEL_SIZES = [5, 6, 7]

export interface Level {
  n: number
  /** 1 = wall, 0 = floor; row-major, n * n entries. */
  walls: number[]
  start: number
  /** Floor tiles, start included. */
  floors: number
  /** Directions of a roll sequence from `start` that paints every floor tile. */
  solution: number[]
}

const FLOOR = 0
const WALL = 1
const UNKNOWN = 2

/** The tile next to `i` in direction `d`, or -1 past the edge. */
export function neighbour(n: number, i: number, d: number): number {
  const r = Math.floor(i / n) + (DY[d] ?? 0)
  const c = (i % n) + (DX[d] ?? 0)
  if (r < 0 || c < 0 || r >= n || c >= n) return -1
  return r * n + c
}

/**
 * Where a roll from `pos` in direction `d` comes to rest, and the tiles it
 * enters on the way (the resting tile last). No move when `path` is empty.
 */
export function roll(
  level: { n: number; walls: readonly number[] },
  pos: number,
  d: number,
): { end: number; path: number[] } {
  const path: number[] = []
  let cur = pos
  for (;;) {
    const nx = neighbour(level.n, cur, d)
    if (nx < 0 || level.walls[nx] === 1) break
    path.push(nx)
    cur = nx
  }
  return { end: cur, path }
}

/** Painted tiles at the start of a level: just the start tile. */
export function startPaint(level: Pick<Level, 'n' | 'start'>): number[] {
  return Array.from({ length: level.n * level.n }, (_, i) => (i === level.start ? 1 : 0))
}

export function countPainted(painted: readonly number[]): number {
  let k = 0
  for (const v of painted) k += v
  return k
}

interface Launch {
  from: number
  at: number
  d: number
}

/**
 * Rest tiles a ball can reach from `pos` by rolls over carved floor (each one
 * ending against a permanent wall), and the launches that carve new floor.
 */
function explore(
  n: number,
  st: number[],
  pos: number,
): { prev: Map<number, { from: number; d: number }>; launches: Launch[] } {
  const prev = new Map<number, { from: number; d: number }>([[pos, { from: -1, d: -1 }]])
  const order = [pos]
  const launches: Launch[] = []
  for (let qi = 0; qi < order.length; qi++) {
    const p = order[qi] as number
    for (let d = 0; d < 4; d++) {
      let cur = p
      let nx = neighbour(n, cur, d)
      while (nx >= 0 && st[nx] === FLOOR) {
        cur = nx
        nx = neighbour(n, cur, d)
      }
      if (nx >= 0 && st[nx] === UNKNOWN) launches.push({ from: p, at: cur, d })
      else if (cur !== p && !prev.has(cur)) {
        prev.set(cur, { from: p, d })
        order.push(cur)
      }
    }
  }
  return { prev, launches }
}

function pathTo(prev: Map<number, { from: number; d: number }>, tile: number): number[] {
  const dirs: number[] = []
  let t = tile
  for (;;) {
    const e = prev.get(t)
    if (!e || e.from < 0) break
    dirs.push(e.d)
    t = e.from
  }
  return dirs.reverse()
}

/** Carve a solvable level of size `n` from `rng`. */
export function generateLevel(rng: Rng, n: number): Level {
  const N = n * n
  const st: number[] = Array<number>(N).fill(UNKNOWN)
  const start = rng.int(0, N - 1)
  st[start] = FLOOR
  const want = Math.round(N * rng.range(0.56, 0.66))
  const solution: number[] = []
  let floors = 1
  let pos = start
  while (floors < want) {
    const { prev, launches } = explore(n, st, pos)
    if (launches.length === 0) break
    const l = rng.pick(launches)
    solution.push(...pathTo(prev, l.from))
    // The roll from `from` runs over carved floor, then into new tiles.
    let cur = l.from
    let nx = neighbour(n, cur, l.d)
    while (nx >= 0 && st[nx] === FLOOR) {
      cur = nx
      nx = neighbour(n, cur, l.d)
    }
    const run = rng.int(1, n - 1)
    for (let k = 0; k < run && nx >= 0 && st[nx] === UNKNOWN; k++) {
      st[nx] = FLOOR
      floors++
      cur = nx
      nx = neighbour(n, cur, l.d)
    }
    while (nx >= 0 && st[nx] === FLOOR) {
      cur = nx
      nx = neighbour(n, cur, l.d)
    }
    // Close the roll: its resting tile becomes a permanent wall.
    if (nx >= 0 && st[nx] === UNKNOWN) st[nx] = WALL
    solution.push(l.d)
    pos = cur
  }
  const walls = st.map((v) => (v === FLOOR ? 0 : 1))
  return { n, walls, start, floors, solution }
}

/**
 * True when no sequence of rolls from `pos` can paint every floor tile: some
 * unpainted tile lies on no roll from any resting tile the ball can reach.
 * (A false answer does not promise a win, but true is a sure dead end.)
 */
export function stuck(
  level: { n: number; walls: readonly number[] },
  pos: number,
  painted: readonly number[],
): boolean {
  const seen = new Set<number>([pos])
  const order = [pos]
  const covered = new Set<number>([pos])
  for (let qi = 0; qi < order.length; qi++) {
    const p = order[qi] as number
    for (let d = 0; d < 4; d++) {
      const r = roll(level, p, d)
      for (const t of r.path) covered.add(t)
      if (r.path.length && !seen.has(r.end)) {
        seen.add(r.end)
        order.push(r.end)
      }
    }
  }
  for (let i = 0; i < level.walls.length; i++) {
    if (level.walls[i] === 0 && !painted[i] && !covered.has(i)) return true
  }
  return false
}
