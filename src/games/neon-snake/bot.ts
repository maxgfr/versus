import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Board, DX, DY, foodDistance, passable, room } from './rules.ts'

interface Skill {
  /** How much the bot wants to reach a dot (vs. keeping open space). */
  food: number
  /** Chance per tick of a random legal turn. */
  mistake: number
  /** Random wobble on each option's score. */
  noise: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { food: 2, mistake: 0.2, noise: 8 },
  normal: { food: 4, mistake: 0.03, noise: 1 },
  hard: { food: 6, mistake: 0, noise: 0.2 },
}

/**
 * The computer player for one snake. Every tick it scores the directions it
 * may take: open space it can flood into (a dead end too short to hold the
 * whole body is a trap), plus how close the nearest dot is by BFS.
 */
export class NeonBot {
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
    const opts: { d: number; score: number }[] = []
    for (let d = 0; d < 4; d++) {
      if (d === (s.dir + 2) % 4) continue
      const nx = head.x + (DX[d] ?? 0)
      const ny = head.y + (DY[d] ?? 0)
      if (!passable(b, nx, ny)) continue
      const open = room(b, nx, ny, 160)
      const food = foodDistance(b, nx, ny)
      const trap = open < s.body.length
      // Room only keeps it out of traps; the rest of the score goes to the nearest dot.
      // A cell the rival's head can reach too is a coin toss: two heads there is a draw.
      const contested = rh !== undefined && Math.abs(rh.x - nx) + Math.abs(rh.y - ny) === 1
      const score =
        (trap ? -400 : 0) +
        (contested ? -30 : 0) +
        Math.min(open, 160) * 0.1 +
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
