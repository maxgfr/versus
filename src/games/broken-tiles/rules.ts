import type { Side } from '../../core/game.ts'

/**
 * Broken Tiles, pure rules. A grid of tiles floats over a void. A tile starts
 * cracking once nobody stands on it any more, and drops DROP seconds later.
 * A body with no live tile under any part of it falls and loses the round.
 *
 * Nothing here draws or uses randomness, so the same inputs always give the
 * same board (the online guest only ever renders what the host sends).
 */

export const COLS = 7
export const ROWS = 11
export const TILE = 118
export const GAP = 14
const PITCH = TILE + GAP
/** Top-left of the grid in world units (the grid is centred on the stage). */
export const X0 = (1000 - (COLS * PITCH - GAP)) / 2
export const Y0 = (1800 - (ROWS * PITCH - GAP)) / 2
/** A tile drops this long after it starts cracking (s). */
export const DROP = 0.5
/**
 * Standing this long on one tile cracks it, so nobody can camp: a stationary
 * player has to keep moving, like everyone else (s).
 */
export const STAND = 1.5
/** Walking speed at full stick (world units / s). */
export const SPEED = 330
/** A body is held up by any live tile at its centre or within this reach. */
export const REACH = 26
/** Body radius, for drawing and bots. */
export const BODY = 30

export const INTACT = 0
export const CRACK = 1
export const GONE = 2

/** Red's and blue's start tiles: red bottom-left, blue top-right (point symmetric). */
const START: [number, number] = [8 * COLS + 2, 2 * COLS + 4]

/**
 * Notches with no tile from the start: the middle row's end tiles. The left one
 * sits under the pause button, the right one keeps the board point symmetric.
 */
export const HOLES: readonly number[] = [
  Math.floor(ROWS / 2) * COLS,
  Math.floor(ROWS / 2) * COLS + COLS - 1,
]

export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  /** The tile the body is on: the one nearest its centre, gaps included. */
  tile: number
  /** Time the body arrived on `tile` (s). */
  since: number
  alive: boolean
  /** Time it fell (s), -1 while alive. */
  fallT: number
}

export interface Board {
  /** Per tile: INTACT, CRACK or GONE. Row-major, COLS tiles per row. */
  st: number[]
  /** Per tile: time of its last state change (s). */
  t: number[]
  /** Red (side 0) then blue (side 1). */
  p: [Body, Body]
}

export type Ev =
  | { k: 'crack'; i: number; stand: boolean }
  | { k: 'drop'; i: number }
  | { k: 'enter'; side: Side; i: number }
  | { k: 'fall'; side: Side; x: number; y: number }

export function tileCentre(i: number): { x: number; y: number } {
  const c = i % COLS
  const r = Math.floor(i / COLS)
  return { x: X0 + c * PITCH + TILE / 2, y: Y0 + r * PITCH + TILE / 2 }
}

/** The tile whose face contains (x, y), or -1 over a gap or outside the grid. */
export function tileAt(x: number, y: number): number {
  const u = x - X0
  const v = y - Y0
  if (u < 0 || v < 0) return -1
  const c = Math.floor(u / PITCH)
  const r = Math.floor(v / PITCH)
  if (c >= COLS || r >= ROWS) return -1
  if (u - c * PITCH > TILE || v - r * PITCH > TILE) return -1
  return r * COLS + c
}

/** The tile whose centre is nearest to (x, y), gaps included. */
export function nearestTile(x: number, y: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < COLS * ROWS; i++) {
    const c = tileCentre(i)
    const d = (c.x - x) ** 2 + (c.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function newBoard(now: number): Board {
  const n = COLS * ROWS
  const body = (side: Side): Body => {
    const tile = START[side]
    const c = tileCentre(tile)
    return { x: c.x, y: c.y, vx: 0, vy: 0, tile, since: now, alive: true, fallT: -1 }
  }
  return {
    st: Array.from({ length: n }, (_, i) => (HOLES.includes(i) ? GONE : INTACT)),
    t: Array.from({ length: n }, () => -9),
    p: [body(0), body(1)],
  }
}

/** Is tile `i` still standing (intact or cracking)? */
export function live(b: Board, i: number): boolean {
  const s = b.st[i]
  return s !== undefined && s !== GONE
}

const REACH_PTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [REACH, 0],
  [-REACH, 0],
  [0, REACH],
  [0, -REACH],
]

/** A body at (x, y) is held up if any sample point of its footprint is on a live tile. */
export function supported(b: Board, x: number, y: number): boolean {
  return REACH_PTS.some(([dx, dy]) => {
    const i = tileAt(x + dx, y + dy)
    return i >= 0 && live(b, i)
  })
}

function crack(b: Board, i: number, now: number, stand: boolean, ev: Ev[]): void {
  b.st[i] = CRACK
  b.t[i] = now
  ev.push({ k: 'crack', i, stand })
}

/**
 * Advance the board one step. `dirs[side]` is that side's stick vector (at most
 * unit length; zero when idle or when the round is not being played). Events
 * are appended to `ev`. Returns the side still standing once someone falls:
 * 'draw' when both fall in the same step, null while the round goes on.
 */
export function stepBoard(
  b: Board,
  dirs: readonly (readonly [number, number])[],
  dt: number,
  now: number,
  ev: Ev[],
): Side | 'draw' | null {
  const before = [b.p[0].tile, b.p[1].tile]
  for (const side of [0, 1] as const) {
    const p = b.p[side]
    if (!p.alive) continue
    const d = dirs[side] ?? [0, 0]
    p.vx = (d[0] ?? 0) * SPEED
    p.vy = (d[1] ?? 0) * SPEED
    p.x += p.vx * dt
    p.y += p.vy * dt
    const i = nearestTile(p.x, p.y)
    if (i !== p.tile) {
      p.tile = i
      p.since = now
      if (i >= 0 && b.st[i] === INTACT) ev.push({ k: 'enter', side, i })
    }
  }
  // Stepping off a tile cracks it, unless the other body still stands on it.
  for (const side of [0, 1] as const) {
    const old = before[side] ?? -1
    const p = b.p[side]
    if (old < 0 || old === p.tile) continue
    const other = side === 0 ? b.p[1] : b.p[0]
    if (other.alive && other.tile === old) continue
    if (b.st[old] === INTACT) crack(b, old, now, false, ev)
  }
  // Staying put too long cracks every intact tile holding the body up, so nobody
  // can hover in a gap or camp on a tile.
  for (const p of b.p) {
    if (!p.alive || now - p.since < STAND) continue
    for (const [dx, dy] of REACH_PTS) {
      const i = tileAt(p.x + dx, p.y + dy)
      if (i >= 0 && b.st[i] === INTACT) crack(b, i, now, true, ev)
    }
  }
  // Cracked tiles drop once their time is up.
  for (let i = 0; i < b.st.length; i++) {
    if (b.st[i] === CRACK && now - (b.t[i] ?? 0) >= DROP) {
      b.st[i] = GONE
      b.t[i] = now
      ev.push({ k: 'drop', i })
    }
  }
  for (const side of [0, 1] as const) {
    const p = b.p[side]
    if (p.alive && !supported(b, p.x, p.y)) {
      p.alive = false
      p.fallT = now
      ev.push({ k: 'fall', side, x: p.x, y: p.y })
    }
  }
  const red = b.p[0].alive
  const blue = b.p[1].alive
  if (!red && !blue) return 'draw'
  if (!red) return 1
  if (!blue) return 0
  return null
}

/** Live tiles that are still fully intact. */
export function intactCount(b: Board): number {
  return b.st.filter((s) => s === INTACT).length
}
