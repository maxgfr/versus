import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Level, roll, stuck } from './rules.ts'

/** Seconds between the computer's rolls. */
export const PACE: Record<Difficulty, number> = { easy: 1.5, normal: 0.62, hard: 0.42 }
/** Seconds the computer studies a fresh level before its first roll, as a person would. */
export const READ: Record<Difficulty, number> = { easy: 1.4, normal: 0.7, hard: 0.35 }
/** How hard the computer swipes (0..1): a harder swipe rolls faster. */
export const POWER: Record<Difficulty, number> = { easy: 0.1, normal: 0.6, hard: 0.9 }
/** Chance per roll that the computer rolls at random instead of following its plan. */
const SLIP: Record<Difficulty, number> = { easy: 0.25, normal: 0.02, hard: 0 }
/** Breadth-first budget for the fewest-rolls plan; easy just follows the first plan it finds. */
const SHORTEST: Record<Difficulty, number> = { easy: 0, normal: 8000, hard: 40000 }
/** Expansions allowed per plan; past it the generator's own solution is used. */
const BUDGET = 40000

interface Node {
  pos: number
  lo: number
  hi: number
  left: number
  parent: number
  d: number
}

// Painted tiles as two 32-bit words (levels have at most 64 tiles).
const bit = (t: number): [number, number] => (t < 32 ? [1 << t, 0] : [0, 1 << (t - 32)])
const isSet = (lo: number, hi: number, t: number): boolean =>
  t < 32 ? (lo & (1 << t)) !== 0 : (hi & (1 << (t - 32))) !== 0

/**
 * Roll sequence from `pos` that paints every remaining floor tile, or null when
 * the search budget runs out. Greedy best-first: always extends the state with
 * the fewest unpainted tiles left, so it plunges toward a solution quickly.
 */
export function plan(
  level: Level,
  pos: number,
  painted: readonly number[],
  budget = BUDGET,
): number[] | null {
  let lo = 0
  let hi = 0
  let left = level.floors
  painted.forEach((v, t) => {
    if (!v) return
    const [a, b] = bit(t)
    lo |= a
    hi |= b
    left--
  })
  if (left <= 0) return []
  const nodes: Node[] = [{ pos, lo, hi, left, parent: -1, d: -1 }]
  const seen = new Set<string>([`${pos}.${lo}.${hi}`])
  const buckets: number[][] = Array.from({ length: level.floors + 1 }, () => [])
  ;(buckets[left] as number[]).push(0)
  let low = left
  for (let spent = 0; spent < budget; spent++) {
    while (low <= level.floors && (buckets[low] as number[]).length === 0) low++
    if (low > level.floors) return null
    const idx = (buckets[low] as number[]).pop() as number
    const cur = nodes[idx] as Node
    for (let d = 0; d < 4; d++) {
      const { end, path } = roll(level, cur.pos, d)
      if (end === cur.pos) continue
      let nlo = cur.lo
      let nhi = cur.hi
      let nleft = cur.left
      for (const t of path) {
        if (isSet(nlo, nhi, t)) continue
        const [a, b] = bit(t)
        nlo |= a
        nhi |= b
        nleft--
      }
      const key = `${end}.${nlo}.${nhi}`
      if (seen.has(key)) continue
      seen.add(key)
      nodes.push({ pos: end, lo: nlo, hi: nhi, left: nleft, parent: idx, d })
      if (nleft === 0) return rebuild(nodes, nodes.length - 1)
      ;(buckets[nleft] as number[]).push(nodes.length - 1)
      if (nleft < low) low = nleft
    }
  }
  return null
}

function rebuild(nodes: Node[], last: number): number[] {
  const dirs: number[] = []
  for (let i = last; nodes[i] && nodes[i]?.parent !== -1; i = (nodes[i] as Node).parent) {
    dirs.push((nodes[i] as Node).d)
  }
  return dirs.reverse()
}

/**
 * The fewest rolls from `pos` that paint every remaining floor tile
 * (breadth-first), or null when the search budget runs out first.
 */
export function shortest(
  level: Level,
  pos: number,
  painted: readonly number[],
  budget = BUDGET,
): number[] | null {
  let lo = 0
  let hi = 0
  let left = level.floors
  painted.forEach((v, t) => {
    if (!v) return
    const [a, b] = bit(t)
    lo |= a
    hi |= b
    left--
  })
  if (left <= 0) return []
  const nodes: Node[] = [{ pos, lo, hi, left, parent: -1, d: -1 }]
  const seen = new Set<string>([`${pos}.${lo}.${hi}`])
  for (let qi = 0; qi < nodes.length && qi < budget; qi++) {
    const cur = nodes[qi] as Node
    for (let d = 0; d < 4; d++) {
      const { end, path } = roll(level, cur.pos, d)
      if (end === cur.pos) continue
      let nlo = cur.lo
      let nhi = cur.hi
      let nleft = cur.left
      for (const t of path) {
        if (isSet(nlo, nhi, t)) continue
        const [a, b] = bit(t)
        nlo |= a
        nhi |= b
        nleft--
      }
      const key = `${end}.${nlo}.${nhi}`
      if (seen.has(key)) continue
      seen.add(key)
      nodes.push({ pos: end, lo: nlo, hi: nhi, left: nleft, parent: qi, d })
      if (nleft === 0) return rebuild(nodes, nodes.length - 1)
    }
  }
  return null
}

/**
 * One roll when no full plan was found in time: the one that paints the most
 * new tiles without walking into a sure dead end, or -1 if every roll does.
 */
export function greedy(level: Level, pos: number, painted: readonly number[]): number {
  let best = -1
  let gain = -1
  for (let d = 0; d < 4; d++) {
    const r = roll(level, pos, d)
    if (r.path.length === 0) continue
    const next = painted.slice()
    let g = 0
    for (const t of r.path) {
      if (!next[t]) g++
      next[t] = 1
    }
    if (stuck(level, r.end, next)) continue
    if (g > gain) {
      gain = g
      best = d
    }
  }
  return best
}

/**
 * The computer's hands for one level. `decide` returns the next roll direction,
 * or 'reset' when it has walked into a dead end (the level is not solvable from
 * here, so the player restarts it, as a person would). Hard searches for the
 * fewest rolls, normal too within a smaller budget; easy follows the first
 * plan it finds and slips. Out of search budget but not lost, it paints greedily.
 */
export class Pilot {
  private queue: number[] = []

  constructor(
    private readonly level: Level,
    private readonly difficulty: Difficulty,
    private readonly rng: Rng,
  ) {}

  /** Forget the plan (after a restart). */
  reset(): void {
    this.queue = []
  }

  decide(pos: number, painted: readonly number[]): number | 'reset' {
    if (this.queue.length === 0) {
      const found =
        (SHORTEST[this.difficulty] > 0
          ? shortest(this.level, pos, painted, SHORTEST[this.difficulty])
          : null) ?? plan(this.level, pos, painted)
      if (found && found.length > 0) this.queue = found
      else if (pos === this.level.start) this.queue = this.level.solution.slice()
      else if (stuck(this.level, pos, painted)) return 'reset'
      else {
        const d = greedy(this.level, pos, painted)
        return d >= 0 ? d : 'reset'
      }
    }
    if (this.rng.chance(SLIP[this.difficulty])) {
      this.queue = []
      return this.rng.int(0, 3)
    }
    return this.queue.shift() as number
  }
}
