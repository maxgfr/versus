import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Drive, FIELD, FLATTEN, type Pellet, tether, type World } from './rules.ts'

interface Skill {
  /** Max error on the steering direction (rad), re-rolled every half second. */
  err: number
  /** Seconds ahead to lead a moving rival ball. */
  lead: number
  /** How far to back off from a flattening threat before turning round. */
  flee: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { err: 0.34, lead: 0, flee: 0.9 },
  normal: { err: 0.14, lead: 0.4, flee: 0.7 },
  hard: { err: 0.03, lead: 0.8, flee: 0.5 },
}

/**
 * The computer beetle. It grows first (rolls over the nearest pellet), hunts
 * the rival ball once it can flatten it, and flees while the rival's ball
 * could flatten its own. It can play either side: everything is relative.
 * Bots run on the host only, so nothing here goes into the snapshot.
 */
export class DungBot {
  private sk: Skill
  private err = 0
  private errT = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, side: Side, dt: number): Drive {
    if (w.flattened !== null) return { jx: 0, jy: 0 }
    this.errT -= dt
    if (this.errT <= 0) {
      this.err = this.rng.range(-this.sk.err, this.sk.err)
      this.errT = 0.5
    }
    const me = w.bugs[side]
    const foe = w.bugs[side === 0 ? 1 : 0]
    const rm = me.ball.r
    const rf = foe.ball.r
    const threat = rf > rm * FLATTEN
    const prey = rm > rf * FLATTEN

    const gap = Math.hypot(foe.ball.x - me.ball.x, foe.ball.y - me.ball.y)
    let drive: Drive
    if (threat && gap < 300) {
      // Run: away from the rival ball, towards the middle when the rim is near.
      const ax = me.beetle.x - foe.ball.x
      const ay = me.beetle.y - foe.ball.y
      const L = Math.hypot(ax, ay) || 1
      drive = this.steer(
        me.beetle.x + (ax / L) * 320 * this.sk.flee,
        me.beetle.y + (ay / L) * 320 * this.sk.flee,
        me.beetle.x,
        me.beetle.y,
      )
    } else if (prey && gap < 900) {
      // Hunt: roll the ball into the rival ball, leading where it is going.
      drive = this.roll(
        me.ball.x,
        me.ball.y,
        me.ball.r,
        me.beetle.x,
        me.beetle.y,
        foe.ball.x + foe.ball.vx * this.sk.lead,
        foe.ball.y + foe.ball.vy * this.sk.lead,
      )
    } else {
      // Grow: the nearest pellet whose push line stays inside the dish.
      const p = this.nearestPellet(w.pellets, me.ball.x, me.ball.y, me.ball.r)
      drive = p
        ? this.roll(me.ball.x, me.ball.y, me.ball.r, me.beetle.x, me.beetle.y, p.x, p.y)
        : this.steer(FIELD.cx, FIELD.cy, me.beetle.x, me.beetle.y)
    }
    return this.rim(this.rotate(drive, this.err), me.beetle.x, me.beetle.y)
  }

  /** Stand behind the ball, on the line to the goal, then push. */
  private roll(
    bx: number,
    by: number,
    br: number,
    x: number,
    y: number,
    gx: number,
    gy: number,
  ): Drive {
    const dx = gx - bx
    const dy = gy - by
    const L = Math.hypot(dx, dy) || 1
    const ux = dx / L
    const uy = dy / L
    const d = tether(br)
    // Where the beetle must stand so the ball is ahead of it, on the goal line.
    const tx = bx - ux * d
    const ty = by - uy * d
    const gap = Math.hypot(tx - x, ty - y)
    if (gap < 46) return { jx: ux * 0.9, jy: uy * 0.9 }
    return this.steer(tx, ty, x, y)
  }

  private steer(tx: number, ty: number, x: number, y: number): Drive {
    const dx = tx - x
    const dy = ty - y
    const L = Math.hypot(dx, dy) || 1
    const m = Math.min(1, L / 90 + 0.2)
    return { jx: (dx / L) * m, jy: (dy / L) * m }
  }

  /** Nearest pellet the ball can be pushed onto without the beetle having to stand outside the dish. */
  private nearestPellet(ps: readonly Pellet[], x: number, y: number, r: number): Pellet | null {
    let best: Pellet | null = null
    let bd = Infinity
    const d = tether(r)
    for (const p of ps) {
      if (!p.on) continue
      const dist = Math.hypot(p.x - x, p.y - y) || 1
      const sx = x - ((p.x - x) / dist) * d
      const sy = y - ((p.y - y) / dist) * d
      if (Math.hypot((sx - FIELD.cx) / FIELD.a, (sy - FIELD.cy) / FIELD.b) > 0.8) continue
      const q = dist * dist
      if (q < bd) {
        bd = q
        best = p
      }
    }
    return best
  }

  private rotate(d: Drive, a: number): Drive {
    const c = Math.cos(a)
    const s = Math.sin(a)
    return { jx: d.jx * c - d.jy * s, jy: d.jx * s + d.jy * c }
  }

  /** Near the rim, blend in a pull back to the middle so the beetle does not get stuck. */
  private rim(d: Drive, x: number, y: number): Drive {
    const k = Math.hypot((x - FIELD.cx) / FIELD.a, (y - FIELD.cy) / FIELD.b)
    if (k < 0.84) return d
    const ix = FIELD.cx - x
    const iy = FIELD.cy - y
    const L = Math.hypot(ix, iy) || 1
    const w = Math.min(1, (k - 0.84) / 0.12)
    const jx = d.jx * (1 - w) + (ix / L) * w
    const jy = d.jy * (1 - w) + (iy / L) * w
    const m = Math.min(1, Math.hypot(jx, jy))
    const n = Math.hypot(jx, jy) || 1
    return { jx: (jx / n) * m, jy: (jy / n) * m }
  }
}
