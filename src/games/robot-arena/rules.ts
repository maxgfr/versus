import type { Side } from '../../core/game.ts'
import { angleTo, separate } from '../../engines/arena/index.ts'

/** Pure robot physics and combat. No rendering, no randomness. */

/**
 * The square arena: 800 × 800 world units, x 100–900 and y 500–1300, centred
 * on the stage and clear of the pause button on the left edge.
 */
export const ARENA = { x0: 100, y0: 500, size: 800 }
export const ARENA_BOTTOM = ARENA.y0 + ARENA.size
export const R = 44
export const MAX_SPEED = 300
/** Velocity change per second, so robots feel heavy but responsive. */
export const ACCEL = 1100
/** Heading turn rate (rad/s): the face follows the stick. */
export const TURN = 9
export const HP = 100
export const ZAP_RANGE = 190
/** Half-angle of the zap arc (rad). */
export const ZAP_ARC = 0.85
export const ZAP_DMG = 22
export const ZAP_CD = 1.1
/** Knock-back speed a zap gives the robot it hits. */
export const ZAP_PUSH = 360
/** Closing speed above which a ram hurts. */
export const RAM_SPEED = 140
export const RAM_K = 0.05
export const SAW = { x: 500, y: 900, r: 66 }
export const SAW_DPS = 30
export const SAW_PUSH = 150
export const PITS: readonly { x: number; y: number; r: number }[] = [
  { x: 180, y: 756, r: 52 },
  { x: 180, y: 1044, r: 52 },
  { x: 820, y: 756, r: 52 },
  { x: 820, y: 1044, r: 52 },
]
/** A robot whose centre gets this close to a pit centre falls in (a knock-out). */
export const PIT_FALL = 0.75

export interface Robot {
  id: number
  side: Side
  x: number
  y: number
  vx: number
  vy: number
  /** Facing (rad); the zap goes this way. */
  a: number
  hp: number
  alive: boolean
  /** Zap cooldown left (s). */
  cd: number
  /** World time of the last zap, of the last hit taken, and of the last saw cut. */
  zapT: number
  hitT: number
  sawT: number
  /** World time the robot went out, or -1. */
  koT: number
  /** Whether it went out by falling into a pit. */
  fell: boolean
}

export interface World {
  robots: Robot[]
  /** Seconds since the round began. */
  t: number
}

export interface Drive {
  jx: number
  jy: number
  zap: boolean
}

export type Ev =
  | { k: 'zap'; x: number; y: number; a: number; side: Side }
  | { k: 'hit'; x: number; y: number; side: Side; dmg: number; hp: number }
  | { k: 'ram'; x: number; y: number; dmg: number }
  | { k: 'saw'; x: number; y: number; side: Side }
  | { k: 'wall'; x: number; y: number; v: number }
  | { k: 'fall'; x: number; y: number; side: Side }
  | { k: 'ko'; x: number; y: number; side: Side }

export function newWorld(): World {
  const spawn = (side: Side): Robot => ({
    id: side,
    side,
    x: 500,
    y: side === 0 ? 1140 : 660,
    vx: 0,
    vy: 0,
    a: side === 0 ? -Math.PI / 2 : Math.PI / 2,
    hp: HP,
    alive: true,
    cd: 0.6,
    zapT: -9,
    hitT: -9,
    sawT: -9,
    koT: -1,
    fell: false,
  })
  return { robots: [spawn(0), spawn(1)], t: 0 }
}

/** Inside the arena (with a robot's radius to spare)? */
export function inArena(x: number, y: number, pad = 0): boolean {
  return (
    x >= ARENA.x0 + pad &&
    x <= ARENA.x0 + ARENA.size - pad &&
    y >= ARENA.y0 + pad &&
    y <= ARENA_BOTTOM - pad
  )
}

/** Would a robot centred here touch a hazard? Used by bots and by the rules. */
export function hazardNear(x: number, y: number, pad = 0): boolean {
  if ((x - SAW.x) ** 2 + (y - SAW.y) ** 2 < (SAW.r + R + pad) ** 2) return true
  for (const p of PITS) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 < (p.r * PIT_FALL + R * 0.2 + pad) ** 2) return true
  }
  return false
}

function knockOut(w: World, r: Robot, ev: Ev[], fell: boolean): void {
  if (!r.alive) return
  r.alive = false
  r.koT = w.t
  r.fell = fell
  r.hp = Math.max(0, r.hp)
  if (fell) ev.push({ k: 'fall', x: r.x, y: r.y, side: r.side })
  else ev.push({ k: 'ko', x: r.x, y: r.y, side: r.side })
}

function damage(w: World, r: Robot, dmg: number, ev: Ev[], x: number, y: number): void {
  r.hp -= dmg
  r.hitT = w.t
  ev.push({ k: 'hit', x, y, side: r.side, dmg, hp: Math.max(0, Math.round(r.hp)) })
  if (r.hp <= 0) knockOut(w, r, ev, false)
}

/** Advance the world one step. `drives[i]` drives `robots[i]`. */
export function stepWorld(
  w: World,
  drives: readonly (Drive | undefined)[],
  dt: number,
  ev: Ev[],
): void {
  for (let i = 0; i < w.robots.length; i++) {
    const r = w.robots[i] as Robot
    if (!r.alive) continue
    const d = drives[i]
    r.cd = Math.max(0, r.cd - dt)
    let wx = 0
    let wy = 0
    const m = d ? Math.min(1, Math.hypot(d.jx, d.jy)) : 0
    if (d && m > 0.12) {
      const want = Math.atan2(d.jy, d.jx)
      r.a += Math.max(-TURN * dt, Math.min(TURN * dt, angleTo(r.a, want)))
      wx = Math.cos(want) * MAX_SPEED * m
      wy = Math.sin(want) * MAX_SPEED * m
    }
    // Accelerate toward the wanted velocity, capped per step.
    let ax = wx - r.vx
    let ay = wy - r.vy
    const dv = Math.hypot(ax, ay)
    const cap = ACCEL * dt
    if (dv > cap) {
      ax = (ax / dv) * cap
      ay = (ay / dv) * cap
    }
    r.vx += ax
    r.vy += ay
    r.x += r.vx * dt
    r.y += r.vy * dt
    // Arena walls: bounce off with some energy lost.
    const lo = ARENA.x0 + R
    const hi = ARENA.x0 + ARENA.size - R
    const top = ARENA.y0 + R
    const bot = ARENA_BOTTOM - R
    if (r.x < lo || r.x > hi) {
      const hitV = Math.abs(r.vx)
      r.x = Math.max(lo, Math.min(hi, r.x))
      r.vx = -r.vx * 0.4
      if (hitV > 150) ev.push({ k: 'wall', x: r.x, y: r.y, v: hitV })
    }
    if (r.y < top || r.y > bot) {
      const hitV = Math.abs(r.vy)
      r.y = Math.max(top, Math.min(bot, r.y))
      r.vy = -r.vy * 0.4
      if (hitV > 150) ev.push({ k: 'wall', x: r.x, y: r.y, v: hitV })
    }
    // The saw: cuts and throws the robot outward.
    const sx = r.x - SAW.x
    const sy = r.y - SAW.y
    const sd = Math.hypot(sx, sy) || 1
    if (sd < SAW.r + R) {
      const k = (SAW.r + R) / sd
      r.x = SAW.x + sx * k
      r.y = SAW.y + sy * k
      // Thrown outward: at least SAW_PUSH away from the blade.
      const out = r.vx * (sx / sd) + r.vy * (sy / sd)
      if (out < SAW_PUSH) {
        r.vx += (sx / sd) * (SAW_PUSH - out)
        r.vy += (sy / sd) * (SAW_PUSH - out)
      }
      damage(w, r, SAW_DPS * dt, ev, r.x - (sx / sd) * R, r.y - (sy / sd) * R)
      if (w.t - r.sawT > 0.3) {
        r.sawT = w.t
        ev.push({ k: 'saw', x: r.x - (sx / sd) * R, y: r.y - (sy / sd) * R, side: r.side })
      }
      if (!r.alive) continue
    }
    // Pits: the robot tips in and is out.
    for (const p of PITS) {
      if ((r.x - p.x) ** 2 + (r.y - p.y) ** 2 < (p.r * PIT_FALL) ** 2) {
        r.hp = 0
        knockOut(w, r, ev, true)
        break
      }
    }
    if (!r.alive) continue
    if (d?.zap && r.cd <= 0) zap(w, r, ev)
  }
  // Robots ram each other: closing speed hurts the one that is hit.
  for (let i = 0; i < w.robots.length; i++)
    for (let j = i + 1; j < w.robots.length; j++) {
      const a = w.robots[i] as Robot
      const b = w.robots[j] as Robot
      if (!a.alive || !b.alive) continue
      const nx = b.x - a.x
      const ny = b.y - a.y
      const dist = Math.hypot(nx, ny) || 1
      const ux = nx / dist
      const uy = ny / dist
      if (!separate(a, b, R, R)) continue
      // Positive: a closes on b.
      const closing = (a.vx - b.vx) * ux + (a.vy - b.vy) * uy
      const toB = Math.max(0, closing - RAM_SPEED) * RAM_K
      const toA = Math.max(0, -closing - RAM_SPEED) * RAM_K
      if (toB > 0) {
        damage(w, b, toB, ev, (a.x + b.x) / 2, (a.y + b.y) / 2)
        ev.push({ k: 'ram', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dmg: toB })
      }
      if (toA > 0) damage(w, a, toA, ev, (a.x + b.x) / 2, (a.y + b.y) / 2)
      if (closing > 0) {
        a.vx -= ux * closing * 0.5
        a.vy -= uy * closing * 0.5
        b.vx += ux * closing * 0.5
        b.vy += uy * closing * 0.5
      }
    }
  w.t += dt
}

/** A zap: every rival inside the arc in front of the robot takes damage and is pushed back. */
function zap(w: World, r: Robot, ev: Ev[]): void {
  r.cd = ZAP_CD
  r.zapT = w.t
  ev.push({ k: 'zap', x: r.x, y: r.y, a: r.a, side: r.side })
  for (const f of w.robots) {
    if (!f.alive || f.side === r.side) continue
    const dx = f.x - r.x
    const dy = f.y - r.y
    const d = Math.hypot(dx, dy)
    if (d > ZAP_RANGE + R) continue
    if (Math.abs(angleTo(r.a, Math.atan2(dy, dx))) > ZAP_ARC) continue
    f.vx += (dx / (d || 1)) * ZAP_PUSH
    f.vy += (dy / (d || 1)) * ZAP_PUSH
    damage(w, f, ZAP_DMG, ev, f.x - (dx / (d || 1)) * R, f.y - (dy / (d || 1)) * R)
  }
}

/** The side still standing, 'draw' if neither is, null while both fight on. */
export function roundWinner(w: World): Side | 'draw' | null {
  const red = w.robots.some((r) => r.side === 0 && r.alive)
  const blue = w.robots.some((r) => r.side === 1 && r.alive)
  if (red && blue) return null
  if (red) return 0
  if (blue) return 1
  return 'draw'
}
