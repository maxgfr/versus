import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  CELLS,
  colOf,
  N,
  neighbours,
  pendingHits,
  reserve,
  rowOf,
  UNTRIED,
  type View,
} from './rules.ts'

/**
 * The computer's shots. It only ever reads a `View`: what a human could see
 * too (shots, sunk ships, sizes left), plus the rule that ships never touch
 * side to side, so the water around a sunk ship is known to be empty.
 * - easy: shoots at random, and only sometimes follows up a hit.
 * - normal: hunts on a checkerboard (skipping water known to be empty) and finishes
 *   off hits along their line.
 * - hard: counts, for every cell, how many placements of the ships still
 *   afloat fit what it knows (through the open hits when there are some) and
 *   fires where a ship is most likely.
 */

const DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
]

/** Every straight placement of a ship of each length, computed once. */
const LINES: Map<number, number[][]> = new Map()
function linesOf(len: number): number[][] {
  let out = LINES.get(len)
  if (out) return out
  out = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (c + len <= N) out.push(Array.from({ length: len }, (_, k) => r * N + c + k))
      if (len > 1 && r + len <= N) out.push(Array.from({ length: len }, (_, k) => (r + k) * N + c))
    }
  }
  LINES.set(len, out)
  return out
}

/** Cells that cannot hold a ship: on or beside a sunk one. */
function emptyWater(view: View): boolean[] {
  const blocked = Array<boolean>(CELLS).fill(false)
  for (const cells of view.sunk) reserve(blocked, cells)
  return blocked
}

export function choose(view: View, difficulty: Difficulty, rng: Rng): number {
  const open: number[] = []
  view.shots.forEach((v, i) => {
    if (v === UNTRIED) open.push(i)
  })
  if (difficulty === 'easy') {
    const pend = pendingHits(view)
    if (pend.length && rng.chance(0.45)) {
      const around = pend.flatMap(neighbours).filter((c) => view.shots[c] === UNTRIED)
      if (around.length) return rng.pick(around)
    }
    return rng.pick(open)
  }
  if (difficulty === 'normal') return normal(view, open, rng)
  return hard(view, open, rng)
}

function normal(view: View, open: number[], rng: Rng): number {
  const blocked = emptyWater(view)
  const sensible = open.filter((c) => !blocked[c])
  const pool = sensible.length ? sensible : open
  const pend = pendingHits(view)
  if (pend.length === 0) {
    // Hunts on a checkerboard: every ship is two cells or longer, so it must cover one.
    const even = pool.filter((c) => (rowOf(c) + colOf(c)) % 2 === 0)
    return rng.pick(even.length ? even : pool)
  }
  const line = lineTargets(view, pend).filter((c) => !blocked[c])
  if (line.length) return rng.pick(line)
  const around = pend.flatMap(neighbours).filter((c) => view.shots[c] === UNTRIED && !blocked[c])
  return around.length ? rng.pick(around) : rng.pick(pool)
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

/**
 * Likelihood of a ship on each untried cell: the number of placements of the
 * ships still afloat that fit the known shots. With open hits, only
 * placements through them count (weighted by how many they explain), and a
 * placement may not run beside a hit it does not include (ships never touch).
 */
export function density(view: View): number[] {
  const dens = Array<number>(CELLS).fill(0)
  const pend = pendingHits(view)
  const isPend = Array<boolean>(CELLS).fill(false)
  for (const p of pend) isPend[p] = true
  const blocked = emptyWater(view)
  for (const len of view.left) {
    for (const pl of linesOf(len)) {
      let covers = 0
      let ok = true
      for (const c of pl) {
        if (blocked[c] || (view.shots[c] !== UNTRIED && !isPend[c])) {
          ok = false
          break
        }
        if (isPend[c]) covers++
      }
      if (!ok) continue
      if (pend.length) {
        if (covers === 0) continue
        // A hit right beside this ship but not on it would make two ships touch.
        let touches = false
        for (const c of pl) {
          for (const n of neighbours(c)) if (isPend[n] && !pl.includes(n)) touches = true
        }
        if (touches) continue
      }
      const w = pend.length ? covers * covers * 4 : 1
      for (const c of pl) if (view.shots[c] === UNTRIED) dens[c] = (dens[c] ?? 0) + w
    }
  }
  return dens
}

function hard(view: View, open: number[], rng: Rng): number {
  const dens = density(view)
  let best = 0
  let ties: number[] = []
  for (const c of open) {
    const d = dens[c] ?? 0
    if (d > best) {
      best = d
      ties = [c]
    } else if (d === best && d > 0) ties.push(c)
  }
  return ties.length ? rng.pick(ties) : rng.pick(open)
}
