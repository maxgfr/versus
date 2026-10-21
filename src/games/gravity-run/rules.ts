import type { Side } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules, lane-local units (a lane is 1000 × 900). Red's lane has its
 * floor at the bottom and ceiling at the top; the course is a pure function of
 * (seed, index), so both lanes and both phones see the same corridor.
 */

/** Runner x in the lane, fixed on screen. */
export const RUN_X = 260
/** Drawn radius, and the smaller circle that decides hits. */
export const RUN_R = 38
export const HIT_R = 22
/** Surfaces: the ceiling's underside and the floor's top. */
export const CEIL = 210
export const FLOOR = 690
/** Centre y of a runner standing on each surface. */
export const LAND_LO = CEIL + RUN_R
export const LAND_HI = FLOOR - RUN_R
export const GRAVITY = 3600
export const SPIKE_H = 64
export const SPIKE_W = 44
/** Half-width of a runner's feet: a gap must cover this much to drop it. */
export const SUPPORT = 18
export const TARGET = 2
/** A round still going after this long is decided by distance. */
export const ROUND_CAP = 90

const FIRST = 1200
const PERIOD = 700
const JITTER = 90
/** Widest hazard (a gap), for index look-ups. */
const MAX_W = 220

export interface Hazard {
  /** Course index. */
  i: number
  /** Course x of the left edge. */
  x: number
  w: number
  /** Surface it sits on: 0 = floor, 1 = ceiling. */
  side: Side
  kind: 'gap' | 'spike'
}

export interface Runner {
  y: number
  vy: number
  /** Gravity direction: +1 pulls to the floor, -1 to the ceiling. */
  g: 1 | -1
  grounded: boolean
  alive: boolean
  /** Distance scrolled (course x of the runner is dist + RUN_X). */
  dist: number
  /** Share of the round's speed kept: every flip costs some, and it comes back. */
  mul: number
  /** Hazards already passed. */
  seen: number
  flipAt: number
  /** Sprite angle when the last flip started. */
  a0: number
  landAt: number
  deadAt: number
  /** When the last hazard was passed (the counter bumps). */
  scoreAt: number
}

export type RunEvent = 'flip' | 'land' | 'pass' | 'die'

export function newRunner(): Runner {
  return {
    y: LAND_HI,
    vy: 0,
    g: 1,
    grounded: true,
    alive: true,
    dist: 0,
    mul: 1,
    seen: 0,
    flipAt: -10,
    a0: 0,
    landAt: -10,
    deadAt: -1,
    scoreAt: -10,
  }
}

/** A flip costs this much of the runner's speed, which recovers at MUL_RECOVER per second. */
export const MUL_FLIP = 0.07
export const MUL_MIN = 0.8
export const MUL_RECOVER = 0.35

/** Scroll speed (units/s) after `t` seconds of a round: gently faster. */
export function speedAt(t: number): number {
  return Math.min(480, 300 + t * 3)
}

export function hazardAt(seed: number, i: number): Hazard {
  const x = FIRST + i * PERIOD + (hash01(seed, i, 1) * 2 - 1) * JITTER
  const kind: Hazard['kind'] = hash01(seed, i, 3) < 0.5 ? 'gap' : 'spike'
  const side: Side = hash01(seed, i, 2) < 0.5 ? 0 : 1
  const w =
    kind === 'gap'
      ? Math.round(150 + hash01(seed, i, 4) * 70)
      : SPIKE_W * (3 + Math.floor(hash01(seed, i, 4) * 2))
  return { i, x, w, side, kind }
}

/** Hazards on `side` whose extent overlaps [x0, x1], in course order. */
export function hazardsOn(seed: number, side: Side, x0: number, x1: number): Hazard[] {
  const out: Hazard[] = []
  const i0 = Math.max(0, Math.floor((x0 - MAX_W - FIRST - JITTER) / PERIOD))
  const i1 = Math.ceil((x1 - FIRST + JITTER) / PERIOD) + 1
  for (let i = i0; i <= i1; i++) {
    const h = hazardAt(seed, i)
    if (h.side === side && h.x < x1 && h.x + h.w > x0) out.push(h)
  }
  return out
}

/** First hazard on `side` that is not yet behind x0. */
export function nextHazard(seed: number, side: Side, x0: number): Hazard {
  let i = Math.max(0, Math.floor((x0 - MAX_W - FIRST - JITTER) / PERIOD))
  for (;;) {
    const h = hazardAt(seed, i)
    if (h.side === side && h.x + h.w > x0) return h
    i++
  }
}

/** Triangle spikes of a spike hazard: [tipX, tipY, leftX, leftY, rightX, rightY]. */
function spikes(h: Hazard): number[][] {
  const out: number[][] = []
  const n = h.w / SPIKE_W
  for (let j = 0; j < n; j++) {
    const sx = h.x + SPIKE_W / 2 + j * SPIKE_W
    const base = h.side === 0 ? FLOOR : CEIL
    const tip = h.side === 0 ? FLOOR - SPIKE_H : CEIL + SPIKE_H
    out.push([sx, tip, sx - SPIKE_W / 2, base, sx + SPIKE_W / 2, base])
  }
  return out
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/** Circle vs triangle: the centre is inside, or the circle reaches an edge. */
export function circleTriangle(px: number, py: number, r: number, t: readonly number[]): boolean {
  const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = t
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  if (!(neg && pos)) return true
  return (
    segDist(px, py, ax, ay, bx, by) < r ||
    segDist(px, py, bx, by, cx, cy) < r ||
    segDist(px, py, cx, cy, ax, ay) < r
  )
}

/** Does a spike touch a runner whose centre is (cx, y)? */
export function spikeHit(seed: number, cx: number, y: number): boolean {
  for (const side of [0, 1] as Side[]) {
    for (const h of hazardsOn(seed, side, cx - HIT_R, cx + HIT_R)) {
      if (h.kind !== 'spike') continue
      for (const t of spikes(h)) if (circleTriangle(cx, y, HIT_R, t)) return true
    }
  }
  return false
}

/** Is there a gap in the surface on `side` under [x0, x1]? */
export function gapUnder(seed: number, side: Side, x0: number, x1: number): boolean {
  return hazardsOn(seed, side, x0, x1).some((h) => h.kind === 'gap')
}

/** Sprite angle at `now`: spins over 0.3 s from the last flip. */
export function runnerAngle(r: Runner, now: number): number {
  const target = r.g > 0 ? 0 : Math.PI
  const t = Math.max(0, Math.min(1, (now - r.flipAt) / 0.3))
  const e = 1 - (1 - t) ** 3
  return r.a0 + (target - r.a0) * e
}

function die(r: Runner, now: number, ev: RunEvent[]): void {
  r.alive = false
  r.deadAt = now
  r.grounded = false
  r.vy = r.g * 260
  ev.push('die')
}

/** A dead runner keeps falling the way it was pulled, into the void. */
export function fallDead(r: Runner, dt: number): void {
  r.vy += r.g * GRAVITY * dt
  r.y += r.vy * dt
}

/**
 * One fixed step for one runner. `flip` is a tap this step. Returns the events
 * the game should react to (flip, land, pass, die).
 */
export function stepRunner(
  seed: number,
  r: Runner,
  dt: number,
  speed: number,
  flip: boolean,
  now: number,
): RunEvent[] {
  const ev: RunEvent[] = []
  if (!r.alive) {
    fallDead(r, dt)
    return ev
  }
  r.mul = Math.min(1, r.mul + dt * MUL_RECOVER)
  if (flip) {
    r.a0 = runnerAngle(r, now)
    r.g = r.g > 0 ? -1 : 1
    r.grounded = false
    r.flipAt = now
    r.mul = Math.max(MUL_MIN, r.mul - MUL_FLIP)
    ev.push('flip')
  }
  r.dist += speed * r.mul * dt
  const cx = r.dist + RUN_X
  if (!r.grounded) {
    r.vy += r.g * GRAVITY * dt
    r.y += r.vy * dt
  }
  // Land on the surface the gravity points at, unless it is open there.
  const side: Side = r.g > 0 ? 0 : 1
  const landY = r.g > 0 ? LAND_HI : LAND_LO
  if (r.g > 0 ? r.y >= landY : r.y <= landY) {
    if (gapUnder(seed, side, cx - SUPPORT, cx + SUPPORT)) {
      die(r, now, ev)
      return ev
    }
    if (!r.grounded) {
      r.grounded = true
      r.landAt = now
      ev.push('land')
    }
    r.y = landY
    r.vy = 0
  }
  if (spikeHit(seed, cx, r.y)) {
    die(r, now, ev)
    return ev
  }
  for (;;) {
    const h = hazardAt(seed, r.seen)
    if (h.x + h.w >= cx - RUN_R) break
    r.seen++
    r.scoreAt = now
    ev.push('pass')
  }
  return ev
}

/** Who wins the round after this step: null while it goes on. */
export function judge(a: Runner, b: Runner, flyT: number): Side | 'draw' | null {
  if (!a.alive && !b.alive) return 'draw'
  if (!a.alive) return 1
  if (!b.alive) return 0
  if (flyT >= ROUND_CAP) {
    if (a.dist === b.dist) return 'draw'
    return a.dist > b.dist ? 0 : 1
  }
  return null
}
