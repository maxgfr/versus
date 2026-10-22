import type { Side } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules, lane-local units (a lane is 1000 × 900). The ground is a line at
 * GROUND; a height `h` is measured up from it. The course (fences, haystacks,
 * pits, egg arcs) is a pure function of (seed, index).
 */

/** Chicken centre x in the lane, fixed on screen. */
export const RUN_X = 240
/** Half-width of the chicken's body and its hitbox height. */
export const CH_HALF = 22
export const CH_TOP = 68
/** Ground line (feet), measured from the lane's top. */
export const GROUND = 700
export const GRAV = 2000
export const JUMP = 1050
/** Gravity while the jump button is held during the rise: higher jumps. */
export const HOLD_GRAV = 1000
export const HOLD_T = 0.2
/** A press this close to landing still jumps on landing. */
export const BUFFER = 0.12
export const TARGET = 2
/** A round still going after this long is decided by eggs, then distance. */
export const ROUND_CAP = 90

const FIRST = 1100
const PERIOD = 680
const JITTER = 100
const MAX_W = 170
/** Eggs per arc. */
const ARC = 3

export type ObstacleKind = 'fence' | 'hay' | 'pit'

export interface Obstacle {
  i: number
  x: number
  w: number
  h: number
  kind: ObstacleKind
}

export interface Egg {
  /** Global id: index × ARC + k. Ids grow with x. */
  id: number
  x: number
  h: number
}

export interface Chicken {
  /** Height of the feet above the ground. */
  h: number
  vh: number
  grounded: boolean
  alive: boolean
  /** Distance run (course x of the chicken is dist + RUN_X). */
  dist: number
  /** Eggs collected. */
  eggs: number
  /** Egg ids collected that are still in reach. */
  taken: number[]
  /** Lowest egg id not yet resolved (behind the chicken). */
  cursor: number
  /** Obstacles already passed. */
  seen: number
  /** Remaining hold-boost time of the current jump. */
  hold: number
  /** Time left in which a press still counts as a jump. */
  buf: number
  flipAt: number
  landAt: number
  /** How hard the last landing was, 0..1 (the squash and the dust scale with it). */
  landK: number
  deadAt: number
  /** When the last egg was collected (the counter bumps). */
  scoreAt: number
}

export type ChickEvent = 'jump' | 'land' | 'egg' | 'pass' | 'die'

export function newChicken(): Chicken {
  return {
    h: 0,
    vh: 0,
    grounded: true,
    alive: true,
    dist: 0,
    eggs: 0,
    taken: [],
    cursor: 0,
    seen: 0,
    hold: 0,
    buf: 0,
    flipAt: -10,
    landAt: -10,
    landK: 0,
    deadAt: -1,
    scoreAt: -10,
  }
}

/** Run speed (units/s) after `t` seconds of a round: gently faster. */
export function speedAt(t: number): number {
  return Math.min(620, 360 + t * 6)
}

export function obstacleAt(seed: number, i: number): Obstacle {
  const x = FIRST + i * PERIOD + (hash01(seed, i, 1) * 2 - 1) * JITTER
  const roll = hash01(seed, i, 2)
  if (roll < 0.4) return { i, x, w: 64, h: 120, kind: 'fence' }
  if (roll < 0.7) return { i, x, w: 104, h: 84, kind: 'hay' }
  return { i, x, w: MAX_W, h: 0, kind: 'pit' }
}

/** Egg arcs sit above roughly half the obstacles. */
function hasArc(seed: number, i: number): boolean {
  return hash01(seed, i, 6) < 0.55
}

/** Position of egg `id`, whether or not its arc exists. x grows with id. */
function eggPos(seed: number, id: number): { x: number; h: number } {
  const i = Math.floor(id / ARC)
  const k = id % ARC
  const o = obstacleAt(seed, i)
  const top = 170 + hash01(seed, i, 7) * 120
  return { x: o.x + o.w / 2 + (k - 1) * 70, h: top + (k === 1 ? 40 : 0) }
}

export function eggAt(seed: number, id: number): Egg | null {
  if (!hasArc(seed, Math.floor(id / ARC))) return null
  return { id, ...eggPos(seed, id) }
}

/** Obstacles whose extent overlaps [x0, x1]. */
export function obstaclesIn(seed: number, x0: number, x1: number): Obstacle[] {
  const out: Obstacle[] = []
  const i0 = Math.max(0, Math.floor((x0 - MAX_W - FIRST - JITTER) / PERIOD))
  const i1 = Math.ceil((x1 - FIRST + JITTER) / PERIOD) + 1
  for (let i = i0; i <= i1; i++) {
    const o = obstacleAt(seed, i)
    if (o.x < x1 && o.x + o.w > x0) out.push(o)
  }
  return out
}

/** The first obstacle whose far edge is still ahead of x0. */
export function nextObstacle(seed: number, x0: number): Obstacle {
  let i = Math.max(0, Math.floor((x0 - MAX_W - FIRST - JITTER) / PERIOD))
  for (;;) {
    const o = obstacleAt(seed, i)
    if (o.x + o.w > x0) return o
    i++
  }
}

/** Is there a pit under [x0, x1]? */
export function pitUnder(seed: number, x0: number, x1: number): boolean {
  return obstaclesIn(seed, x0, x1).some((o) => o.kind === 'pit')
}

/** Eggs whose x is within [x0, x1]. */
export function eggsIn(seed: number, x0: number, x1: number): Egg[] {
  const out: Egg[] = []
  const i0 = Math.max(0, Math.floor((x0 - MAX_W - FIRST - JITTER) / PERIOD) - 1)
  const i1 = Math.ceil((x1 - FIRST + JITTER) / PERIOD) + 1
  for (let id = i0 * ARC; id < (i1 + 1) * ARC; id++) {
    const e = eggAt(seed, id)
    if (e && e.x >= x0 && e.x <= x1) out.push(e)
  }
  return out
}

/** Does the chicken's body, at height h, overlap an obstacle? */
function hitsObstacle(seed: number, cx: number, h: number): boolean {
  for (const o of obstaclesIn(seed, cx - CH_HALF, cx + CH_HALF)) {
    if (o.kind !== 'pit' && h < o.h - 4) return true
  }
  return false
}

export function die(c: Chicken, now: number, ev: ChickEvent[]): void {
  c.alive = false
  c.deadAt = now
  c.grounded = false
  c.vh = 260
  c.hold = 0
  ev.push('die')
}

/** A dead chicken tumbles: into the pit if it fell in, else onto the ground. */
export function fallDead(seed: number, c: Chicken, dt: number): void {
  c.vh -= GRAV * dt
  c.h += c.vh * dt
  const cx = c.dist + RUN_X
  if (c.h < 0 && !pitUnder(seed, cx - 14, cx + 14)) {
    c.h = 0
    c.vh = 0
  }
}

/**
 * One fixed step for one chicken. `tap` is a press this step, `held` whether the
 * jump is still held down. Returns the events to react to.
 */
export function stepChicken(
  seed: number,
  c: Chicken,
  dt: number,
  speed: number,
  tap: boolean,
  held: boolean,
  now: number,
): ChickEvent[] {
  const ev: ChickEvent[] = []
  if (!c.alive) {
    fallDead(seed, c, dt)
    return ev
  }
  if (tap) c.buf = BUFFER
  c.buf = Math.max(0, c.buf - dt)
  if (c.buf > 0 && c.grounded) {
    c.grounded = false
    c.vh = JUMP
    c.hold = held ? HOLD_T : 0
    c.buf = 0
    c.flipAt = now
    ev.push('jump')
  }
  c.dist += speed * dt
  const cx = c.dist + RUN_X
  if (!c.grounded) {
    if (!held) c.hold = 0
    const g = c.hold > 0 && c.vh > 0 ? HOLD_GRAV : GRAV
    c.hold = Math.max(0, c.hold - dt)
    c.vh -= g * dt
    c.h += c.vh * dt
    if (c.h <= 0 && c.vh <= 0) {
      c.landK = Math.min(1, -c.vh / 1400)
      c.h = 0
      c.vh = 0
      c.grounded = true
      c.landAt = now
      ev.push('land')
      if (c.buf > 0) {
        // A press just before landing: jump again straight away.
        c.grounded = false
        c.vh = JUMP
        c.hold = held ? HOLD_T : 0
        c.buf = 0
        c.flipAt = now
        ev.push('jump')
      }
    }
  }
  if (c.h <= 0 && pitUnder(seed, cx - 14, cx + 14)) {
    die(c, now, ev)
    return ev
  }
  if (hitsObstacle(seed, cx, c.h)) {
    die(c, now, ev)
    return ev
  }
  collectEggs(seed, c, cx, ev)
  for (;;) {
    const o = obstacleAt(seed, c.seen)
    if (o.x + o.w >= cx - CH_HALF) break
    c.seen++
    ev.push('pass')
  }
  return ev
}

function collectEggs(seed: number, c: Chicken, cx: number, ev: ChickEvent[]): void {
  for (const e of eggsIn(seed, cx - 60, cx + 60)) {
    if (c.taken.includes(e.id) || e.id < c.cursor) continue
    if (Math.abs(e.x - cx) < 34 && e.h >= c.h - 14 && e.h <= c.h + CH_TOP) {
      c.taken.push(e.id)
      c.eggs++
      ev.push('egg')
    }
  }
  // Eggs well behind the chicken can no longer be collected: forget them.
  while (eggPos(seed, c.cursor).x < cx - 80) c.cursor++
  c.taken = c.taken.filter((id) => id >= c.cursor)
}

/** Who wins the round after this step: null while it goes on. */
export function judge(a: Chicken, b: Chicken, flyT: number): Side | 'draw' | null {
  if (!a.alive && !b.alive) return 'draw'
  if (!a.alive) return 1
  if (!b.alive) return 0
  if (flyT >= ROUND_CAP) {
    if (a.eggs !== b.eggs) return a.eggs > b.eggs ? 0 : 1
    if (a.dist !== b.dist) return a.dist > b.dist ? 0 : 1
    return 'draw'
  }
  return null
}
