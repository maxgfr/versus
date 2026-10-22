import type { Difficulty } from '../../core/game.ts'
import type { BodySnap, M } from '../../engines/ragdoll/index.ts'
import type { Rng } from '../../core/rng.ts'
import { ISLAND, clampHover, FALL_LINE, towerTop } from './rules.ts'
import { simulateDrop } from './sim.ts'

export interface Plan {
  x: number
  a: number
}

interface Candidate extends Plan {
  score: number
}

interface Tuning {
  /** Drop spots tried across the top of the tower. */
  spots: number
  /** How far either side of the top's centre they spread. */
  spread: number
  /** Turns tried for each spot (the rotate button turns by eighths, the bot by quarters). */
  turns: readonly number[]
  /** Hand error on the chosen spot (± units). */
  wobble: number
  /** How fast the claw follows the target while it sways (higher = sharper timing). */
  hand: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { spots: 4, spread: 160, turns: [0], wobble: 30, hand: 4 },
  normal: { spots: 7, spread: 120, turns: [0, Math.PI], wobble: 5, hand: 9 },
  hard: {
    spots: 7,
    spread: 110,
    turns: [0, Math.PI / 2, Math.PI, -Math.PI / 2],
    wobble: 0,
    hand: 16,
  },
}

/** Where the tower's top layer is, to aim around it. */
function topCentre(bodies: readonly BodySnap[]): number {
  const live = bodies.filter((b) => b.y < FALL_LINE)
  if (!live.length) return ISLAND.x
  const top = towerTop(live)
  const near = live.filter((b) => b.y < top + 150)
  if (!near.length) return ISLAND.x
  return near.reduce((s, b) => s + b.x, 0) / near.length
}

/**
 * The computer tries drops (spots across the top, and turns) in a throwaway
 * world with the real piece shapes and keeps the calmest one: nothing falls,
 * the tower barely shakes, and it stays low. It evaluates one candidate per
 * call to `tick()` so the frame never stalls.
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
    const t = TUNING[d]
    const c = topCentre(bodies)
    for (let i = 0; i < t.spots; i++) {
      const x = clampHover(c + (i / (t.spots - 1) - 0.5) * 2 * t.spread + rng.range(-12, 12), k)
      for (const a of t.turns) this.queue.push({ x, a })
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
    const t = TUNING[this.d]
    if (this.d === 'easy') {
      // Wobbly hands: a random safe-ish pick, nudged off target.
      const pick = this.rng.chance(0.5) ? top : (this.rng.pick(sorted) ?? top)
      return { x: clampHover(pick.x + this.rng.range(-t.wobble, t.wobble), this.k), a: pick.a }
    }
    return { x: clampHover(top.x + this.rng.range(-t.wobble, t.wobble), this.k), a: top.a }
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
