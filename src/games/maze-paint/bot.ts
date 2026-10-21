import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Level, roll } from './rules.ts'

/** Seconds between the computer's rolls. */
export const PACE: Record<Difficulty, number> = { easy: 1.3, normal: 0.85, hard: 0.5 }
/** Chance per roll that the computer rolls at random instead of following its plan. */
const SLIP: Record<Difficulty, number> = { easy: 0.2, normal: 0.04, hard: 0 }
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

// Painted tiles as two 26-bit words (levels have at most 49 tiles).
const bit = (t: number): [number, number] => (t < 26 ? [1 << t, 0] : [0, 1 << (t - 26)])
const isSet = (lo: number, hi: number, t: number): boolean =>
  t < 26 ? (lo & (1 << t)) !== 0 : (hi & (1 << (t - 26))) !== 0

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
 * The computer's hands for one level. `decide` returns the next roll direction,
 * or 'reset' when it has walked into a dead end (the level is not solvable from
 * here, so the player restarts it, as a person would).
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
      const found = plan(this.level, pos, painted)
      if (found && found.length > 0) this.queue = found
      else if (pos === this.level.start) this.queue = this.level.solution.slice()
      else return 'reset'
    }
    if (this.rng.chance(SLIP[this.difficulty])) {
      this.queue = []
      return this.rng.int(0, 3)
    }
    return this.queue.shift() as number
  }
}
