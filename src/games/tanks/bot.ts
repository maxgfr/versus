import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  angleTo,
  bfsNext,
  type Grid,
  lineOfSight,
  moveBouncing,
  threat,
} from '../../engines/arena/index.ts'
import {
  type Drive,
  MAX_BOUNCES,
  SAFE,
  SHELL_R,
  SHELL_SPEED,
  TANK_R,
  type Tank,
  type World,
} from './rules.ts'

interface Skill {
  /** Seconds of clear sight before the first shot. */
  react: number
  /** Max aim error (rad), re-rolled after every shot. */
  aim: number
  /** Fire when within this angle of the aim (rad). */
  tol: number
  /** Chance to notice an incoming shell. */
  dodge: number
  /** Lead moving targets. */
  lead: boolean
  /** Driving speed multiplier. */
  pace: number
  /** Wall bounces it will plan a trick shot through when it has no clear line (0 = never). */
  bank: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { react: 0.75, aim: 0.22, tol: 0.22, dodge: 0.2, lead: false, pace: 0.7, bank: 0 },
  normal: { react: 0.42, aim: 0.1, tol: 0.12, dodge: 0.5, lead: false, pace: 0.9, bank: 1 },
  hard: { react: 0.22, aim: 0.035, tol: 0.07, dodge: 0.85, lead: true, pace: 1, bank: 2 },
}

/**
 * One computer tank: hunts the nearest enemy along the maze (BFS), aims and
 * fires when it has a clear line, and side-steps shells it notices. Bots only
 * run on the host, so this state never needs to be in the snapshot.
 */
export class TankBot {
  private seeT = 0
  private err = 0
  private dodgeT = 0
  private dodgeX = 0
  private dodgeY = 0
  private judged = new Set<number>()
  private stuckT = 0
  private wiggleT = 0
  private wx = 0
  private wy = 0
  private lastX = 0
  private lastY = 0
  /** A planned bank shot: heading to fire along, and when the plan goes stale. */
  private bankA: number | null = null
  private bankT = 0
  private planT = 0
  private skill: Skill

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.skill = SKILL[d]
    this.err = this.rng.range(-this.skill.aim, this.skill.aim)
  }

  decide(w: World, grid: Grid, me: Tank, dt: number): Drive {
    const sk = this.skill
    const foes = w.tanks.filter((t) => t.alive && t.side !== me.side)
    if (!me.alive || !foes.length) return { jx: 0, jy: 0, fire: false }

    // Dodge: notice each threatening shell once, with a difficulty-scaled chance.
    for (const s of w.shells) {
      if (s.owner === me.id && w.t - s.born < SAFE) continue
      const t = threat(grid, s, me.x, me.y, TANK_R + SHELL_R + 16, 0.75)
      if (t === null || this.judged.has(s.id)) continue
      this.judged.add(s.id)
      if (!this.rng.chance(sk.dodge)) continue
      // Step sideways, away from the shell's line.
      const vx = s.vx / SHELL_SPEED
      const vy = s.vy / SHELL_SPEED
      const cross = vx * (me.y - s.y) - vy * (me.x - s.x)
      const sgn = cross >= 0 ? 1 : -1
      this.dodgeX = -vy * sgn
      this.dodgeY = vx * sgn
      this.dodgeT = 0.38
    }
    if (this.dodgeT > 0) {
      this.dodgeT -= dt
      return { jx: this.dodgeX, jy: this.dodgeY, fire: false }
    }

    let target = foes[0] as Tank
    let best = Infinity
    for (const f of foes) {
      const d = (f.x - me.x) ** 2 + (f.y - me.y) ** 2
      if (d < best) {
        best = d
        target = f
      }
    }
    const dist = Math.sqrt(best)

    if (lineOfSight(grid, me.x, me.y, target.x, target.y, 10)) {
      this.seeT += dt
      let tx = target.x
      let ty = target.y
      if (sk.lead) {
        const k = dist / SHELL_SPEED
        tx += target.vx * k
        ty += target.vy * k
      }
      const aimA = Math.atan2(ty - me.y, tx - me.x) + this.err
      const diff = angleTo(me.a, aimA)
      const close = dist < 260
      const mag = close ? 0.18 : dist > 520 ? 0.55 * sk.pace : 0.3 * sk.pace
      const fire = this.seeT > sk.react && Math.abs(diff) < sk.tol && me.cd <= 0
      if (fire) this.err = this.rng.range(-sk.aim, sk.aim)
      return { jx: Math.cos(aimA) * mag, jy: Math.sin(aimA) * mag, fire }
    }
    this.seeT = Math.max(0, this.seeT - dt * 2)

    // No clear line: look for a shot off the walls every so often, and take it
    // from where it stands (turn on the spot, fire when lined up).
    if (sk.bank > 0) {
      this.planT -= dt
      if (this.planT <= 0) {
        this.planT = 0.35
        this.bankA = bankShot(grid, me, target, sk.bank)
        this.bankT = 1.2
      }
      if (this.bankA !== null) {
        this.bankT -= dt
        if (this.bankT <= 0) this.bankA = null
      }
      if (this.bankA !== null && me.cd <= 0) {
        const diff = angleTo(me.a, this.bankA)
        const fire = Math.abs(diff) < sk.tol * 0.5
        if (fire) this.bankA = null
        // A tiny push just turns the hull (the speed falls off with the misalignment).
        return { jx: Math.cos(me.a + diff) * 0.2, jy: Math.sin(me.a + diff) * 0.2, fire }
      }
    }

    // Unstick: if barely moved for a while, wiggle in a random direction.
    if (this.wiggleT > 0) {
      this.wiggleT -= dt
      return { jx: this.wx, jy: this.wy, fire: false }
    }
    const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY)
    this.lastX = me.x
    this.lastY = me.y
    this.stuckT = moved < 40 * dt ? this.stuckT + dt : 0
    if (this.stuckT > 0.8) {
      this.stuckT = 0
      const a = this.rng.range(0, Math.PI * 2)
      this.wx = Math.cos(a)
      this.wy = Math.sin(a)
      this.wiggleT = 0.45
    }

    const next = bfsNext(grid, me.x, me.y, target.x, target.y)
    const dx = next.x - me.x
    const dy = next.y - me.y
    const m = Math.hypot(dx, dy) || 1
    return { jx: (dx / m) * sk.pace, jy: (dy / m) * sk.pace, fire: false }
  }
}

/**
 * Trace a shell fired from `me` along a few dozen headings with the real
 * bounce physics and return the heading of the best one that reaches `foe`
 * after 1..`maxBounces` ricochets without coming back through `me`; null if
 * there is none.
 */
export function bankShot(grid: Grid, me: Tank, foe: Tank, maxBounces: number): number | null {
  const N = 72
  const hit2 = (TANK_R + SHELL_R - 6) ** 2
  const self2 = (TANK_R + SHELL_R + 12) ** 2
  const p = { x: 0, y: 0, vx: 0, vy: 0 }
  const dt = 1 / 30
  let best: number | null = null
  let bestT = Infinity
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2
    p.x = me.x + Math.cos(a) * (TANK_R + 18)
    p.y = me.y + Math.sin(a) * (TANK_R + 18)
    p.vx = Math.cos(a) * SHELL_SPEED
    p.vy = Math.sin(a) * SHELL_SPEED
    let bounces = 0
    for (let t = 0; t < 2.2; t += dt) {
      bounces += moveBouncing(grid, p, dt, 4)
      if (bounces > Math.min(maxBounces, MAX_BOUNCES)) break
      if (t > SAFE && (p.x - me.x) ** 2 + (p.y - me.y) ** 2 < self2) break
      if ((p.x - foe.x) ** 2 + (p.y - foe.y) ** 2 < hit2) {
        if (bounces > 0 && t < bestT) {
          bestT = t
          best = a
        }
        break
      }
    }
  }
  return best
}
