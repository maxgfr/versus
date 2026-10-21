import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  CELLS,
  colOf,
  N,
  neighbours,
  pendingHits,
  randomLine,
  reserve,
  rowOf,
  UNTRIED,
  type View,
} from './rules.ts'

/**
 * The computer's shots. It only ever reads a `View`: what a human could see
 * too (shots, sunk ships, sizes left). Easy shoots at random, normal hunts at
 * random and finishes off hits along their line, hard runs a probability
 * density over the fleets still consistent with what it knows (hunting on the
 * even squares, where every ship must cross at least one).
 */

const SAMPLES = 120
const DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
]

export function choose(view: View, difficulty: Difficulty, rng: Rng): number {
  const open: number[] = []
  view.shots.forEach((v, i) => {
    if (v === UNTRIED) open.push(i)
  })
  if (difficulty === 'easy') return rng.pick(open)
  if (difficulty === 'normal') return normal(view, open, rng)
  return hard(view, open, rng)
}

function normal(view: View, open: number[], rng: Rng): number {
  const pend = pendingHits(view)
  if (pend.length === 0) return rng.pick(open)
  const line = lineTargets(view, pend)
  if (line.length) return rng.pick(line)
  const around = pend.flatMap(neighbours).filter((c) => view.shots[c] === UNTRIED)
  return around.length ? rng.pick(around) : rng.pick(open)
}

const at = (r: number, c: number): number | null =>
  r >= 0 && r < N && c >= 0 && c < N ? r * N + c : null

/** Ends of the runs of pending hits: where a ship that was hit in a line goes on. */
function lineTargets(view: View, pend: number[]): number[] {
  const hits = new Set(pend)
  const out: number[] = []
  for (const p of pend) {
    for (const [dr, dc] of DIRS) {
      const q = at(rowOf(p) + dr, colOf(p) + dc)
      if (q === null || !hits.has(q)) continue
      let end = q
      for (;;) {
        const n = at(rowOf(end) + dr, colOf(end) + dc)
        if (n === null || !hits.has(n)) break
        end = n
      }
      let start = p
      for (;;) {
        const b = at(rowOf(start) - dr, colOf(start) - dc)
        if (b === null || !hits.has(b)) break
        start = b
      }
      for (const x of [
        at(rowOf(end) + dr, colOf(end) + dc),
        at(rowOf(start) - dr, colOf(start) - dc),
      ]) {
        if (x !== null && view.shots[x] === UNTRIED) out.push(x)
      }
    }
  }
  return out
}

function hard(view: View, open: number[], rng: Rng): number {
  const pend = pendingHits(view)
  const dens = coverage(view, pend, rng)
  let pool = open
  if (pend.length === 0) {
    // Hunting: every ship (length 2 or more) covers an even square, so only those need checking.
    const even = open.filter((c) => (rowOf(c) + colOf(c)) % 2 === 0)
    if (even.length) pool = even
  }
  let best = -1
  let ties: number[] = []
  for (const c of pool) {
    const d = dens[c] ?? 0
    if (d > best) {
      best = d
      ties = [c]
    } else if (d === best) ties.push(c)
  }
  return rng.pick(ties)
}

/** How many sampled legal fleets put a ship on each cell. */
function coverage(view: View, pend: number[], rng: Rng): number[] {
  const dens = Array<number>(CELLS).fill(0)
  const pendSet = new Set(pend)
  const blocked = Array<boolean>(CELLS).fill(false)
  for (const cells of view.sunk) reserve(blocked, cells)
  const usable = (c: number) => view.shots[c] === UNTRIED || pendSet.has(c)
  for (let k = 0; k < SAMPLES; k++) {
    const fleet = sampleFleet(view.left, usable, blocked, rng)
    if (!fleet) continue
    const cells = fleet.flat()
    if (!pend.every((p) => cells.includes(p))) continue
    for (const c of cells) dens[c] = (dens[c] ?? 0) + 1
  }
  return dens
}

/** One random fleet for the ships still afloat that respects the known cells. */
function sampleFleet(
  lengths: readonly number[],
  usable: (c: number) => boolean,
  blocked: readonly boolean[],
  rng: Rng,
): number[][] | null {
  const near = blocked.slice()
  const ships: number[][] = []
  for (const len of [...lengths].sort((a, b) => b - a)) {
    let cells: number[] | null = null
    for (let t = 0; t < 60 && !cells; t++) {
      const cand = randomLine(rng, len)
      if (cand.every((c) => usable(c) && !near[c])) cells = cand
    }
    if (!cells) return null
    reserve(near, cells)
    ships.push(cells)
  }
  return ships
}
