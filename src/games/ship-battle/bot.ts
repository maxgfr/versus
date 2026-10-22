import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  BALL_SPEED,
  clearLine,
  type Drive,
  onIsle,
  RANGE,
  SEA,
  SHIP_R,
  type Ship,
  type World,
} from './rules.ts'

/** Is this point too close to the shores or the docks for a ship's centre? */
function offSea(x: number, y: number, pad: number): boolean {
  return (
    x < SEA.left + SHIP_R + pad ||
    x > SEA.right - SHIP_R - pad ||
    y < SEA.top + SHIP_R + pad ||
    y > SEA.bottom - SHIP_R - pad
  )
}

interface Skill {
  /** Orbit radius around the rival (world units). */
  orbit: number
  /** How far off the broadside line (along the hull, world units) it may fire. */
  tol: number
  /** Seconds the broadside must be lined up before firing. */
  react: number
  /** Max lateral aim error, as a fraction of the distance. */
  err: number
  /** How much of the rival's motion during the balls' flight it leads (0..1). */
  lead: number
}

const SKILL: Record<Difficulty, Skill> = {
  easy: { orbit: 290, tol: 60, react: 0.7, err: 0.08, lead: 0.3 },
  normal: { orbit: 270, tol: 52, react: 0.45, err: 0.05, lead: 0.65 },
  hard: { orbit: 250, tol: 40, react: 0.2, err: 0.01, lead: 1 },
}

/**
 * One computer ship: circles its nearest rival so the rival stays abeam, keeps
 * clear of islands, and fires the broadside once the rival is lined up in clear
 * water. Bots only run on the host, so none of this lives in the snapshot.
 */
export class ShipBot {
  private sk: Skill
  private err: number
  private alignT = 0
  /** Seconds since its last salvo: two ships chasing round a circle can stay
   * just off each other's beam forever, so an idle captain takes wider shots
   * (the salvo's fan still covers them) and eases the throttle to break the circle. */
  private idleT = 0

  constructor(
    private rng: Rng,
    d: Difficulty,
  ) {
    this.sk = SKILL[d]
    this.err = this.rng.range(-this.sk.err, this.sk.err)
  }

  decide(w: World, me: Ship, dt: number): Drive {
    const foes = w.ships.filter((s) => s.alive && s.side !== me.side)
    if (!me.alive || foes.length === 0) return { jx: 0, jy: 0, fire: false }
    let foe = foes[0] as Ship
    let best = Infinity
    for (const f of foes) {
      const d2 = (f.x - me.x) ** 2 + (f.y - me.y) ** 2
      if (d2 < best) {
        best = d2
        foe = f
      }
    }
    const sk = this.sk
    const fx = Math.cos(me.a)
    const fy = Math.sin(me.a)
    // Where the rival will be when a salvo fired now arrives (better captains
    // lead more). Both the orbit and the firing solution use that point.
    const lead = (sk.lead * Math.sqrt(best) * foe.v) / BALL_SPEED
    const px = foe.x + Math.cos(foe.a) * lead
    const py = foe.y + Math.sin(foe.a) * lead
    const dist = Math.max(1, Math.hypot(px - me.x, py - me.y))

    // Steering: orbit at the chosen radius, tangent to the circle, so the
    // rival stays on the broadside. Far away, close in first.
    const rx = (me.x - px) / dist
    const ry = (me.y - py) / dist
    let tx = -ry
    let ty = rx
    if (tx * fx + ty * fy < 0) {
      tx = -tx
      ty = -ty
    }
    // Circling into a shore: come about and orbit the other way.
    if (offSea(me.x + tx * 150, me.y + ty * 150, 10)) {
      tx = -tx
      ty = -ty
    }
    let dx: number
    let dy: number
    if (dist > sk.orbit * 2.4) {
      dx = -rx
      dy = -ry
    } else {
      const k = Math.max(-1.2, Math.min(1.2, (dist - sk.orbit) / 120))
      dx = tx - rx * k
      dy = ty - ry * k
    }
    // Look ahead: among headings near the wanted course, take the one closest
    // to it whose next stretch of water is clear of islands.
    const want = Math.atan2(dy, dx)
    let pick = want
    let bestScore = -Infinity
    for (let k = -8; k <= 8; k++) {
      const th = want + k * (Math.PI / 16)
      const c = Math.cos(th)
      const s2 = Math.sin(th)
      const nx = me.x + c * 70
      const ny = me.y + s2 * 70
      const fx2 = me.x + c * 160
      const fy2 = me.y + s2 * 160
      const near = onIsle(w.isles, nx, ny, SHIP_R + 24) || offSea(nx, ny, 0)
      const far = onIsle(w.isles, fx2, fy2, SHIP_R + 24) || offSea(fx2, fy2, 0)
      const score = Math.cos(th - want) - (near ? 4 : 0) - (far ? 1.5 : 0)
      if (score > bestScore) {
        bestScore = score
        pick = th
      }
    }
    this.idleT += dt
    const restless = Math.max(0, this.idleT - 3)
    // Every few idle seconds, ease off for a moment so the circle breaks.
    const ease = restless > 0 && restless % 4 < 1.2 ? 0.45 : 1
    const jx = Math.cos(pick) * ease
    const jy = Math.sin(pick) * ease

    // Fire when the rival is abeam (along-hull offset small) inside reach and in
    // clear water. Better captains aim where it will be when the balls arrive.
    const vx = px - me.x
    const vy = py - me.y
    const along = fx * vx + fy * vy
    const lateral = Math.abs(-fy * vx + fx * vy)
    const tol = Math.min(sk.tol + restless * 25, 150)
    const lined = Math.abs(along - this.err * dist) < tol && lateral < RANGE - 40 && lateral > 90
    this.alignT = lined ? this.alignT + dt : 0
    const fire =
      lined &&
      this.alignT > sk.react &&
      me.cd <= 0 &&
      (restless > 6 || clearLine(w.isles, me.x, me.y, foe.x, foe.y))
    if (fire) {
      this.alignT = 0
      this.idleT = 0
      this.err = this.rng.range(-sk.err, sk.err)
    }
    return { jx, jy, fire }
  }
}
