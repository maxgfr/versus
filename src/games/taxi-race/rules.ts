import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  bfsNext,
  collideCircle,
  type Grid,
  mirrorMap,
  parseMap,
  separate,
  solidCell,
} from '../../engines/arena/index.ts'

/**
 * Taxi Race: a city grid shared by both players. Passengers wait on street
 * corners with a flag at their destination. Drive into a passenger to pick
 * them up, then deliver them to the flag for points (the longer the trip, the
 * more). Bumping a rival that carries a passenger makes them drop it. Pure
 * logic: no DOM, no canvas, no Math.random.
 */

/** Taxi radius and top speed (world units, s). */
export const R = 34
export const SPEED = 300
/** How close a taxi must get to pick up / deliver. */
export const PICK_R = 50
export const DROP_R = 56
/** Waiting passengers on the map at once, and the gap between new ones (s). */
export const MAX_WAITING = 3
export const SPAWN_MIN = 2.4
export const SPAWN_MAX = 3.6
/** Shortest trip (street cells) a passenger may ask for. */
export const MIN_STEPS = 4
/** Points per street cell of a trip. */
export const POINTS_PER_CELL = 10
/** Closing speed that counts as a bump, and the pause before a bumped taxi can pick up again. */
export const BUMP_SPEED = 60
export const COOLDOWN = 1.6

/**
 * Two city maps, written as the blue half (top). `mirrorMap` completes each
 * point-symmetrically, so both players get the same streets. 'B' / 'R' mark the
 * taxi starts.
 */
const TOP: string[][] = [
  ['B.........', '.##.##.##.', '.##.##.##.', '..........', '.#..##..#.', '.##.##.##.'],
  ['B...#.....', '.#.#.#.##.', '...#...#..', '##.......#', '.#...#...#', '...#...#..'],
]
export const MAPS: string[][] = TOP.map((t) => mirrorMap(t))

const grids = new Map<number, Grid>()

/** The arena grid for a map index (parsed once). */
export function gridOf(map: number): Grid {
  let g = grids.get(map)
  if (!g) {
    g = parseMap(MAPS[map] as string[])
    grids.set(map, g)
  }
  return g
}

export interface Pt {
  x: number
  y: number
}

export interface Taxi {
  side: Side
  x: number
  y: number
  /** Heading (rad) for drawing: the nose points this way. */
  a: number
  vx: number
  vy: number
  /** Id of the passenger in the back seat, or -1. */
  carry: number
  /** Fares delivered, and points earned from them. */
  fares: number
  points: number
  /** World time before which this taxi cannot pick up (after a bump). */
  calmT: number
}

/** A passenger: waiting at (fx, fy) or riding (carried by a side) to (tx, ty). */
export interface Fare {
  id: number
  fx: number
  fy: number
  tx: number
  ty: number
  value: number
  /** -1 = waiting for a taxi, else the side carrying them. */
  carried: number
}

export interface World {
  map: number
  /** World seconds since the start. */
  t: number
  taxis: [Taxi, Taxi]
  fares: Fare[]
  nextId: number
  /** World time of the next passenger, and of the next allowed bump sound / drop. */
  spawnT: number
  bumpT: number
}

export type Ev =
  | { k: 'pick'; side: Side; x: number; y: number; id: number }
  | { k: 'deliver'; side: Side; x: number; y: number; value: number; id: number }
  | { k: 'drop'; side: Side; x: number; y: number; id: number }
  | { k: 'bump'; side: Side; x: number; y: number }

/** Taxi spawn for a side: the letter in the map for that side's colour. */
function startOf(grid: Grid, side: Side): Pt {
  const p = grid.spawns[side === 0 ? 'R' : 'B']
  return p ? { x: p.x, y: p.y } : { x: 450, y: 900 }
}

function taxiAt(grid: Grid, side: Side): Taxi {
  const p = startOf(grid, side)
  return {
    side,
    x: p.x,
    y: p.y,
    a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
    vx: 0,
    vy: 0,
    carry: -1,
    fares: 0,
    points: 0,
    calmT: -1,
  }
}

export function newWorld(map: number): World {
  const grid = gridOf(map)
  return {
    map,
    t: 0,
    taxis: [taxiAt(grid, 0), taxiAt(grid, 1)],
    fares: [],
    nextId: 1,
    spawnT: 1.2,
    bumpT: 0,
  }
}

/** Open neighbours of a street cell (4-connected). */
function openNeighbours(g: Grid, c: number, r: number): [boolean, boolean, boolean, boolean] {
  return [
    !solidCell(g, c - 1, r),
    !solidCell(g, c + 1, r),
    !solidCell(g, c, r - 1),
    !solidCell(g, c, r + 1),
  ]
}

/** Is this street cell a corner, dead end or junction (not a straight run)? */
export function isCorner(g: Grid, c: number, r: number): boolean {
  const [l, rt, u, d] = openNeighbours(g, c, r)
  const n = [l, rt, u, d].filter(Boolean).length
  if (n === 2 && ((l && rt) || (u && d))) return false
  return true
}

/**
 * Corners hidden under the pause button (left edge, mid-height) and their
 * mirror images are skipped, so no passenger waits where nobody can see it and
 * both players keep the same set of corners.
 */
function underPause(p: Pt): boolean {
  const band = p.y > 760 && p.y < 1040
  return band && (p.x < 120 || p.x > 880)
}

/** Every street corner, junction and dead end of a map, as world points. */
export function cornersOf(g: Grid): Pt[] {
  const out: Pt[] = []
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      if (solidCell(g, c, r) || !isCorner(g, c, r)) continue
      const p = { x: g.x0 + (c + 0.5) * g.cell, y: g.y0 + (r + 0.5) * g.cell }
      if (!underPause(p)) out.push(p)
    }
  return out
}

/** Street steps between two world points (the BFS distance, in cells), or -1 if unreachable. */
export function stepsBetween(g: Grid, a: Pt, b: Pt): number {
  return bfsNext(g, a.x, a.y, b.x, b.y).steps
}

/** The corner closest to a point. */
export function nearestCorner(corners: readonly Pt[], p: Pt): Pt {
  let best = corners[0] as Pt
  let bd = Infinity
  for (const c of corners) {
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2
    if (d < bd) {
      bd = d
      best = c
    }
  }
  return best
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Points a fare is worth: longer trips pay more. */
export function fareValue(steps: number): number {
  return steps * POINTS_PER_CELL
}

/** Try to add a passenger on a free corner with a far enough destination. */
function spawnFare(w: World, grid: Grid, rng: Rng): void {
  const corners = cornersOf(grid)
  if (corners.length < 2) return
  const busy = (p: Pt) =>
    w.taxis.some((t) => dist(t, p) < 120) ||
    w.fares.some((f) => dist({ x: f.fx, y: f.fy }, p) < 120 || dist({ x: f.tx, y: f.ty }, p) < 120)
  for (let tries = 0; tries < 40; tries++) {
    const from = rng.pick(corners)
    if (busy(from)) continue
    const to = rng.pick(corners)
    const steps = stepsBetween(grid, from, to)
    if (steps < MIN_STEPS || dist(from, to) < 200) continue
    w.fares.push({
      id: w.nextId++,
      fx: from.x,
      fy: from.y,
      tx: to.x,
      ty: to.y,
      value: fareValue(steps),
      carried: -1,
    })
    return
  }
}

/**
 * Advance the city one step. `drives[side]` is the joystick vector (|v| ≤ 1) or
 * null. Events are appended to `ev`.
 */
export function stepWorld(
  w: World,
  dt: number,
  drives: readonly [Pt | null, Pt | null],
  rng: Rng,
  ev: Ev[],
): void {
  const grid = gridOf(w.map)
  w.t += dt

  const waiting = w.fares.filter((f) => f.carried < 0).length
  if (w.t >= w.spawnT) {
    if (waiting < MAX_WAITING) spawnFare(w, grid, rng)
    w.spawnT = w.t + rng.range(SPAWN_MIN, SPAWN_MAX)
  }

  for (const side of [0, 1] as Side[]) {
    const t = w.taxis[side]
    const d = drives[side]
    const m = d ? Math.min(1, Math.hypot(d.x, d.y)) : 0
    if (d && m > 0.06) {
      const k = Math.hypot(d.x, d.y) || 1
      t.vx = (d.x / k) * SPEED * m
      t.vy = (d.y / k) * SPEED * m
      t.a = Math.atan2(t.vy, t.vx)
    } else {
      t.vx = 0
      t.vy = 0
    }
    t.x += t.vx * dt
    t.y += t.vy * dt
    collideCircle(grid, t, R)
  }

  // Taxis bump each other: a fast enough hit makes a carrier drop their passenger.
  const [a, b] = w.taxis
  if (separate(a, b, R, R)) {
    collideCircle(grid, a, R)
    collideCircle(grid, b, R)
    const nx = b.x - a.x
    const ny = b.y - a.y
    const n = Math.hypot(nx, ny) || 1
    const closing = ((a.vx - b.vx) * nx + (a.vy - b.vy) * ny) / n
    if (Math.abs(closing) > BUMP_SPEED && w.t >= w.bumpT) {
      w.bumpT = w.t + 0.5
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      ev.push({ k: 'bump', side: a.side, x: mx, y: my })
      for (const [hit, other] of [
        [a, b],
        [b, a],
      ] as const) {
        // A carrier bumped by a moving rival drops the passenger.
        if (hit.carry < 0 || Math.abs(other.vx) + Math.abs(other.vy) < 40) continue
        const f = w.fares.find((x) => x.id === hit.carry)
        if (f) {
          const corners = cornersOf(grid)
          const at = nearestCorner(corners, hit)
          f.fx = at.x
          f.fy = at.y
          f.carried = -1
          ev.push({ k: 'drop', side: hit.side, x: hit.x, y: hit.y, id: f.id })
        }
        hit.carry = -1
        hit.calmT = w.t + COOLDOWN
      }
    }
  }

  for (const side of [0, 1] as Side[]) {
    const t = w.taxis[side]
    if (t.carry < 0 && w.t >= t.calmT) {
      const f = w.fares.find((x) => x.carried < 0 && dist(t, { x: x.fx, y: x.fy }) < PICK_R)
      if (f) {
        f.carried = side
        t.carry = f.id
        ev.push({ k: 'pick', side, x: f.fx, y: f.fy, id: f.id })
      }
    }
    if (t.carry >= 0) {
      const f = w.fares.find((x) => x.id === t.carry)
      if (!f) {
        t.carry = -1
      } else if (dist(t, { x: f.tx, y: f.ty }) < DROP_R) {
        t.fares++
        t.points += f.value
        t.carry = -1
        w.fares = w.fares.filter((x) => x.id !== f.id)
        ev.push({ k: 'deliver', side, x: f.tx, y: f.ty, value: f.value, id: f.id })
      }
    }
  }
}

/** Fares delivered decide the match; points break a tie; equal both is a draw. */
export function winnerOf(w: World): Side | 'draw' {
  const [a, b] = w.taxis
  if (a.fares !== b.fares) return a.fares > b.fares ? 0 : 1
  if (a.points !== b.points) return a.points > b.points ? 0 : 1
  return 'draw'
}
