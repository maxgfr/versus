import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Board, COLS, DX, DY, floodFrom, free, ROWS } from './rules.ts'

interface Skill {
  /** Chance per tick of a random legal turn instead of the best one. */
  mistake: number
  /** Look this many turns ahead (1 = the next cell only). */
  depth: 1 | 2
  /** Steer clear of the cells a rival head can reach next tick (head-on crashes). */
  wary: boolean
  /** Fight for space: score moves by the cells it reaches before any rival (Voronoi). */
  territory: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { mistake: 0.25, depth: 1, wary: false, territory: false },
  normal: { mistake: 0.03, depth: 1, wary: true, territory: false },
  hard: { mistake: 0, depth: 2, wary: true, territory: true },
}

/** Turn choices: straight first, so ties keep the bike going. */
const TURNS = [0, -1, 1] as const

const N = COLS * ROWS
// Scratch buffers for the territory search (bots only run on the host, one at a time).
const distMe = new Int16Array(N)
const distThem = new Int16Array(N)
const queue = new Int32Array(N)

/** Breadth-first distances over free cells from `sources` into `dist` (-1 = unreached). */
function bfs(b: Board, sources: number[], dist: Int16Array, block: number): void {
  dist.fill(-1)
  let head = 0
  let tail = 0
  for (const s of sources) {
    dist[s] = 0
    queue[tail++] = s
  }
  while (head < tail) {
    const cur = queue[head++] as number
    const cx = cur % COLS
    const cy = (cur - cx) / COLS
    const d = (dist[cur] as number) + 1
    for (let k = 0; k < 4; k++) {
      const nx = cx + (DX[k] ?? 0)
      const ny = cy + (DY[k] ?? 0)
      if (!free(b, nx, ny)) continue
      const ni = ny * COLS + nx
      if (ni === block || dist[ni] !== -1) continue
      dist[ni] = d
      queue[tail++] = ni
    }
  }
}

/**
 * Space a bike claims after moving into (x, y): the free cells it reaches
 * strictly before every rival head (rivals move as fast as it does), and
 * whether any rival can reach its space at all.
 */
export function territory(
  b: Board,
  id: number,
  x: number,
  y: number,
): { mine: number; contested: boolean } {
  const me = b.bikes[id]
  const at = y * COLS + x
  const rivals: number[] = []
  for (const k of b.bikes) {
    if (!k.alive || !me || k.side === me.side) continue
    // A rival head's next cells are its frontier (the head cell itself is a trail).
    for (let d = 0; d < 4; d++) {
      const nx = k.x + (DX[d] ?? 0)
      const ny = k.y + (DY[d] ?? 0)
      if (free(b, nx, ny)) rivals.push(ny * COLS + nx)
    }
  }
  bfs(b, [at], distMe, -1)
  bfs(b, rivals, distThem, at)
  let mine = 0
  let contested = false
  for (let i = 0; i < N; i++) {
    const m = distMe[i] as number
    if (m < 0) continue
    const t = distThem[i] as number
    if (t >= 0) contested = true
    // The rival's frontier is one move ahead of its head: it gets there at t + 1.
    if (t < 0 || m < t + 1) mine++
  }
  return { mine, contested }
}

/** Can a rival head move into cell (x, y) on the next tick? */
function rivalNext(b: Board, side: number, x: number, y: number): boolean {
  for (const k of b.bikes) {
    if (!k.alive || k.side === side) continue
    if (Math.abs(k.x - x) + Math.abs(k.y - y) === 1) return true
  }
  return false
}

/**
 * The computer rider for one bike. Each tick it scores straight, left and right.
 * Easy and normal look at how much open space each move leaves (a flood fill);
 * normal also keeps out of a rival head's reach. Hard fights for space: it
 * counts the cells it would reach before the rival (cutting it off when it
 * can), and once the two are walled apart it packs its own room tightly.
 */
export class SnakeBot {
  constructor(
    private rng: Rng,
    private sk: Skill,
  ) {}

  static of(rng: Rng, d: Difficulty): SnakeBot {
    return new SnakeBot(rng, SKILL[d])
  }

  /** The turn to queue for the coming tick: +1 right, -1 left, 0 straight. */
  choose(b: Board, id: number): number {
    const k = b.bikes[id]
    if (!k || !k.alive || k.q.length > 0) return 0
    const legal: { t: number; s: number }[] = []
    for (const t of TURNS) {
      const dir = (k.dir + t + 4) % 4
      const nx = k.x + (DX[dir] ?? 0)
      const ny = k.y + (DY[dir] ?? 0)
      if (!free(b, nx, ny)) continue
      let s: number
      if (this.sk.territory) {
        const tr = territory(b, id, nx, ny)
        // Walled apart: territory is just room, so pack it the careful way.
        s = tr.contested ? tr.mine : this.ahead(b, nx, ny, dir)
      } else s = this.sk.depth === 2 ? this.ahead(b, nx, ny, dir) : floodFrom(b, nx, ny)
      // A cell a rival head can also take next tick risks a head-on: both crash.
      if (this.sk.wary && rivalNext(b, k.side, nx, ny)) s -= 60
      legal.push({ t, s })
    }
    if (!legal.length) return 0
    if (this.rng.chance(this.sk.mistake)) return legal[this.rng.int(0, legal.length - 1)]?.t ?? 0
    // Going straight unless a turn opens clearly more space.
    const straight = legal.find((o) => o.t === 0) ?? legal[0] ?? { t: 0, s: 0 }
    let best = straight
    for (const o of legal) if (o.s > best.s + 4) best = o
    return best.t
  }

  /** The most open space reachable after one more turn from the cell (x, y), heading `dir`. */
  private ahead(b: Board, x: number, y: number, dir: number): number {
    let best = 0
    for (const t of TURNS) {
      const d2 = (dir + t + 4) % 4
      const nx = x + (DX[d2] ?? 0)
      const ny = y + (DY[d2] ?? 0)
      if (!free(b, nx, ny)) continue
      best = Math.max(best, floodFrom(b, nx, ny, 300, y * COLS + x))
    }
    return best
  }
}
