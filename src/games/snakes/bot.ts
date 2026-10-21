import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Board, COLS, DX, DY, floodFrom, free } from './rules.ts'

interface Skill {
  /** Chance per tick of a random legal turn instead of the best one. */
  mistake: number
  /** Look this many turns ahead (1 = the next cell only). */
  depth: 1 | 2
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { mistake: 0.25, depth: 1 },
  normal: { mistake: 0.03, depth: 1 },
  hard: { mistake: 0, depth: 2 },
}

/** Turn choices: straight first, so ties keep the bike going. */
const TURNS = [0, -1, 1] as const

/**
 * The computer rider for one bike. Each tick it scores straight, left and right
 * by how much open space the bike would still have (a flood fill from the cell
 * it moves into), so it walks away from dead ends and into the open.
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
      const s = this.sk.depth === 2 ? this.ahead(b, nx, ny, dir) : floodFrom(b, nx, ny)
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
