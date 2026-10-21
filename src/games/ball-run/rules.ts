import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules for Ball Run, in lane-local units (the lane is 1000 × 900).
 * The tunnel is a sequence of rings, one every ROW units of depth. The ball
 * rolls on the floor of the ring it is passing; its position around the ring
 * is an angle φ (0 = straight down the floor, positive = to the right on the
 * player's own view). Every ring is a function of (seed, index), so both
 * balls face the same tunnel.
 */

export const BALL_R = 44
/** Angular half-size of the ball on the near ring (rad). */
export const BALL_A = 0.1
/** Depth between rings (units). */
export const ROW = 300
/** A match with both balls still rolling after this long is decided by distance. */
export const TIME_CAP = 90
const SPEED0 = 480
const SPEED_MAX = 1050
const SPEED_UP = 9
const ACCEL = 260
/** Turn rate limit of the ball (rad/s). */
const TURN = 9
/** Angle per unit of finger drag (rad). */
export const STEER = 0.0045
/** Speed kept after a barrier hit. */
const BUMP_KEEP = 0.45
/** Speed lost per radian turned: steady lines go further than frantic ones. */
const TURN_COST = 60

export interface Arc {
  /** Centre angle (rad). */
  c: number
  /** Full angular width (rad). */
  w: number
}

export interface Row {
  holes: Arc[]
  bars: Arc[]
}

export function wrap(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2)
  if (x < 0) x += Math.PI * 2
  return x - Math.PI
}

/** Is `phi` inside `arc`, with `pad` added to each side (negative shrinks it)? */
export function inArc(phi: number, arc: Arc, pad = 0): boolean {
  return Math.abs(wrap(phi - arc.c)) <= arc.w / 2 + pad
}

/** The hazards of ring `i`. Rings 0–2 are always clear so the start is fair. */
export function rowAt(seed: number, i: number): Row {
  const row: Row = { holes: [], bars: [] }
  if (i < 3) return row
  const p = Math.min(1, i / 70)
  const arcs: { kind: 'hole' | 'bar'; arc: Arc }[] = []
  const nHoles =
    hash01(seed, i, 1) < 0.3 + 0.35 * p ? 1 + (hash01(seed, i, 2) < 0.25 + 0.3 * p ? 1 : 0) : 0
  for (let k = 0; k < nHoles; k++) {
    arcs.push({
      kind: 'hole',
      arc: {
        c: wrap(hash01(seed, i, 10 + k) * Math.PI * 2 - Math.PI),
        w: 0.55 + hash01(seed, i, 20 + k) * 0.35,
      },
    })
  }
  if (hash01(seed, i, 3) < 0.15 + 0.4 * p) {
    arcs.push({
      kind: 'bar',
      arc: {
        c: wrap(hash01(seed, i, 30) * Math.PI * 2 - Math.PI),
        w: 0.4 + hash01(seed, i, 31) * 0.3,
      },
    })
  }
  // Never close the ring: keep a free sector wide enough for the ball.
  while (arcs.length > 0 && freeSpan(arcs.map((a) => a.arc)) < 1.3) arcs.pop()
  for (const a of arcs) (a.kind === 'hole' ? row.holes : row.bars).push(a.arc)
  return row
}

/** Widest free sector (rad) left between the given blocked arcs, padded by the ball. */
export function freeSpan(blocked: Arc[]): number {
  const N = 180
  const hit = Array.from({ length: N }, () => false)
  for (const a of blocked) {
    for (let k = 0; k < N; k++) {
      const phi = -Math.PI + (k / N) * Math.PI * 2
      if (inArc(phi, a, BALL_A)) hit[k] = true
    }
  }
  let best = 0
  let run = 0
  for (let k = 0; k < N * 2; k++) {
    if (hit[k % N]) run = 0
    else {
      run++
      best = Math.max(best, run)
    }
  }
  return (Math.min(best, N) / N) * Math.PI * 2
}

export interface Ball {
  /** Ball angle around the tunnel (rad). */
  phi: number
  /** Where the ball is steering to. */
  phiT: number
  /** Distance rolled (units). */
  dist: number
  v: number
  /** Seconds since the run began. */
  age: number
  /** Index of the next ring to pass. */
  next: number
  out: boolean
  /** Game time of the last barrier hit, or -1. */
  barAt: number
  /** Finger drag state: anchor angle and local x at press. */
  drag: boolean
  anchorPhi: number
  anchorX: number
}

export function newBall(): Ball {
  return {
    phi: 0,
    phiT: 0,
    dist: 0,
    v: SPEED0,
    age: 0,
    next: 1,
    out: false,
    barAt: -1,
    drag: false,
    anchorPhi: 0,
    anchorX: 0,
  }
}

/** Speed the ball settles to after `age` seconds. */
export function baseSpeed(age: number): number {
  return Math.min(SPEED_MAX, SPEED0 + SPEED_UP * age)
}

export type BallEvent = 'fall' | 'bar'

/**
 * One fixed step: turn toward the target at a limited rate, roll forward,
 * and check each ring as it reaches the ball. Returns what happened.
 */
export function stepBall(b: Ball, seed: number, dt: number): BallEvent | null {
  if (b.out) return null
  b.age += dt
  const base = baseSpeed(b.age)
  b.v += Math.max(-ACCEL * dt, Math.min(ACCEL * dt, base - b.v))
  const turn = wrap(b.phiT - b.phi)
  const step = Math.max(-TURN * dt, Math.min(TURN * dt, turn))
  b.phi = wrap(b.phi + step)
  b.v = Math.max(0, b.v - TURN_COST * Math.abs(step))
  b.dist += b.v * dt
  let ev: BallEvent | null = null
  while (b.dist >= b.next * ROW) {
    const row = rowAt(seed, b.next)
    b.next++
    for (const h of row.holes) {
      if (inArc(b.phi, h, -BALL_A * 0.4)) {
        b.out = true
        return 'fall'
      }
    }
    for (const bar of row.bars) {
      if (inArc(b.phi, bar, BALL_A)) {
        b.v *= BUMP_KEEP
        ev = 'bar'
      }
    }
  }
  return ev
}

/** Metres rolled, for the score line. */
export function metres(units: number): number {
  return Math.floor(units / 10)
}
