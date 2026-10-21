import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Nuts and Bolts. Eight bolts hold up to four nuts each (a
 * nut is a colour index; a bolt lists its nuts bottom to top). Lifting takes
 * the top run of one colour; dropping onto a bolt whose top matches, or onto
 * an empty bolt, moves as many as fit. Solved when every bolt is one colour
 * or empty.
 */

export const BOLTS = 8
export const CAP = 4
export const COLOURS = 6

export type Bolts = number[][]

/** Nut swaps between full bolts that scramble the solved board: the level of difficulty. */
export const SWAPS: Record<Difficulty, number> = { easy: 6, normal: 14, hard: 30 }

export function solvedBolts(): Bolts {
  return Array.from({ length: BOLTS }, (_, i) =>
    i < COLOURS ? Array.from({ length: CAP }, () => i) : [],
  )
}

const top = (b: readonly number[]): number => b[b.length - 1] ?? -1

/** Nuts in the top run of one colour. */
export function topRun(b: readonly number[]): number {
  if (!b.length) return 0
  const c = top(b)
  let n = 0
  while (n < b.length && b[b.length - 1 - n] === c) n++
  return n
}

export function monochrome(b: readonly number[]): boolean {
  return b.every((c) => c === b[0])
}

/** Can the top run of `from` go onto `to`? */
export function canDrop(bolts: Bolts, from: number, to: number): boolean {
  if (from === to) return false
  const src = bolts[from] ?? []
  const dst = bolts[to] ?? []
  if (!src.length || dst.length >= CAP) return false
  return dst.length === 0 || top(dst) === top(src)
}

/** Move as many nuts of the top run of `from` onto `to` as fit. Returns the new bolts. */
export function move(bolts: Bolts, from: number, to: number): Bolts {
  const next = bolts.map((b) => b.slice())
  const src = next[from] ?? []
  const dst = next[to] ?? []
  const k = Math.min(topRun(src), CAP - dst.length)
  const c = top(src)
  for (let i = 0; i < k; i++) {
    src.pop()
    dst.push(c)
  }
  return next
}

export function isSolved(bolts: Bolts): boolean {
  return bolts.every((b) => b.length === 0 || monochrome(b))
}

/**
 * Moves worth considering. All empty bolts are alike, so only the first one is
 * offered, and a single-colour run is not moved onto it (that changes nothing).
 */
export function moves(bolts: Bolts): [number, number][] {
  const out: [number, number][] = []
  const firstEmpty = bolts.findIndex((b) => b.length === 0)
  bolts.forEach((src, from) => {
    if (!src.length) return
    bolts.forEach((_, to) => {
      if (!canDrop(bolts, from, to)) return
      if (bolts[to]?.length === 0 && (to !== firstEmpty || monochrome(src))) return
      out.push([from, to])
    })
  })
  return out
}

/** A canonical key: bolts are interchangeable, so their order does not matter. */
function key(bolts: Bolts): string {
  return bolts
    .map((b) => b.join(''))
    .sort()
    .join('|')
}

/** Nuts that are not of their bolt's majority colour: zero when sorted, the search's guide. */
export function misplaced(bolts: Bolts): number {
  let d = 0
  for (const b of bolts) {
    const counts = new Map<number, number>()
    for (const c of b) counts.set(c, (counts.get(c) ?? 0) + 1)
    d += b.length - Math.max(0, ...counts.values())
  }
  return d
}

/** Binary min-heap on `f`, ties broken towards deeper states (fewer steps left). */
class Heap<T extends { f: number; g: number }> {
  private a: T[] = []
  get size(): number {
    return this.a.length
  }
  private less(x: T, y: T): boolean {
    return x.f < y.f || (x.f === y.f && x.g > y.g)
  }
  push(v: T): void {
    const a = this.a
    a.push(v)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.less(a[i] as T, a[p] as T)) break
      ;[a[i], a[p]] = [a[p] as T, a[i] as T]
      i = p
    }
  }
  pop(): T | undefined {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length && last !== undefined) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && this.less(a[l] as T, a[m] as T)) m = l
        if (r < a.length && this.less(a[r] as T, a[m] as T)) m = r
        if (m === i) break
        ;[a[i], a[m]] = [a[m] as T, a[i] as T]
        i = m
      }
    }
    return top
  }
}

/**
 * The shortest-ish sequence of moves that solves `start`: best-first search
 * (A*-style) over canonical states. Null when the node budget runs out.
 */
export function solve(start: Bolts, budget = 60000): [number, number][] | null {
  if (isSolved(start)) return []
  const from = new Map<string, { prev: string; move: [number, number] } | null>()
  const k0 = key(start)
  from.set(k0, null)
  const heap = new Heap<{ f: number; g: number; b: Bolts; k: string }>()
  heap.push({ f: misplaced(start), g: 0, b: start, k: k0 })
  let expanded = 0
  while (heap.size) {
    const cur = heap.pop()
    if (!cur) break
    if (isSolved(cur.b)) {
      const path: [number, number][] = []
      let k = cur.k
      for (let e = from.get(k); e; e = from.get(k)) {
        path.push(e.move)
        k = e.prev
      }
      return path.reverse()
    }
    if (++expanded > budget) return null
    for (const m of moves(cur.b)) {
      const nb = move(cur.b, m[0], m[1])
      const nk = key(nb)
      if (from.has(nk)) continue
      from.set(nk, { prev: cur.k, move: m })
      heap.push({ f: cur.g + 1 + misplaced(nb), g: cur.g + 1, b: nb, k: nk })
    }
  }
  return null
}

export interface Puzzle {
  start: Bolts
  /** A solution from `start` (the computer plays it). */
  plan: [number, number][]
}

/**
 * Scramble the solved state by swapping nuts between the full bolts: the two
 * empty bolts stay empty and every bolt keeps its four nuts, as at the start of
 * a game. The search then has to confirm the scramble before it is kept, so
 * every puzzle a player gets is solvable. Same seed, same puzzle on both halves.
 */
export function buildPuzzle(seed: number, swaps: number): Puzzle {
  const rng = new Rng(seed)
  let last: Puzzle | null = null
  for (let attempt = 0; attempt < 50; attempt++) {
    const b = solvedBolts()
    for (let s = 0; s < swaps; s++) {
      const i = rng.int(0, COLOURS - 1)
      const j = rng.int(0, COLOURS - 1)
      const bi = b[i]
      const bj = b[j]
      if (!bi || !bj || i === j) continue
      const p = rng.int(0, CAP - 1)
      const q = rng.int(0, CAP - 1)
      const x = bi[p] ?? 0
      bi[p] = bj[q] ?? 0
      bj[q] = x
    }
    const start = rng.shuffle(b)
    if (isSolved(start)) continue
    const plan = solve(start)
    last = { start, plan: plan ?? [] }
    if (plan) return last
  }
  return last ?? { start: solvedBolts(), plan: [] }
}
