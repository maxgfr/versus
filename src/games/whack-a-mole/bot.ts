import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import type { Cell } from './index.ts'
import { type PopKind } from './rules.ts'

/**
 * Computer whacker for one half. It sees each pop, decides whether to go for
 * it (it sometimes misses a mole, and sometimes mistakes a bunny for a mole),
 * and taps after a reaction delay that depends on difficulty.
 */

const REACTION: Record<Difficulty, [number, number]> = {
  easy: [0.6, 0.85],
  normal: [0.4, 0.58],
  hard: [0.3, 0.46],
}
const MISS_MOLE: Record<Difficulty, number> = { easy: 0.25, normal: 0.08, hard: 0.03 }
const HIT_BUNNY: Record<Difficulty, number> = { easy: 0.15, normal: 0.04, hard: 0.01 }

interface Plan {
  hole: number
  at: number
  tapAt: number
}

export class MoleBot {
  private plans: Plan[] = []
  private seen = new Set<string>()

  constructor(
    private rng: Rng,
    private d: Difficulty,
  ) {}

  /** Holes this bot taps this step. `cells` is its half, as it stands. */
  drive(time: number, cells: (Cell | null)[]): number[] {
    cells.forEach((c, hole) => {
      if (!c || c.st !== 'up') return
      const key = `${hole}@${c.at}`
      if (this.seen.has(key)) return
      this.seen.add(key)
      if (this.wants(c.kind)) {
        const [lo, hi] = REACTION[this.d]
        this.plans.push({ hole, at: c.at, tapAt: c.at + this.rng.range(lo, hi) })
      }
    })
    const out: number[] = []
    this.plans = this.plans.filter((p) => {
      if (time < p.tapAt) return true
      const c = cells[p.hole]
      if (c && c.st === 'up' && c.at === p.at) out.push(p.hole)
      return false
    })
    return out
  }

  /** Whether to go for a pop of this kind at all. */
  private wants(kind: PopKind): boolean {
    return kind === 'mole'
      ? !this.rng.chance(MISS_MOLE[this.d])
      : this.rng.chance(HIT_BUNNY[this.d])
  }
}
