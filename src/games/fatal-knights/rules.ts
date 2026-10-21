import type { Side } from '../../core/game.ts'

/**
 * Fatal Knights rules: two knights on horseback joust across a field. A lance
 * tip that lands on the rival from behind or from the side scores; a lance that
 * meets the rival's shield (the front) clashes and both knights are knocked
 * back. Pure functions, no DOM and no randomness.
 */

/** The field the knights ride on (inside the arena strip). */
export const BOX = { x0: 60, x1: 940, y0: 360, y1: 1440 }
export const BODY = 36
/** Lance length from the knight's centre to its tip. */
export const LANCE = 122
/** A tip within this many units of the rival's body is a touch. */
const TOUCH = 12
/** Half-width of the shield in front of the rider (rad). */
export const SHIELD = 1.05
export const SPEED = 230
export const CHARGE_SPEED = 640
export const CHARGE_T = 0.55
export const CHARGE_CD = 2.6
export const TURN = 2.6
/** Seconds a knight is stunned after a clash. */
const STUN = 0.6
/** Seconds of pause after a point before the next pass. */
export const REST = 1.4
/** If nobody scores for this long, the knights are sent back to their spawns. */
export const IDLE_T = 30
/** The spawns for each pass: red faces up from the bottom, blue faces down from the top. */
export const SPAWN: [{ x: number; y: number; a: number }, { x: number; y: number; a: number }] = [
  { x: 500, y: 1250, a: -Math.PI / 2 },
  { x: 500, y: 550, a: Math.PI / 2 },
]

export interface Knight {
  x: number
  y: number
  /** Heading (rad): the horse faces it and the lance points along it. */
  a: number
  /** Speed (world units / s), positive forward. */
  v: number
  /** Charging until this time (-9 = no). */
  charge: number
  /** Charge ready again at this time. */
  ready: number
  /** Stunned until this time (-9 = no). */
  stun: number
  /** Distance travelled, for the gallop animation. */
  walk: number
}

/** Where a knight stood, for the glide back to the spawns (render only). */
export interface Pose {
  x: number
  y: number
  a: number
}

export interface World {
  /** Seconds since the match began. */
  t: number
  k: [Knight, Knight]
  /** Time the next pass may begin (-9 = now). */
  rest: number
  /** Points scored, red first. */
  pts: [number, number]
  /** Time the current pass began (the last point, or the last reset). */
  last: number
  /** The last touch: who scored, where the tip landed and when (for the replay pose). */
  hit: { side: Side; x: number; y: number; t: number } | null
  /** The last reset: where both knights were, so they can be drawn gliding back. */
  glide: { t: number; from: [Pose, Pose] } | null
}

export interface Drive {
  jx: number
  jy: number
  /** Charge button pressed this step. */
  press: boolean
}

export type Ev =
  | { k: 'charge'; side: Side; x: number; y: number }
  | { k: 'clash'; x: number; y: number; speed: number }
  | { k: 'point'; side: Side; x: number; y: number }
  | { k: 'bump'; x: number; y: number }
  | { k: 'wall'; x: number; y: number; speed: number }

export const angleTo = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

const spawnKnight = (side: Side): Knight => {
  const s = SPAWN[side]
  return { x: s.x, y: s.y, a: s.a, v: 0, charge: -9, ready: 0, stun: -9, walk: 0 }
}

export function newWorld(): World {
  return {
    t: 0,
    k: [spawnKnight(0), spawnKnight(1)],
    rest: -9,
    pts: [0, 0],
    last: 0,
    hit: null,
    glide: null,
  }
}

/** Lance tip of a knight. */
export const tipOf = (k: Knight): { x: number; y: number } => ({
  x: k.x + Math.cos(k.a) * LANCE,
  y: k.y + Math.sin(k.a) * LANCE,
})

/** Re-place both knights for the next pass, facing each other. */
function resetPass(w: World): void {
  const pose = (k: Knight): Pose => ({ x: k.x, y: k.y, a: k.a })
  w.glide = { t: w.t, from: [pose(w.k[0]), pose(w.k[1])] }
  w.k[0] = { ...spawnKnight(0), ready: w.k[0].ready, walk: w.k[0].walk }
  w.k[1] = { ...spawnKnight(1), ready: w.k[1].ready, walk: w.k[1].walk }
}

/**
 * Advance the joust by `dt`. Returns the side that scored this step (null
 * otherwise). Events are appended to `ev`.
 */
export function stepWorld(w: World, drives: readonly Drive[], dt: number, ev: Ev[]): Side | null {
  w.t += dt
  const t = w.t
  const resting = w.rest >= 0 && t < w.rest
  if (w.rest >= 0 && t >= w.rest) w.rest = -9

  for (const side of [0, 1] as Side[]) {
    const k = w.k[side]
    const d = drives[side] ?? { jx: 0, jy: 0, press: false }
    if (!resting) {
      if (d.press && t >= k.ready && t >= k.charge) {
        k.charge = t + CHARGE_T
        k.ready = t + CHARGE_CD
        ev.push({ k: 'charge', side, x: k.x, y: k.y })
      }
    }
    const stunned = t < k.stun
    const m = Math.min(1, Math.hypot(d.jx, d.jy))
    if (!resting && !stunned && m > 0.1) {
      const want = Math.atan2(d.jy, d.jx)
      k.a += Math.max(-TURN * dt, Math.min(TURN * dt, angleTo(k.a, want)))
    }
    let target = 0
    if (stunned) target = -120
    else if (resting) target = 0
    else if (t < k.charge) target = CHARGE_SPEED
    else target = m * SPEED
    const rate = target < k.v ? 4 : 2.6
    k.v += (target - k.v) * Math.min(1, rate * dt)
    const step = k.v * dt
    k.x += Math.cos(k.a) * step
    k.y += Math.sin(k.a) * step
    k.walk += Math.abs(step)
    // Fence: bounce off the rails.
    if (k.x < BOX.x0 + BODY || k.x > BOX.x1 - BODY) {
      const s = Math.abs(k.v)
      k.x = Math.max(BOX.x0 + BODY, Math.min(BOX.x1 - BODY, k.x))
      k.a = Math.PI - k.a
      k.v *= -0.4
      if (s > 150) ev.push({ k: 'wall', x: k.x, y: k.y, speed: s })
    }
    if (k.y < BOX.y0 + BODY || k.y > BOX.y1 - BODY) {
      const s = Math.abs(k.v)
      k.y = Math.max(BOX.y0 + BODY, Math.min(BOX.y1 - BODY, k.y))
      k.a = -k.a
      k.v *= -0.4
      if (s > 150) ev.push({ k: 'wall', x: k.x, y: k.y, speed: s })
    }
  }

  // Bodies: the two horses never pass through each other.
  const [a, b] = w.k
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  if (dist < BODY * 2 && dist > 0.001) {
    const push = (BODY * 2 - dist) / 2
    a.x -= (dx / dist) * push
    a.y -= (dy / dist) * push
    b.x += (dx / dist) * push
    b.y += (dy / dist) * push
    ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }

  if (resting) return null
  if (t - w.last > IDLE_T) {
    // Nobody has scored for a while: start the pass again.
    resetPass(w)
    w.rest = t + REST
    w.last = t + REST
    return null
  }

  // Lances: the tip of each knight against the other knight.
  for (const att of [0, 1] as Side[]) {
    const me = w.k[att]
    const rival = w.k[att === 0 ? 1 : 0]
    if (t < me.stun) continue
    const tip = tipOf(me)
    if (Math.hypot(tip.x - rival.x, tip.y - rival.y) > BODY + TOUCH) continue
    // Which part of the rival did the tip land on?
    const delta = angleTo(rival.a, Math.atan2(tip.y - rival.y, tip.x - rival.x))
    if (Math.abs(delta) < SHIELD) {
      // Shield: both are knocked back and stunned, no point.
      const speed = Math.abs(me.v)
      me.v = -150
      rival.v = -150
      me.stun = t + STUN
      rival.stun = t + STUN
      ev.push({ k: 'clash', x: tip.x, y: tip.y, speed })
      return null
    }
    // A touch from behind or the side: a point, then both go back to their spawns.
    w.pts[att]++
    w.hit = { side: att, x: tip.x, y: tip.y, t }
    ev.push({ k: 'point', side: att, x: tip.x, y: tip.y })
    resetPass(w)
    w.rest = t + REST
    w.last = t + REST
    return att
  }
  return null
}
