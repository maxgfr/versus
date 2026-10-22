import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  angleTo,
  BEETLE_R,
  type Drive,
  FIELD,
  flattens,
  GROW,
  type Pellet,
  rimK,
  tether,
  topSpeed,
  type World,
} from './rules.ts'

interface Skill {
  /** Max error on the steering direction (rad), re-rolled every half second. */
  err: number
  /** Seconds between two looks at the dish (reaction time). */
  think: number
  /** Seconds ahead to lead a moving rival ball. */
  lead: number
  /** Stick magnitude cap: easy beetles dawdle. */
  speed: number
  /** Chance to take a charge when one fits, and its power range. */
  dash: number
  power: [number, number]
  /** Pellets of look-ahead: fear a rival that is this many pellets from flattening us. */
  margin: number
  /** Escape directions weighed when fleeing. */
  samples: number
  /** How much a pellet the rival will reach first, or one near a threat, is avoided. */
  contest: number
  /** Gap (between ball edges) under which a threat makes it run. */
  panic: number
  /** Gap under which it goes for the flatten; further off it keeps growing its lead. */
  hunt: number
}

export const SKILL: Record<Difficulty, Skill> = {
  easy: {
    err: 0.32,
    think: 0.5,
    lead: 0,
    speed: 0.8,
    dash: 0,
    power: [0.2, 0.4],
    margin: 0,
    samples: 4,
    contest: 0,
    panic: 150,
    hunt: 2000,
  },
  normal: {
    err: 0.12,
    think: 0.25,
    lead: 0.35,
    speed: 0.93,
    dash: 0.35,
    power: [0.4, 0.75],
    margin: 1,
    samples: 8,
    contest: 0.45,
    panic: 260,
    hunt: 700,
  },
  hard: {
    err: 0.03,
    think: 0.1,
    lead: 0.7,
    speed: 1,
    dash: 0.85,
    power: [0.75, 1],
    margin: 2,
    samples: 16,
    contest: 1.5,
    panic: 340,
    hunt: 520,
  },
}

type Mode = 'grow' | 'hunt' | 'flee'

/**
 * The computer beetle. It grows (rolls its ball over the best pellet), hunts
 * the rival ball once the real flatten rule says it can, and flees, looking a
 * moment ahead, while the rival is (or is about to be) big enough to flatten
 * it. Charges are flicks like a human's. It plays either side: everything is
 * relative. Bots run on the host only, so nothing here goes into the snapshot.
 */
export class DungBot {
  private sk: Skill
  private err = 0
  private errT = 0
  private thinkT = 0
  private mode: Mode = 'grow'
  private target: Pellet | null = null
  private flee = { x: 0, y: 0 }

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
  }

  decide(w: World, side: Side, dt: number): Drive {
    if (w.flattened !== null) return { jx: 0, jy: 0 }
    const sk = this.sk
    this.errT -= dt
    if (this.errT <= 0) {
      this.err = this.rng.range(-sk.err, sk.err)
      this.errT = 0.5
    }
    const me = w.bugs[side]
    const foe = w.bugs[side === 0 ? 1 : 0]
    const rm = me.ball.r
    const rf = foe.ball.r
    const gap = Math.hypot(foe.ball.x - me.ball.x, foe.ball.y - me.ball.y) - rm - rf

    this.thinkT -= dt
    if (this.thinkT <= 0 || (this.target && !this.target.on)) {
      this.thinkT = sk.think
      // The real rule decides who can flatten; a careful bot also fears a
      // rival that is only a pellet or two short of it.
      const prey = flattens(rm, rf)
      const threat = flattens(rf + sk.margin * GROW, rm)
      const panic = flattens(rf, rm) ? sk.panic : sk.panic * 0.6
      this.mode = threat && gap < panic ? 'flee' : prey && gap < sk.hunt ? 'hunt' : 'grow'
      if (this.mode === 'grow') this.target = this.bestPellet(w, side, threat)
      if (this.mode === 'flee') this.flee = this.escape(w, side)
    }

    let drive: Drive
    if (this.mode === 'flee') {
      drive = this.steer(this.flee.x, this.flee.y, me.beetle.x, me.beetle.y)
      if (gap < 140) this.charge(drive, w, side)
    } else if (this.mode === 'hunt') {
      // The ball rides in front: point the beetle at where the rival ball will be.
      const lead = Math.min(sk.lead, Math.max(0, gap) / topSpeed(rm))
      const tx = foe.ball.x + foe.ball.vx * lead
      const ty = foe.ball.y + foe.ball.vy * lead
      drive = this.steer(tx, ty, me.beetle.x, me.beetle.y)
      const aim = Math.abs(angleTo(me.beetle.a, Math.atan2(ty - me.beetle.y, tx - me.beetle.x)))
      if (aim < 0.35 && gap < 300) this.charge(drive, w, side)
    } else {
      const p = this.target?.on ? this.target : null
      drive = p
        ? this.steer(p.x, p.y, me.beetle.x, me.beetle.y)
        : this.steer(FIELD.cx, FIELD.cy, me.beetle.x, me.beetle.y)
      if (p) {
        const far = Math.hypot(p.x - me.ball.x, p.y - me.ball.y)
        const aim = Math.abs(angleTo(me.beetle.a, Math.atan2(p.y - me.beetle.y, p.x - me.beetle.x)))
        if (far > 380 && aim < 0.25) this.charge(drive, w, side)
      }
    }
    const out = this.rim(this.rotate(drive, this.err), me.beetle.x, me.beetle.y)
    const m = Math.hypot(out.jx, out.jy)
    if (m > sk.speed) {
      out.jx *= sk.speed / m
      out.jy *= sk.speed / m
    }
    if (drive.dash !== undefined) out.dash = drive.dash
    return out
  }

  /** Ask for a charge when one is ready (and the bot is the charging kind). */
  private charge(d: Drive, w: World, side: Side): void {
    if (w.t < w.bugs[side].beetle.ready) return
    if (!this.rng.chance(this.sk.dash)) return
    d.dash = this.rng.range(this.sk.power[0], this.sk.power[1])
  }

  /**
   * The best pellet for the ball to roll over: near, ahead of the beetle, one
   * the rival will not reach first, and clear of a threatening rival.
   */
  private bestPellet(w: World, side: Side, threat: boolean): Pellet | null {
    const me = w.bugs[side]
    const foe = w.bugs[side === 0 ? 1 : 0]
    const c = me.ball
    let best: Pellet | null = null
    let bc = Infinity
    for (const p of w.pellets) {
      if (!p.on || !reachable(p, c.r)) continue
      const d = Math.hypot(p.x - c.x, p.y - c.y)
      const turn = Math.abs(angleTo(me.beetle.a, Math.atan2(p.y - me.beetle.y, p.x - me.beetle.x)))
      let cost = d + turn * 70
      const df = Math.hypot(p.x - foe.ball.x, p.y - foe.ball.y)
      if (df < d) cost += this.sk.contest * 260
      if (threat) cost += this.sk.contest * 600 * Math.max(0, 1 - df / 450)
      if (cost < bc) {
        bc = cost
        best = p
      }
    }
    return best
  }

  /**
   * Where to run: weigh escape directions by how far the ball would be from
   * the rival ball a moment from now (the rival heading straight for it), and
   * never into a corner of the rim.
   */
  private escape(w: World, side: Side): { x: number; y: number } {
    const me = w.bugs[side]
    const foe = w.bugs[side === 0 ? 1 : 0]
    const T = 0.7
    const run = topSpeed(me.ball.r) * T
    const chase = topSpeed(foe.ball.r) * T
    let bx = FIELD.cx
    let by = FIELD.cy
    let bs = -Infinity
    const n = this.sk.samples
    const a0 = this.rng.range(0, Math.PI * 2)
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2
      let x = me.beetle.x + Math.cos(a) * run
      let y = me.beetle.y + Math.sin(a) * run
      const k = rimK(x, y, BEETLE_R)
      let cost = 0
      if (k > 0.8) cost += (k - 0.8) * 1600 // cornered against the rim
      if (k > 1) {
        x = FIELD.cx + (x - FIELD.cx) / k
        y = FIELD.cy + (y - FIELD.cy) / k
      }
      const ox = x + Math.cos(a) * tether(me.ball.r)
      const oy = y + Math.sin(a) * tether(me.ball.r)
      const fx = foe.ball.x - ox
      const fy = foe.ball.y - oy
      const fd = Math.hypot(fx, fy) || 1
      const left = Math.max(0, fd - chase)
      // Pellets on the way out are the real escape: growing past the rival's reach.
      let food = 0
      if (this.sk.contest > 0)
        for (const p of w.pellets)
          if (p.on && segDist(p.x, p.y, me.ball.x, me.ball.y, ox, oy) < me.ball.r * 0.85) food++
      const score = left - cost + food * this.sk.contest * 160
      if (score > bs) {
        bs = score
        bx = x
        by = y
      }
    }
    return { x: bx, y: by }
  }

  private steer(tx: number, ty: number, x: number, y: number): Drive {
    const dx = tx - x
    const dy = ty - y
    const L = Math.hypot(dx, dy) || 1
    const m = Math.min(1, L / 90 + 0.2)
    return { jx: (dx / L) * m, jy: (dy / L) * m }
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
    // Only pull back when the stick points further out.
    if (d.jx * ix + d.jy * iy > 0) return d
    const w = Math.min(1, (k - 0.84) / 0.12)
    const jx = d.jx * (1 - w) + (ix / L) * w
    const jy = d.jy * (1 - w) + (iy / L) * w
    const m = Math.min(1, Math.hypot(jx, jy))
    const n = Math.hypot(jx, jy) || 1
    return { jx: (jx / n) * m, jy: (jy / n) * m }
  }
}

/** Can a ball of radius r get over this pellet (its centre is held off the rim)? */
export function reachable(p: { x: number; y: number }, r: number): boolean {
  const k = rimK(p.x, p.y, r)
  if (k <= 1) return true
  const x = FIELD.cx + (p.x - FIELD.cx) / k
  const y = FIELD.cy + (p.y - FIELD.cy) / k
  return Math.hypot(p.x - x, p.y - y) < r * 0.85
}

/** Distance from a point to a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
  return Math.hypot(px - ax - dx * t, py - ay - dy * t)
}
