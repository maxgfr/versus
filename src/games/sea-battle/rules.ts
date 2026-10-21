import type { Rng } from '../../core/rng.ts'

/**
 * Pure rules: fleets, shots and sinking. No DOM, no timing, no Math.random.
 * Cells are numbered row-major, 0..63, on the owner's 8 × 8 sea.
 */

export const N = 8
export const CELLS = N * N
/** Ship lengths, longest first. Fixed, so every player knows what is still afloat. */
export const FLEET: readonly number[] = [4, 3, 3, 2, 2]

export const UNTRIED = 0
export const MISS = 1
export const HIT = 2

export interface Sea {
  /** Cells of each ship, in FLEET order. Hidden until sunk (or peeked at by the owner). */
  ships: number[][]
  /** Per cell: shots fired at this sea, UNTRIED / MISS / HIT. */
  shots: number[]
}

export interface Shot {
  hit: boolean
  /** Index of the ship struck, or -1 for a miss. */
  ship: number
  /** This shot sank that ship. */
  sunk: boolean
  /** Every ship is now at the bottom. */
  win: boolean
}

/** What a computer player may know about a sea: shots, sunk ships and the sizes still afloat. */
export interface View {
  shots: number[]
  /** Cells of each sunk ship (public once sunk). */
  sunk: number[][]
  /** Lengths of the ships still afloat. */
  left: number[]
}

export const rowOf = (cell: number): number => Math.floor(cell / N)
export const colOf = (cell: number): number => cell % N

/** Orthogonal neighbours of a cell that lie on the sea. */
export function neighbours(cell: number): number[] {
  const r = rowOf(cell)
  const c = colOf(cell)
  const out: number[] = []
  if (r > 0) out.push(cell - N)
  if (r < N - 1) out.push(cell + N)
  if (c > 0) out.push(cell - 1)
  if (c < N - 1) out.push(cell + 1)
  return out
}

/**
 * Mark a ship's cells and their neighbours as taken. Ships may never overlap
 * or touch (not even at a corner's side), which keeps every fleet readable.
 */
export function reserve(near: boolean[], cells: readonly number[]): void {
  for (const c of cells) {
    near[c] = true
    for (const n of neighbours(c)) near[n] = true
  }
}

/** A straight ship of `len` cells at a random place, horizontal or vertical. */
export function randomLine(rng: Rng, len: number): number[] {
  if (rng.chance(0.5)) {
    const r = rng.int(0, N - 1)
    const c0 = rng.int(0, N - len)
    return Array.from({ length: len }, (_, k) => r * N + c0 + k)
  }
  const c = rng.int(0, N - 1)
  const r0 = rng.int(0, N - len)
  return Array.from({ length: len }, (_, k) => (r0 + k) * N + c)
}

/**
 * Place the fleet at random. Restarts from scratch if a ship cannot find room
 * (rare on 8 × 8), so the result is always complete and legal.
 */
export function placeFleet(rng: Rng, sizes: readonly number[] = FLEET): number[][] {
  for (;;) {
    const near = Array<boolean>(CELLS).fill(false)
    const ships: number[][] = []
    let ok = true
    for (const len of sizes) {
      let cells: number[] | null = null
      for (let tries = 0; tries < 200 && !cells; tries++) {
        const cand = randomLine(rng, len)
        if (cand.every((c) => !near[c])) cells = cand
      }
      if (!cells) {
        ok = false
        break
      }
      reserve(near, cells)
      ships.push(cells)
    }
    if (ok) return ships
  }
}

export function freshSea(rng: Rng): Sea {
  return { ships: placeFleet(rng), shots: Array<number>(CELLS).fill(UNTRIED) }
}

/** Index of the ship covering `cell`, or -1. */
export function shipAt(sea: Sea, cell: number): number {
  return sea.ships.findIndex((cells) => cells.includes(cell))
}

export function isSunk(sea: Sea, ship: number): boolean {
  const cells = sea.ships[ship] ?? []
  return cells.length > 0 && cells.every((c) => sea.shots[c] === HIT)
}

export function sunkIndices(sea: Sea): number[] {
  return sea.ships.map((_, i) => i).filter((i) => isSunk(sea, i))
}

export function sunkCount(sea: Sea): number {
  return sunkIndices(sea).length
}

export function allSunk(sea: Sea): boolean {
  return sunkCount(sea) === sea.ships.length
}

export function untried(sea: Sea): number[] {
  const out: number[] = []
  sea.shots.forEach((v, i) => {
    if (v === UNTRIED) out.push(i)
  })
  return out
}

/** Fire at `cell`. Pure: returns the next sea and what happened. Throws on a repeat shot. */
export function fire(sea: Sea, cell: number): { sea: Sea; shot: Shot } {
  if (sea.shots[cell] !== UNTRIED) throw new Error(`Cell ${cell} was already fired at`)
  const shots = sea.shots.slice()
  const ship = shipAt(sea, cell)
  if (ship < 0) {
    shots[cell] = MISS
    return {
      sea: { ships: sea.ships, shots },
      shot: { hit: false, ship: -1, sunk: false, win: false },
    }
  }
  shots[cell] = HIT
  const next: Sea = { ships: sea.ships, shots }
  return {
    sea: next,
    shot: { hit: true, ship, sunk: isSunk(next, ship), win: allSunk(next) },
  }
}

/** The public knowledge of a sea, for the computer. Never includes unsunk ship cells. */
export function viewOf(sea: Sea): View {
  const sunk = sunkIndices(sea)
  return {
    shots: sea.shots.slice(),
    sunk: sunk.map((i) => (sea.ships[i] ?? []).slice()),
    left: sea.ships.filter((_, i) => !sunk.includes(i)).map((cells) => cells.length),
  }
}

/** Hits on ships that are not sunk yet: the computer has to finish these off. */
export function pendingHits(view: View): number[] {
  const sunkCells = new Set(view.sunk.flat())
  const out: number[] = []
  view.shots.forEach((v, i) => {
    if (v === HIT && !sunkCells.has(i)) out.push(i)
  })
  return out
}

export const shipName = (len: number): string =>
  len >= 4 ? 'Battleship' : len === 3 ? 'Cruiser' : 'Destroyer'
