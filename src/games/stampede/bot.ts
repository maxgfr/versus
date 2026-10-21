import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'
import { animalAt, EDGE_PAD, SPEED, type World } from './rules.ts'

interface Skill {
  /** Seconds between plans. */
  react: number
  /** How far ahead (s) the bot projects the herds. */
  horizon: number
  /** Joystick strength. */
  pace: number
  /** Random noise on each spot's score (world units): sloppier judgement when larger. */
  noise: number
  /** Chance per plan to wander to a random spot instead (a slip). */
  slip: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.5, horizon: 0.9, pace: 0.8, noise: 80, slip: 0.12 },
  normal: { react: 0.3, horizon: 1.3, pace: 0.95, noise: 25, slip: 0.03 },
  hard: { react: 0.18, horizon: 1.6, pace: 1, noise: 0, slip: 0 },
}

/** Spots the bot considers: a coarse grid over the arena. */
const SPOTS: { x: number; y: number }[] = []
for (let x = EDGE_PAD + 10; x <= W - EDGE_PAD - 10; x += 110)
  for (let y = 60; y <= H - 60; y += 120) SPOTS.push({ x, y })

/** How far a spot is from any animal over the next `horizon` seconds, capped. */
const CAP = 260

/**
 * The computer blob: projects every herd's path (the schedule is deterministic,
 * so warned herds count too), then heads for the reachable spot it stays
 * farthest from over the next moment.
 */
export class StampedeBot {
  private sk: Skill
  private left = 0
  private goal = { x: 0, y: 0 }

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  /** The joystick vector to hold this step (|v| ≤ 1). */
  drive(w: World, side: Side, dt: number): { x: number; y: number } {
    const me = w.drivers[side]
    if (me.out) return { x: 0, y: 0 }
    this.left -= dt
    if (this.left <= 0) {
      this.left = this.sk.react * this.rng.range(0.8, 1.2)
      this.goal = this.plan(w, side)
    }
    const dx = this.goal.x - me.x
    const dy = this.goal.y - me.y
    const m = Math.hypot(dx, dy)
    if (m < 8) return { x: 0, y: 0 }
    return { x: (dx / m) * this.sk.pace, y: (dy / m) * this.sk.pace }
  }

  private plan(w: World, side: Side): { x: number; y: number } {
    const me = w.drivers[side]
    if (this.rng.chance(this.sk.slip)) {
      const spot = this.rng.pick(SPOTS) as { x: number; y: number }
      return { x: spot.x, y: spot.y }
    }
    let best = { x: me.x, y: me.y }
    let bestScore = -Infinity
    for (const spot of SPOTS) {
      const reach = Math.hypot(spot.x - me.x, spot.y - me.y)
      // Only spots I can walk to before the herds get there.
      if (reach > SPEED * this.sk.horizon) continue
      const clear = this.clearance(w, spot)
      const score =
        Math.min(clear, CAP) -
        0.12 * reach +
        (this.sk.noise ? this.rng.range(-this.sk.noise, this.sk.noise) : 0)
      if (score > bestScore) {
        bestScore = score
        best = spot
      }
    }
    // Staying put is always an option (and wins ties with the grid).
    const here = Math.min(this.clearance(w, me), CAP)
    if (here >= bestScore) best = { x: me.x, y: me.y }
    return best
  }

  /** The closest any animal of any herd (warned or running) gets to a spot in the next `horizon` s. */
  private clearance(w: World, p: { x: number; y: number }): number {
    let min = Infinity
    const steps = Math.ceil(this.sk.horizon / 0.1)
    for (let k = 0; k <= steps; k++) {
      const t = w.rt + (k / steps) * this.sk.horizon
      for (const h of w.herds) {
        for (let i = 0; i < h.n; i++) {
          const a = animalAt(h, i, t)
          const d = Math.hypot(a.x - p.x, a.y - p.y)
          if (d < min) min = d
        }
      }
    }
    return min
  }
}
