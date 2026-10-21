import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BR, groupOf, HEAD, POCKETS, TABLE, validPlace, type Ball, type World } from './rules.ts'

interface Tuning {
  /** Angular error on the executed stroke (radians, ±). */
  angle: number
  /** Relative error on the power (±). */
  power: number
  /** Seconds the computer "thinks" before it plays. */
  think: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { angle: 0.06, power: 0.2, think: 1.3 },
  normal: { angle: 0.025, power: 0.09, think: 0.9 },
  hard: { angle: 0.008, power: 0.03, think: 0.6 },
}

export interface Pick {
  /** Where to put the cue first (ball in hand), or null. */
  place: { x: number; y: number } | null
  dx: number
  dy: number
  power: number
}

/** Balls the side may pot now: its group, or the 8 once the group is cleared. */
export function targetsOf(w: World, side: Side): Ball[] {
  const g = w.groups[side]
  return w.balls.filter((b) => {
    if (!b.on || b.n === 0) return false
    if (g === null) return b.n !== 8
    if (groupOf(b.n) === g) return true
    return b.n === 8 && w.balls.every((o) => !o.on || o.n === 0 || o.n === 8 || groupOf(o.n) !== g)
  })
}

/** Distance from point p to segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** True when no ball (other than those in `skip`) touches the segment a-b. */
export function clear(
  w: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  skip: number[],
): boolean {
  for (const b of w.balls) {
    if (!b.on || skip.includes(b.n)) continue
    if (segDist(b.x, b.y, ax, ay, bx, by) < BR * 2 - 2) return false
  }
  return true
}

/**
 * The stroke for `side`: a straight pot if one is open (the cue ball goes where
 * the ghost ball sits), otherwise the nearest ball is hit gently. With the cue in
 * hand, the cue is put down behind the target first.
 */
export function choose(w: World, side: Side, d: Difficulty, rng: Rng): Pick {
  const tune = TUNING[d]
  const cue = w.balls[0]
  const inHand = w.phase === 'place'
  let best: { score: number; pick: Pick } | null = null
  for (const t of targetsOf(w, side)) {
    for (const p of POCKETS) {
      const ux = t.x - p.x
      const uy = t.y - p.y
      const len = Math.hypot(ux, uy) || 1
      const bx = ux / len
      const by = uy / len
      if (!clear(w, t.x, t.y, p.x, p.y, [t.n])) continue
      // Where the cue must sit to hit the target straight into the pocket (ghost ball).
      const gx = t.x + bx * BR * 2
      const gy = t.y + by * BR * 2
      const c0 = inHand
        ? { x: t.x + bx * (BR * 2 + 70), y: t.y + by * (BR * 2 + 70) }
        : { x: cue?.x ?? HEAD.x, y: cue?.y ?? HEAD.y }
      if (inHand && !validPlace(w, c0.x, c0.y)) continue
      if (!clear(w, c0.x, c0.y, gx, gy, [t.n, 0])) continue
      const dx = gx - c0.x
      const dy = gy - c0.y
      const dl = Math.hypot(dx, dy) || 1
      // A thin cut is harder than a straight one.
      const cos =
        ((t.x - gx) * (p.x - t.x) + (t.y - gy) * (p.y - t.y)) /
        (Math.hypot(t.x - gx, t.y - gy) * len || 1)
      const score = dl + len + (1 - cos) * 600
      if (best && score >= best.score) continue
      const power = Math.min(1, Math.max(0.2, 0.12 + len / 1150 + dl / 2600))
      best = {
        score,
        pick: {
          place: inHand ? c0 : null,
          dx: dx / dl,
          dy: dy / dl,
          power,
        },
      }
    }
  }
  if (!best) {
    // No pot is open: a gentle hit at the nearest of our balls (or any ball).
    const cx = cue?.x ?? HEAD.x
    const cy = cue?.y ?? HEAD.y
    const pool = targetsOf(w, side)
    const near = pool.reduce<Ball | null>(
      (a, b) => (!a || Math.hypot(b.x - cx, b.y - cy) < Math.hypot(a.x - cx, a.y - cy) ? b : a),
      null,
    )
    const tx = near?.x ?? TABLE.x0 + (TABLE.x1 - TABLE.x0) / 2
    const ty = near?.y ?? TABLE.y0 + (TABLE.y1 - TABLE.y0) / 2
    const place = inHand ? spotNear(w, tx, ty) : null
    const px = place?.x ?? cx
    const py = place?.y ?? cy
    const dl = Math.hypot(tx - px, ty - py) || 1
    best = {
      score: Infinity,
      pick: { place, dx: (tx - px) / dl, dy: (ty - py) / dl, power: 0.4 },
    }
  }
  const pk = best.pick
  const ang = Math.atan2(pk.dy, pk.dx) + (rng.next() * 2 - 1) * tune.angle
  const power = Math.min(1, Math.max(0.1, pk.power * (1 + (rng.next() * 2 - 1) * tune.power)))
  return { place: pk.place, dx: Math.cos(ang), dy: Math.sin(ang), power }
}

/** A free spot nearest (x, y) on the table, for a ball in hand that has no ideal spot. */
function spotNear(w: World, x: number, y: number): { x: number; y: number } {
  let best = { x: HEAD.x, y: HEAD.y }
  let bd = Infinity
  for (let gx = TABLE.x0 + BR; gx <= TABLE.x1 - BR; gx += 40) {
    for (let gy = TABLE.y0 + BR; gy <= TABLE.y1 - BR; gy += 40) {
      if (!validPlace(w, gx, gy)) continue
      const d = Math.hypot(gx - x, gy - y)
      if (d < bd) {
        bd = d
        best = { x: gx, y: gy }
      }
    }
  }
  return best
}
