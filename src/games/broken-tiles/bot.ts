import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Board, BODY, COLS, INTACT, nearestTile, ROWS, tileCentre } from './rules.ts'

interface Skill {
  /** Seconds between re-plans of the goal tile. */
  every: number
  /** How many tile steps ahead a goal's room is counted over. */
  depth: number
  /** Random wobble on the goal score: bigger means worse choices. */
  noise: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { every: 0.7, depth: 1, noise: 4 },
  normal: { every: 0.25, depth: 3, noise: 1 },
  hard: { every: 0.08, depth: 5, noise: 0.2 },
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Breadth-first search over intact tiles from `start` (the start tile itself is
 * always allowed). `first[i]` is the first tile to step onto on the way to i.
 */
function search(st: number[], start: number): { dist: number[]; first: number[] } {
  const n = COLS * ROWS
  const dist = Array.from({ length: n }, () => -1)
  const first = Array.from({ length: n }, () => -1)
  dist[start] = 0
  const q = [start]
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] ?? start
    const c = cur % COLS
    const r = Math.floor(cur / COLS)
    for (const [dc, dr] of DIRS) {
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue
      const ni = nr * COLS + nc
      if (dist[ni] !== -1 || st[ni] !== INTACT) continue
      dist[ni] = (dist[cur] ?? 0) + 1
      first[ni] = cur === start ? ni : (first[cur] ?? -1)
      q.push(ni)
    }
  }
  return { dist, first }
}

/** How many intact tiles can be reached from tile `from` within `depth` steps. */
function roomFrom(st: number[], from: number, depth: number): number {
  const seen = new Map<number, number>([[from, 0]])
  const q = [from]
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi] ?? from
    const d = seen.get(cur) ?? 0
    if (d >= depth) continue
    const c = cur % COLS
    const r = Math.floor(cur / COLS)
    for (const [dc, dr] of DIRS) {
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue
      const ni = nr * COLS + nc
      if (seen.has(ni) || st[ni] !== INTACT) continue
      seen.set(ni, d + 1)
      q.push(ni)
    }
  }
  return seen.size
}

/** Stick vector steering from (x, y) toward tile `i`'s centre, eased out near it. */
function aim(x: number, y: number, i: number): { x: number; y: number } {
  if (i < 0) return { x: 0, y: 0 }
  const t = tileCentre(i)
  const dx = t.x - x
  const dy = t.y - y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return { x: 0, y: 0 }
  const m = Math.min(1, d / BODY)
  return { x: (dx / d) * m, y: (dy / d) * m }
}

/** The intact tile whose centre is nearest (x, y), or -1 when none is left. */
function nearestIntact(st: number[], x: number, y: number): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < st.length; i++) {
    if (st[i] !== INTACT) continue
    const t = tileCentre(i)
    const d = (t.x - x) ** 2 + (t.y - y) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * The computer player for one side. It keeps picking a goal tile with plenty
 * of intact floor around it (a BFS over intact tiles, so it prefers areas that
 * will last), avoids crowding the rival, walks the shortest path over intact
 * tiles only, and re-plans as it arrives.
 */
export class TileBot {
  private left = 0
  private goal = -1

  constructor(
    private rng: Rng,
    private sk: Skill,
  ) {}

  static of(rng: Rng, d: Difficulty): TileBot {
    return new TileBot(rng, SKILL[d])
  }

  /** The stick vector for this step (magnitude at most 1). */
  drive(b: Board, side: Side, dt: number): { x: number; y: number } {
    const me = b.p[side]
    if (!me.alive) return { x: 0, y: 0 }
    this.left -= dt
    const here = nearestTile(me.x, me.y)
    const s = search(b.st, here)
    const ok = this.goal >= 0 && (s.dist[this.goal] ?? -1) > 0
    if (!ok || this.left <= 0 || this.arrived(me.x, me.y)) this.pick(b, side, here, s.dist)
    const next = this.goal >= 0 ? (s.first[this.goal] ?? -1) : -1
    if (next >= 0) return aim(me.x, me.y, next)
    // No intact path (boxed in or unlucky): head for the nearest intact tile in a straight line.
    return aim(me.x, me.y, nearestIntact(b.st, me.x, me.y))
  }

  private arrived(x: number, y: number): boolean {
    if (this.goal < 0) return false
    const c = tileCentre(this.goal)
    return Math.hypot(c.x - x, c.y - y) < BODY * 0.5
  }

  private pick(b: Board, side: Side, here: number, dist: number[]): void {
    const foe = side === 0 ? b.p[1] : b.p[0]
    const foeTile = foe.alive ? nearestTile(foe.x, foe.y) : -1
    let best = -1
    let bestScore = -Infinity
    for (let i = 0; i < COLS * ROWS; i++) {
      const d = dist[i] ?? -1
      if (i === here || d < 0) continue
      let score =
        roomFrom(b.st, i, this.sk.depth) - 0.8 * d + this.rng.range(-this.sk.noise, this.sk.noise)
      // Two bots heading for the same island just box each other in.
      if (foeTile >= 0 && Math.abs((i % COLS) - (foeTile % COLS)) <= 1) {
        if (Math.abs(Math.floor(i / COLS) - Math.floor(foeTile / COLS)) <= 1) score -= 6
      }
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    this.goal = best
    this.left = this.sk.every
  }
}
