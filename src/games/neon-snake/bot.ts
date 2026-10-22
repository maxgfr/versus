import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Board, type Cell, COLS, DX, DY, inside, reverse, ROWS } from './rules.ts'

interface Skill {
  /** How much the bot wants to reach a dot (vs. keeping open space). */
  food: number
  /** Chance per tick of a random legal turn. */
  mistake: number
  /** Random wobble on each option's score. */
  noise: number
  /** Penalty for a cell the rival's head can also reach next tick (a head-on draw). */
  contest: number
  /** Weight of territory: cells it reaches before the rival (Voronoi). 0 = ignores the rival. */
  territory: number
  /** Extra cells of slack it wants beyond its own length before calling a pocket safe. */
  slack: number
}

export const SKILL: Record<Difficulty, Skill> = {
  easy: { food: 2, mistake: 0.12, noise: 10, contest: 0, territory: 0, slack: -1 },
  normal: { food: 4, mistake: 0.01, noise: 0.6, contest: 150, territory: 0.7, slack: 1 },
  hard: { food: 4, mistake: 0, noise: 0.2, contest: 300, territory: 1.6, slack: 3 },
}

const N = COLS * ROWS

/**
 * Solid cells for the bot's lookahead: walls and bodies. Tails that move away
 * next tick still count as solid (a little conservative, never fatal).
 */
function solids(b: Board, g: Uint8Array): Uint8Array {
  g.set(WALLS)
  for (const s of b.snakes) for (const c of s.body) g[c.y * COLS + c.x] = 1
  return g
}

/** The board's own walls (the side blocks), computed once. */
const WALLS = new Uint8Array(N)
for (let y = 0; y < ROWS; y++)
  for (let x = 0; x < COLS; x++) if (!inside({ x, y })) WALLS[y * COLS + x] = 1

const open = (g: Uint8Array, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < COLS && y < ROWS && g[y * COLS + x] === 0

/** Cells reachable from (x, y) over open cells not yet `seen`, up to `cap` (marks them seen). */
function flood(g: Uint8Array, x: number, y: number, cap: number, seen: Uint8Array): number {
  if (!open(g, x, y)) return 0
  const q = [y * COLS + x]
  seen[y * COLS + x] = 1
  for (let i = 0; i < q.length && q.length < cap; i++) {
    const c = q[i] as number
    const cx = c % COLS
    const cy = (c - cx) / COLS
    for (let d = 0; d < 4; d++) {
      const nx = cx + (DX[d] ?? 0)
      const ny = cy + (DY[d] ?? 0)
      if (!open(g, nx, ny) || seen[ny * COLS + nx]) continue
      seen[ny * COLS + nx] = 1
      q.push(ny * COLS + nx)
    }
  }
  return Math.min(q.length, cap)
}

/** BFS distances from `from` over open cells (-1 = unreachable). */
function dist(g: Uint8Array, from: Cell[], out: Int16Array): void {
  out.fill(-1)
  const q: number[] = []
  for (const c of from) {
    if (!open(g, c.x, c.y)) continue
    out[c.y * COLS + c.x] = 0
    q.push(c.y * COLS + c.x)
  }
  for (let i = 0; i < q.length; i++) {
    const c = q[i] as number
    const cx = c % COLS
    const cy = (c - cx) / COLS
    const dc = out[c] as number
    for (let d = 0; d < 4; d++) {
      const nx = cx + (DX[d] ?? 0)
      const ny = cy + (DY[d] ?? 0)
      if (!open(g, nx, ny) || (out[ny * COLS + nx] as number) >= 0) continue
      out[ny * COLS + nx] = dc + 1
      q.push(ny * COLS + nx)
    }
  }
}

/**
 * The computer player for one snake. Every tick it scores the directions it
 * may take, using the real rules: a pocket too small to hold its body is a
 * trap; the nearest dot by BFS pulls it; a cell the rival's head can also
 * reach is a head-on draw. On hard it also looks at territory: the cells it
 * would reach before the rival (Voronoi), so it cuts the rival off instead of
 * just grazing.
 */
export class NeonBot {
  private seen = new Uint8Array(N)
  private grid = new Uint8Array(N)
  private mine = new Int16Array(N)
  private theirs = new Int16Array(N)

  constructor(
    private rng: Rng,
    private sk: Skill,
  ) {}

  static of(rng: Rng, d: Difficulty): NeonBot {
    return new NeonBot(rng, SKILL[d])
  }

  /** The direction to ask for, or null to keep the current one. */
  choose(b: Board, id: number): number | null {
    const s = b.snakes[id]
    const head = s?.body[0]
    if (!s || !s.alive || !head) return null
    const rival = b.snakes[1 - id]
    const rh = rival?.alive ? rival.body[0] : undefined
    const g = solids(b, this.grid)
    // Where the rival's head may be next tick.
    const rivalNext: Cell[] = []
    if (rh && rival)
      for (let d = 0; d < 4; d++) {
        if (d === reverse(rival.dir)) continue
        const x = rh.x + (DX[d] ?? 0)
        const y = rh.y + (DY[d] ?? 0)
        if (open(g, x, y)) rivalNext.push({ x, y })
      }
    if (this.sk.territory > 0 && rivalNext.length) dist(g, rivalNext, this.theirs)
    const opts: { d: number; score: number }[] = []
    for (let d = 0; d < 4; d++) {
      if (d === reverse(s.dir)) continue
      const nx = head.x + (DX[d] ?? 0)
      const ny = head.y + (DY[d] ?? 0)
      if (!open(g, nx, ny)) continue
      // Step in, then measure: the head's own cell now counts as body.
      g[ny * COLS + nx] = 1
      // The biggest pocket next to the new head (neighbours in one pocket are flooded once).
      let room = 0
      this.seen.fill(0)
      for (let e = 0; e < 4; e++) {
        const ex = nx + (DX[e] ?? 0)
        const ey = ny + (DY[e] ?? 0)
        if (!open(g, ex, ey) || this.seen[ey * COLS + ex]) continue
        room = Math.max(room, flood(g, ex, ey, 220, this.seen))
      }
      const need = s.body.length + this.sk.slack
      const trap = room < need
      let territory = 0
      if (this.sk.territory > 0) {
        // Ticks from now: my next cells are reached at m + 2, the rival's at t + 1.
        dist(g, neighbours(g, { x: nx, y: ny }), this.mine)
        if (rivalNext.length) {
          for (let i = 0; i < N; i++) {
            const m = this.mine[i] as number
            const t = this.theirs[i] as number
            if (m >= 0 && (t < 0 || m + 2 < t + 1)) territory++
            else if (t >= 0 && (m < 0 || t + 1 < m + 2)) territory--
          }
        }
      }
      g[ny * COLS + nx] = 0
      const food = foodSteps(g, b, nx, ny, this.seen)
      const contested = rivalNext.some((c) => c.x === nx && c.y === ny)
      const score =
        (trap ? -400 - (need - room) * 4 : 0) +
        (contested ? -this.sk.contest : 0) +
        Math.min(room, 220) * 0.1 +
        territory * this.sk.territory * 0.25 +
        (food >= 0 ? (80 - Math.min(food, 80)) * this.sk.food : -40) +
        this.rng.range(-this.sk.noise, this.sk.noise)
      opts.push({ d, score })
    }
    if (!opts.length) return null
    if (this.rng.chance(this.sk.mistake)) return opts[this.rng.int(0, opts.length - 1)]?.d ?? null
    let best = opts[0]
    for (const o of opts) if (best && o.score > best.score) best = o
    return best?.d ?? null
  }
}

function neighbours(g: Uint8Array, c: Cell): Cell[] {
  const out: Cell[] = []
  for (let d = 0; d < 4; d++) {
    const x = c.x + (DX[d] ?? 0)
    const y = c.y + (DY[d] ?? 0)
    if (open(g, x, y)) out.push({ x, y })
  }
  return out
}

/** Steps from (x, y) to the nearest dot over open cells (0 = on one), -1 if none is reachable. */
function foodSteps(g: Uint8Array, b: Board, x: number, y: number, seen: Uint8Array): number {
  const isDot = (cx: number, cy: number) => b.dots.some((d) => d.x === cx && d.y === cy)
  if (isDot(x, y)) return 0
  seen.fill(0)
  seen[y * COLS + x] = 1
  let frontier = [y * COLS + x]
  for (let steps = 1; frontier.length; steps++) {
    const next: number[] = []
    for (const c of frontier) {
      const cx = c % COLS
      const cy = (c - cx) / COLS
      for (let d = 0; d < 4; d++) {
        const nx = cx + (DX[d] ?? 0)
        const ny = cy + (DY[d] ?? 0)
        if (!open(g, nx, ny) || seen[ny * COLS + nx]) continue
        seen[ny * COLS + nx] = 1
        if (isDot(nx, ny)) return steps
        next.push(ny * COLS + nx)
      }
    }
    frontier = next
  }
  return -1
}
