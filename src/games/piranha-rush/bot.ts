import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import {
  EDGE_PAD,
  fishAt,
  HOME,
  inRiver,
  RIVER_BOT,
  RIVER_TOP,
  SPEED,
  type World,
} from './rules.ts'

interface Skill {
  /** Seconds between plans. */
  react: number
  /** How far (world units) a piranha must stay from the swimmer's whole path. */
  clear: number
  /** Joystick strength. */
  pace: number
  /** Chance per plan to go even when the water looks busy. */
  slip: number
}

/**
 * Easy wades in at a gentle pace (never fast enough for a stroke); normal and
 * hard push off with a full flick, so they surge out of the bank.
 */
const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.5, clear: 130, pace: 0.8, slip: 0.2 },
  normal: { react: 0.22, clear: 104, pace: 1, slip: 0.04 },
  hard: { react: 0.1, clear: 88, pace: 1, slip: 0 },
}

/** Sideways steps the bot considers when looking for a gap, nearest first. */
const COLUMN_STEPS = [0, 50, -50, 100, -100, 150, -150, 200, -200, 260, -260, 320, -320, 400, -400]

/**
 * The computer swimmer: it waits on its bank until a clear line through the
 * river opens, then swims straight across at a column no piranha will reach.
 * Its plans are made from the same deterministic school positions the rules
 * use, so it can look ahead.
 */
export class PiranhaBot {
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
    const s = w.swim[side]
    if (s.stunT >= 0 && w.t < s.stunT) return { x: 0, y: 0 }
    this.left -= dt
    if (this.left <= 0) {
      this.left = this.sk.react * this.rng.range(0.8, 1.2)
      this.goal = this.plan(w, side)
    }
    const dx = this.goal.x - s.x
    const dy = this.goal.y - s.y
    const m = Math.hypot(dx, dy)
    if (m < 10) return { x: 0, y: 0 }
    return { x: (dx / m) * this.sk.pace, y: (dy / m) * this.sk.pace }
  }

  private plan(w: World, side: Side): { x: number; y: number } {
    const s = w.swim[side]
    const goalY =
      s.phase === 0
        ? side === 0
          ? RIVER_TOP - 70
          : RIVER_BOT + 70
        : (HOME[side] as { y: number }).y
    const onBank = !inRiver(s.y)
    for (const step of COLUMN_STEPS) {
      const x = Math.max(EDGE_PAD + 10, Math.min(W - EDGE_PAD - 10, s.x + step))
      if (this.clear(w, x, s.y, goalY)) {
        // On the bank, line up the column first; in the water, swim straight for it.
        if (onBank && Math.abs(x - s.x) > 12) return { x, y: s.y }
        return { x, y: goalY }
      }
      if (this.rng.chance(this.sk.slip) && step === 0) return { x: s.x, y: goalY }
    }
    // No gap: wait on the bank, or keep swimming if already in the water.
    return onBank ? { x: s.x, y: s.y } : { x: s.x, y: goalY }
  }

  /** Does a straight swim from (x, y0) to goalY stay clear of every visible piranha? */
  private clear(w: World, x: number, y0: number, goalY: number): boolean {
    const dir = goalY > y0 ? 1 : -1
    const dur = Math.abs(goalY - y0) / SPEED
    const steps = Math.max(1, Math.ceil(dur / 0.05))
    for (let i = 0; i <= steps; i++) {
      const t = w.t + (i / steps) * dur
      const y = y0 + dir * SPEED * (t - w.t)
      if (y < RIVER_TOP - 80 || y > RIVER_BOT + 80) continue
      for (const f of fishAt(w.schools, t)) {
        if (Math.hypot(f.x - x, f.y - y) < this.sk.clear) return false
      }
    }
    return true
  }
}
