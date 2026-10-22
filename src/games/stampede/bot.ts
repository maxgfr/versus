import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'
import { animalAt, DASH_CD, EDGE_PAD, HIT_D, SPEED, type Drive, type World } from './rules.ts'

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
  /** Check the walk over there too, not just the spot (no strolling through a herd). */
  path: boolean
  /** Sprint out of a herd's way when it is about to hit. */
  escape: boolean
  /** Sprint into a rival standing by a herd's path to shove it in. */
  shove: boolean
}

const SKILL: Record<Difficulty, Skill> = {
  easy: {
    react: 0.5,
    horizon: 0.9,
    pace: 0.8,
    noise: 80,
    slip: 0.12,
    path: false,
    escape: false,
    shove: false,
  },
  normal: {
    react: 0.22,
    horizon: 1.4,
    pace: 1,
    noise: 15,
    slip: 0.02,
    path: true,
    escape: true,
    shove: false,
  },
  hard: {
    react: 0.12,
    horizon: 1.7,
    pace: 1,
    noise: 0,
    slip: 0,
    path: true,
    escape: true,
    shove: true,
  },
}

/** Spots the bot considers: a coarse grid over the arena. */
const SPOTS: { x: number; y: number }[] = []
for (let x = EDGE_PAD + 10; x <= W - EDGE_PAD - 10; x += 110)
  for (let y = 60; y <= H - 60; y += 120) SPOTS.push({ x, y })

/** How far a spot is from any animal over the next `horizon` seconds, capped. */
const CAP = 260

/** The closest any animal gets to a point that moves from `a` toward `b` at `speed`, over `horizon` s. */
export function pathClearance(
  w: World,
  a: { x: number; y: number },
  b: { x: number; y: number },
  speed: number,
  horizon: number,
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const arrive = len / speed
  let min = Infinity
  const steps = Math.ceil(horizon / 0.08)
  for (let k = 0; k <= steps; k++) {
    const dt = (k / steps) * horizon
    const f = arrive > 0 ? Math.min(1, dt / arrive) : 1
    const px = a.x + dx * f
    const py = a.y + dy * f
    const t = w.rt + dt
    for (const h of w.herds) {
      for (let i = 0; i < h.n; i++) {
        const p = animalAt(h, i, t)
        const d = Math.hypot(p.x - px, p.y - py)
        if (d < min) min = d
      }
    }
  }
  return min
}

/**
 * The computer blob: projects every herd's path (warned herds are announced
 * on screen, so they count too), then heads for the reachable spot it stays
 * farthest from over the next moment. Normal and hard check the walk there as
 * well, and sprint clear when a herd is about to hit; hard also sprints into a
 * rival standing by a herd's path.
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

  /** The joystick vector to hold this step (|v| ≤ 1), with a sprint flag. */
  drive(w: World, side: Side, dt: number): Drive {
    const me = w.drivers[side]
    if (me.out) return { x: 0, y: 0 }
    this.left -= dt
    const ready = w.rt - me.dashT >= DASH_CD
    if (this.left <= 0) {
      this.left = this.sk.react * this.rng.range(0.8, 1.2)
      this.goal = this.plan(w, side)
      if (ready && this.sk.shove) {
        const shove = this.shove(w, side)
        if (shove) return shove
      }
    }
    const dx = this.goal.x - me.x
    const dy = this.goal.y - me.y
    const m = Math.hypot(dx, dy)
    if (m < 8) return { x: 0, y: 0 }
    // Escape: staying on course meets an animal within a fraction of a second.
    if (this.sk.escape && ready && m > 60) {
      const soon = pathClearance(w, me, this.goal, SPEED, 0.35)
      if (soon < HIT_D + 10) return { x: dx / m, y: dy / m, dash: true }
    }
    return { x: (dx / m) * this.sk.pace, y: (dy / m) * this.sk.pace }
  }

  /** A sprint at the rival when a shove would put it in a herd's way. */
  private shove(w: World, side: Side): Drive | null {
    const me = w.drivers[side]
    const foe = w.drivers[side === 0 ? 1 : 0]
    if (foe.out || w.rt < foe.invT) return null
    const dx = foe.x - me.x
    const dy = foe.y - me.y
    const d = Math.hypot(dx, dy)
    if (d > 190 || d < 1) return null
    // Where the shove would land it, and is a herd about to run over that spot?
    const land = { x: foe.x + (dx / d) * 95, y: foe.y + (dy / d) * 95 }
    if (pathClearance(w, land, land, 1, 0.6) > HIT_D) return null
    // Not at the cost of running into the herd itself.
    if (pathClearance(w, me, foe, SPEED, 0.4) < HIT_D + 20) return null
    return { x: dx / d, y: dy / d, dash: true }
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
      const clear = this.sk.path
        ? pathClearance(w, me, spot, SPEED * this.sk.pace, this.sk.horizon)
        : this.clearance(w, spot)
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
    return pathClearance(w, p, p, 1, this.sk.horizon)
  }
}
