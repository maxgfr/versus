import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { bfsNext, type Grid } from '../../engines/arena/index.ts'
import { type Fare, type Pt, stepsBetween, type World } from './rules.ts'

interface Skill {
  /** Seconds between target decisions. */
  react: number
  /** Drive speed multiplier. */
  pace: number
  /** Chance to pick a worse fare than the nearest one (a human-ish slip). */
  slip: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.7, pace: 0.7, slip: 0.35 },
  normal: { react: 0.4, pace: 0.9, slip: 0.12 },
  hard: { react: 0.2, pace: 1, slip: 0 },
}

/**
 * The computer driver: BFS to the nearest passenger it can reach first, then
 * BFS to that passenger's flag. Taxis are driven by the same joystick vector a
 * finger would give, so the bot never touches the rules.
 */
export class TaxiBot {
  private sk: Skill
  private left = 0
  private goal: Pt | null = null
  private goalFare = -1
  /** Whether the current goal is a flag (carrying) rather than a passenger to collect. */
  private goalCarry = false

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  /** The joystick vector to hold this step (|v| ≤ 1). */
  drive(w: World, grid: Grid, side: Side, dt: number): Pt {
    const me = w.taxis[side]
    this.left -= dt
    const fare = me.carry >= 0 ? w.fares.find((f) => f.id === me.carry) : undefined
    // The goal is stale once its passenger is gone or taken by the rival.
    const stale =
      this.goalFare >= 0 &&
      !w.fares.some((f) => f.id === this.goalFare && (f.carried < 0 || f.carried === side))
    if (this.left <= 0 || stale || (fare !== undefined) !== this.goalCarry) {
      this.left = this.sk.react * this.rng.range(0.8, 1.2)
      this.choose(w, grid, side, fare)
    }
    const goal = this.goal ?? { x: me.x, y: me.y }
    const next = bfsNext(grid, me.x, me.y, goal.x, goal.y)
    const dx = next.x - me.x
    const dy = next.y - me.y
    const m = Math.hypot(dx, dy)
    if (m < 4) return { x: 0, y: 0 }
    return { x: (dx / m) * this.sk.pace, y: (dy / m) * this.sk.pace }
  }

  private choose(w: World, grid: Grid, side: Side, carried: Fare | undefined): void {
    const me = w.taxis[side]
    const rival = w.taxis[side === 0 ? 1 : 0]
    if (carried) {
      this.goal = { x: carried.tx, y: carried.ty }
      this.goalFare = carried.id
      this.goalCarry = true
      return
    }
    this.goalCarry = false
    // Waiting passengers, ranked by how soon I get there (and whether the rival gets there first).
    const ranked = w.fares
      .filter((f) => f.carried < 0)
      .map((f) => {
        const p = { x: f.fx, y: f.fy }
        const mine = stepsBetween(grid, { x: me.x, y: me.y }, p)
        const theirs = stepsBetween(grid, { x: rival.x, y: rival.y }, p)
        const ours = mine < 0 ? 999 : mine
        const contested = theirs >= 0 && theirs < ours
        return { f, score: ours + (contested ? 6 : 0) }
      })
      .sort((a, b) => a.score - b.score)
    if (!ranked.length) {
      this.goal = null
      this.goalFare = -1
      return
    }
    const pick = this.rng.chance(this.sk.slip) && ranked.length > 1 ? ranked[1] : ranked[0]
    if (!pick) return
    this.goal = { x: pick.f.fx, y: pick.f.fy }
    this.goalFare = pick.f.id
  }
}
