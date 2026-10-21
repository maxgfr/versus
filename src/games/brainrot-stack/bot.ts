import type { Difficulty } from '../../core/game.ts'
import type { BodySnap, M } from '../../engines/ragdoll/index.ts'
import type { Rng } from '../../core/rng.ts'
import { ISLAND, clampHover, FALL_LINE, PIECES, towerTop } from './rules.ts'
import { simulateDrop } from './sim.ts'

export interface Plan {
  x: number
  a: number
}

interface Candidate extends Plan {
  score: number
}

/** Where the tower's top layer is, to aim around it. */
function topCentre(bodies: readonly BodySnap[]): number {
  const live = bodies.filter((b) => b.y < FALL_LINE)
  if (!live.length) return ISLAND.x
  const top = towerTop(live)
  const near = live.filter((b) => b.y < top + 150)
  return near.reduce((s, b) => s + b.x, 0) / near.length
}

/**
 * The computer tries drops in a throwaway world and keeps the calmest one. It
 * evaluates one candidate per call to `tick()` so the frame never stalls.
 */
export class Planner {
  private queue: Plan[] = []
  private tried: Candidate[] = []

  constructor(
    private Mx: M,
    private bodies: readonly BodySnap[],
    private k: number,
    private d: Difficulty,
    private rng: Rng,
  ) {
    const c = topCentre(bodies)
    const n = d === 'easy' ? 3 : d === 'normal' ? 6 : 9
    const spread = d === 'easy' ? 160 : 110
    const round = PIECES[k]?.shape.kind === 'circle'
    for (let i = 0; i < n; i++) {
      const x = clampHover(c + (i / (n - 1) - 0.5) * 2 * spread + rng.range(-12, 12), k)
      this.queue.push({ x, a: 0 })
      if (d === 'hard' && !round) this.queue.push({ x, a: Math.PI / 2 })
    }
  }

  get done(): boolean {
    return this.queue.length === 0
  }

  /** Simulate the next candidate. */
  tick(): void {
    const p = this.queue.shift()
    if (!p) return
    const o = simulateDrop(this.Mx, this.bodies, this.k, p.x, p.a)
    const gain = ISLAND.top - towerTop(o.bodies)
    this.tried.push({ ...p, score: (o.fallen ? 1e6 : 0) + o.moved + gain * 0.15 })
  }

  best(): Plan {
    const sorted = [...this.tried].sort((a, b) => a.score - b.score)
    const top = sorted[0] ?? { x: ISLAND.x, a: 0, score: 0 }
    if (this.d === 'easy') {
      // Wobbly hands: a random safe-ish pick, nudged off target.
      const pick = this.rng.chance(0.5) ? top : (this.rng.pick(sorted) ?? top)
      return { x: clampHover(pick.x + this.rng.range(-30, 30), this.k), a: pick.a }
    }
    if (this.d === 'normal')
      return { x: clampHover(top.x + this.rng.range(-10, 10), this.k), a: top.a }
    return top
  }
}

/** Synchronous convenience for tests: plan fully and return the move. */
export function choose(
  Mx: M,
  bodies: readonly BodySnap[],
  k: number,
  d: Difficulty,
  rng: Rng,
): Plan {
  const p = new Planner(Mx, bodies, k, d, rng)
  while (!p.done) p.tick()
  return p.best()
}
