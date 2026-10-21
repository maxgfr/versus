import { circleRect, fall, flap, hash01, LANE_H } from '../../engines/runner/index.ts'

/** Pure rules: lane-local units, no rendering. The course is a function of (seed, index). */

export const BIRD_X = 270
export const BIRD_R = 36
/** Top of the ground strip. */
export const GROUND = LANE_H - 96
export const GRAVITY = 2500
export const FLAP = 820
export const MAX_FALL = 1350
export const PIPE_W = 136
export const SPACING = 440
export const FIRST = 980
export const TARGET = 2
/** A round that lasts this long is called a draw: nobody fell. */
export const ROUND_CAP = 90

export interface Bird {
  y: number
  vy: number
  alive: boolean
  /** Distance scrolled (course x of the bird is dist + BIRD_X). */
  dist: number
  pipes: number
  /** Game time of death, or -1. */
  deadAt: number
  flapAt: number
}

export interface Pipe {
  i: number
  x: number
  /** Gap centre and height. */
  gapY: number
  gapH: number
}

export function newBird(): Bird {
  return { y: LANE_H * 0.42, vy: 0, alive: true, dist: 0, pipes: 0, deadAt: -1, flapAt: -1 }
}

/** Scroll speed (units/s) after `t` seconds of flight: gently faster. */
export function speedAt(t: number): number {
  return Math.min(500, 320 + t * 3.2)
}

export function pipe(seed: number, i: number): Pipe {
  const gapH = Math.max(215, 300 - i * 2.5)
  const lo = 110 + gapH / 2
  const hi = GROUND - 90 - gapH / 2
  const mid = (lo + hi) / 2
  const amp = (hi - lo) / 2
  // A slow wave plus jitter: varied, but never an impossible jump between gaps.
  const phase = hash01(seed, 0, 99) * Math.PI * 2
  const v = 0.6 * Math.sin(i * 0.85 + phase) + 0.4 * (hash01(seed, i, 1) * 2 - 1)
  return { i, x: FIRST + i * SPACING, gapY: mid + amp * v, gapH }
}

/** First pipe whose far edge is still ahead of the bird's tail. */
export function nextPipe(seed: number, dist: number): Pipe {
  const bx = dist + BIRD_X - BIRD_R
  const i = Math.max(0, Math.floor((bx - FIRST - PIPE_W) / SPACING) + 1)
  return pipe(seed, i)
}

/** Does the bird touch a pipe or the ground? */
export function crashed(seed: number, b: Bird): boolean {
  if (b.y + BIRD_R >= GROUND) return true
  const bx = b.dist + BIRD_X
  const first = Math.max(0, Math.floor((bx - BIRD_R - FIRST - PIPE_W) / SPACING))
  for (let i = first; i <= first + 1; i++) {
    const p = pipe(seed, i)
    if (p.x > bx + BIRD_R || p.x + PIPE_W < bx - BIRD_R) continue
    const top = p.gapY - p.gapH / 2
    const bottom = p.gapY + p.gapH / 2
    if (circleRect(bx - p.x, b.y, BIRD_R, 0, -10000, PIPE_W, top + 10000)) return true
    if (circleRect(bx - p.x, b.y, BIRD_R, 0, bottom, PIPE_W, 10000)) return true
  }
  return false
}

/** Pipes fully passed at this distance. */
export function passed(dist: number): number {
  const tail = dist + BIRD_X - BIRD_R
  return Math.max(0, Math.floor((tail - FIRST - PIPE_W) / SPACING) + 1)
}

/**
 * One fixed step for a living bird. Returns 'crash' when it hits something,
 * 'pipe' when it just cleared a pipe.
 */
export function stepBird(
  seed: number,
  b: Bird,
  dt: number,
  speed: number,
  flapNow: boolean,
  now: number,
): 'crash' | 'pipe' | null {
  if (flapNow) {
    flap(b, FLAP)
    b.flapAt = now
  }
  fall(b, dt, GRAVITY, MAX_FALL)
  // The sky is a soft ceiling.
  if (b.y < BIRD_R) {
    b.y = BIRD_R
    b.vy = Math.max(0, b.vy)
  }
  b.dist += speed * dt
  if (crashed(seed, b)) return 'crash'
  const p = passed(b.dist)
  if (p > b.pipes) {
    b.pipes = p
    return 'pipe'
  }
  return null
}
