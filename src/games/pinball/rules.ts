import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'

/**
 * Pinball head-to-head: pure rules. One steel ball on a portrait table, two
 * flippers per player at their own edge, and the gap between each player's
 * flippers is that player's drain. Ball through a drain = a point to the
 * rival. No DOM, no sound, no Math.random: randomness comes from the Rng.
 *
 * Geometry is written once, as red sees it (red at the bottom, y near 1800).
 * Blue is the same table turned 180° about the stage centre: world point
 * (x, y) ↔ (W - x, H - y), and a flipper angle a ↔ a + π.
 */

export const BALL_R = 30
/** Flipper thickness (capsule radius). */
export const FLIP_R = 26
export const FLIP_LEN = 190
/** Radians per second a flipper swings between rest and up. */
export const FLIP_SPEED = 15
/** Seconds from rest to fully up (what a bot must allow for). */
export const FLIP_TIME = 0.075
export const BUMP_R = 44
export const SLING_R = 14
export const RAIL_R = 14
/** Sub-steps per fixed step: keeps a fast ball from skipping a rail. */
export const SUB = 10
export const DRAG = 0.06
/** Gentle pull (units/s²) toward whichever end the ball is heading. */
export const PULL = 240
/** Extra pull per point scored, and its cap (× PULL). */
export const PULL_RAMP = 0.08
export const PULL_MAX = 1.8
/** Below this |vy| the ball is not heading anywhere: the pull goes toward the side it is on. */
const PULL_MIN_VY = 20
export const MAX_SPEED = 2400
export const RAIL_E = 0.55
export const FLIP_E = 0.75
/** Pop bumpers and slingshots push the ball out at least this fast. */
export const BUMP_KICK = 950
export const SLING_KICK = 1150
export const SERVE_SPEED = 780
/** Pause between a drain and the next serve (s). */
export const PAUSE = 1.2
/** A ball slower than this for STALL seconds (cradled, wedged) gets nudged back into play. */
export const STALL_SPEED = 130
export const STALL = 3
export const NUDGE_SPEED = 700
/** Ball centre beyond these lines has gone through a drain. */
export const DRAIN_Y = 1745
export const DRAIN_TOP = H - DRAIN_Y

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export interface Flip {
  side: Side
  /** 0 = the owner's left flipper, 1 = the owner's right one (as the owner reads the table). */
  lane: 0 | 1
  /** Angle in the red frame (world angle = a + π for blue). */
  a: number
  /** Angular velocity of the last sub-step (rad/s), red frame. */
  w: number
  /** Held up this step. */
  up: boolean
}

export interface World {
  ball: Ball
  /** Index = side * 2 + lane. */
  flips: Flip[]
  /** Glow 0..1 of each pop bumper (decays), synced so the guest sees the flash. */
  bumpLit: number[]
  /** Glow 0..1 of each slingshot (index = side * 2 + lane). */
  slingLit: number[]
  score: [number, number]
  /** 'play' while the ball is in the table; 'goal' while a drain is being shown. */
  phase: 'play' | 'goal'
  /** Seconds left in the goal pause (or the opening pause). */
  pause: number
  /** The side that conceded last: the next serve goes to them. */
  server: Side
  /** Seconds the ball in play has been nearly still. */
  still: number
}

export type Event =
  | { kind: 'flip'; side: Side; x: number; y: number; speed: number }
  | { kind: 'bump'; i: number; x: number; y: number; speed: number }
  | { kind: 'kick'; side: Side; x: number; y: number; speed: number }
  | { kind: 'wall'; x: number; y: number; speed: number }
  /** A drain: `side` scored (the rival of whoever was drained). */
  | { kind: 'goal'; side: Side; x: number; y: number; speed: number }
  /** Ball put back in play toward `side`, the player who conceded. */
  | { kind: 'serve'; side: Side; x: number; y: number }
  /** A stalled ball (held on a flipper, wedged) knocked back toward the middle. */
  | { kind: 'nudge'; x: number; y: number; speed: number }

export type Seg = readonly [number, number, number, number]

/** Solid rails in the world: side walls, the rails above each flipper pair, and blue's copies. */
export const RAILS: readonly Seg[] = [
  [70, 330, 70, 1470],
  [930, 330, 930, 1470],
  [70, 1470, 262, 1622],
  [930, 1470, 738, 1622],
  [70, 330, 262, 178],
  [930, 330, 738, 178],
  // Mid-table pinches: keep the ball clear of the pause button (left edge, mid-height).
  [70, 780, 118, 830],
  [118, 830, 118, 970],
  [118, 970, 70, 1020],
  [930, 1020, 882, 970],
  [882, 970, 882, 830],
  [882, 830, 930, 780],
  // Catch walls under each pivot: with a flipper raised, the gap below it would open a way out.
  [262, 1622, 262, 1760],
  [738, 1622, 738, 1760],
  [262, 178, 262, 40],
  [738, 178, 738, 40],
]

/** Flipper pivots in the red frame, per lane. */
export const PIVOT: readonly [readonly [number, number], readonly [number, number]] = [
  [275, 1625],
  [725, 1625],
]
/** Rest and up angles (red frame) per lane: rest hangs toward the drain, up points at the playfield. */
export const REST: readonly [number, number] = [
  (35 * Math.PI) / 180,
  Math.PI - (35 * Math.PI) / 180,
]
export const UP: readonly [number, number] = [(-22 * Math.PI) / 180, Math.PI + (22 * Math.PI) / 180]

/** Slingshot faces in the red frame, index = side * 2 + lane (blue's are the 180° copies). */
export const SLINGS: readonly Seg[] = [
  [235, 1290, 345, 1400],
  [765, 1290, 655, 1400],
  [765, 510, 655, 400],
  [235, 510, 345, 400],
]

/** Pop bumpers in world space: a diagonal through the centre, which is its own mirror image. */
export const BUMPERS: readonly [number, number][] = [
  [330, 760],
  [500, 900],
  [670, 1040],
]

const CX = W / 2
const CY = MID

/** Interior-facing unit normal of each slingshot (the face that kicks). */
export const SLING_N: readonly [number, number][] = SLINGS.map(([ax, ay, bx, by]) => {
  let nx = -(by - ay)
  let ny = bx - ax
  const len = Math.hypot(nx, ny)
  nx /= len
  ny /= len
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  if ((CX - mx) * nx + (CY - my) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  return [nx, ny]
})

/** Pivot, tip and world angle of flipper `f`. */
export function flipGeom(f: Flip): { px: number; py: number; tx: number; ty: number; ang: number } {
  const [lx, ly] = PIVOT[f.lane]
  const turned = f.side === 1
  const px = turned ? W - lx : lx
  const py = turned ? H - ly : ly
  const ang = f.a + (turned ? Math.PI : 0)
  return {
    px,
    py,
    tx: px + Math.cos(ang) * FLIP_LEN,
    ty: py + Math.sin(ang) * FLIP_LEN,
    ang,
  }
}

/** A fresh table: the ball waits at centre through the opening pause, then the first serve goes to a random side. */
export function newWorld(rng: Rng): World {
  const server: Side = rng.chance(0.5) ? 0 : 1
  const flips: Flip[] = [0, 1, 2, 3].map((i) => {
    const lane = (i & 1) as 0 | 1
    return { side: (i >> 1) as Side, lane, a: REST[lane], w: 0, up: false }
  })
  return {
    ball: { x: CX, y: CY, vx: 0, vy: 0 },
    flips,
    bumpLit: BUMPERS.map(() => 0),
    slingLit: SLINGS.map(() => 0),
    score: [0, 0],
    phase: 'goal',
    pause: PAUSE,
    server,
    still: 0,
  }
}

/** The side that reached `target` points first, if any. */
export function winner(w: World, target: number): Side | null {
  if (w.score[0] >= target) return 0
  if (w.score[1] >= target) return 1
  return null
}

/** Closest point on segment (a → b) to (px, py). */
export function closest(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return { x: ax + dx * t, y: ay + dy * t }
}

/** Set which flippers are held up for the coming sub-steps. `holds` indexed side * 2 + lane. */
export function setHolds(w: World, holds: readonly boolean[]): void {
  w.flips.forEach((f, i) => {
    f.up = holds[i] === true
  })
}

/** Swing every flipper toward its held target at the constant motor speed. */
export function swing(w: World, dt: number): void {
  for (const f of w.flips) {
    const target = f.up ? UP[f.lane] : REST[f.lane]
    const d = target - f.a
    const max = FLIP_SPEED * dt
    const da = d > max ? max : d < -max ? -max : d
    f.a += da
    f.w = dt > 0 ? da / dt : 0
  }
}

/**
 * The table tilts harder as the match goes on: every point scored adds to the
 * pull toward the ends (capped), so rallies get faster and the finish tense.
 */
export function pullOf(w: World): number {
  return PULL * Math.min(PULL_MAX, 1 + PULL_RAMP * (w.score[0] + w.score[1]))
}

/** Advance one fixed step. `holds[i]` = flipper i held up. Returns what happened for juice. */
export function step(w: World, dt: number, holds: readonly boolean[], rng: Rng): Event[] {
  const ev: Event[] = []
  setHolds(w, holds)
  for (let i = 0; i < w.bumpLit.length; i++)
    w.bumpLit[i] = Math.max(0, (w.bumpLit[i] ?? 0) - dt * 3)
  for (let i = 0; i < w.slingLit.length; i++)
    w.slingLit[i] = Math.max(0, (w.slingLit[i] ?? 0) - dt * 4)
  if (w.phase === 'goal') {
    swing(w, dt)
    w.pause -= dt
    if (w.pause <= 0) {
      serve(w, rng)
      ev.push({ kind: 'serve', side: w.server, x: w.ball.x, y: w.ball.y })
    }
    return ev
  }
  // No stalling: a ball held still (cradled forever, or wedged) is knocked back
  // toward the middle of the table, so a match always moves on.
  const bs = w.ball
  if (Math.hypot(bs.vx, bs.vy) < STALL_SPEED) w.still += dt
  else w.still = 0
  if (w.still >= STALL) {
    w.still = 0
    const toMid = bs.y > CY ? -1 : 1
    bs.vy = toMid * NUDGE_SPEED
    bs.vx = rng.range(-200, 200)
    ev.push({ kind: 'nudge', x: bs.x, y: bs.y, speed: NUDGE_SPEED })
  }
  const h = dt / SUB
  for (let s = 0; s < SUB; s++) {
    swing(w, h)
    const b = w.ball
    const k = Math.exp(-DRAG * h)
    b.vx *= k
    b.vy *= k
    // Heading one way: pulled that way. Nearly still: pulled toward the side it is on.
    const dir = Math.abs(b.vy) > PULL_MIN_VY ? Math.sign(b.vy) : b.y < MID ? -1 : 1
    b.vy += dir * pullOf(w) * h
    b.x += b.vx * h
    b.y += b.vy * h
    collide(w, ev)
    const sp = Math.hypot(b.vx, b.vy)
    if (sp > MAX_SPEED) {
      b.vx *= MAX_SPEED / sp
      b.vy *= MAX_SPEED / sp
    }
    if (b.y > DRAIN_Y || b.y < DRAIN_TOP) {
      drain(w, ev)
      return ev
    }
  }
  return ev
}

/** Ball into a drain: the other side scores, the ball parks at centre during the pause. */
function drain(w: World, ev: Event[]): void {
  const b = w.ball
  const scorer: Side = b.y > CY ? 1 : 0
  const conceder: Side = scorer === 0 ? 1 : 0
  ev.push({
    kind: 'goal',
    side: scorer,
    x: b.x,
    y: b.y > CY ? DRAIN_Y : DRAIN_TOP,
    speed: Math.hypot(b.vx, b.vy),
  })
  w.score[scorer]++
  w.phase = 'goal'
  w.pause = PAUSE
  w.server = conceder
  w.still = 0
  b.x = CX
  b.y = CY
  b.vx = 0
  b.vy = 0
}

/** Put the ball back in play just in front of the centre bumper, moving toward the conceder. */
function serve(w: World, rng: Rng): void {
  const dir = w.server === 0 ? 1 : -1
  w.ball = {
    x: CX + rng.range(-40, 40),
    y: CY + dir * 120,
    vx: rng.range(-160, 160),
    vy: dir * SERVE_SPEED,
  }
  w.phase = 'play'
}

/** Ball against flippers, bumpers, slingshots and rails, in that order. */
function collide(w: World, ev: Event[]): void {
  const b = w.ball

  // Flippers first: their surface speed (ω × r) is handed to the ball.
  for (const f of w.flips) {
    const g = flipGeom(f)
    const q = closest(b.x, b.y, g.px, g.py, g.tx, g.ty)
    const dx = b.x - q.x
    const dy = b.y - q.y
    const d = Math.hypot(dx, dy)
    const min = BALL_R + FLIP_R
    if (d >= min || d === 0) continue
    const nx = dx / d
    const ny = dy / d
    b.x = q.x + nx * min
    b.y = q.y + ny * min
    const rx = q.x - g.px
    const ry = q.y - g.py
    const sx = -f.w * ry
    const sy = f.w * rx
    const vn = (b.vx - sx) * nx + (b.vy - sy) * ny
    if (vn < 0) {
      b.vx -= (1 + FLIP_E) * vn * nx
      b.vy -= (1 + FLIP_E) * vn * ny
      ev.push({ kind: 'flip', side: f.side, x: q.x, y: q.y, speed: -vn })
    }
  }

  // Pop bumpers: always kick the ball away.
  BUMPERS.forEach(([cx, cy], i) => {
    const dx = b.x - cx
    const dy = b.y - cy
    const d = Math.hypot(dx, dy)
    const min = BALL_R + BUMP_R
    if (d >= min || d === 0) return
    const nx = dx / d
    const ny = dy / d
    b.x = cx + nx * min
    b.y = cy + ny * min
    const vn = b.vx * nx + b.vy * ny
    const out = Math.max(vn, BUMP_KICK)
    b.vx += (out - vn) * nx
    b.vy += (out - vn) * ny
    w.bumpLit[i] = 1
    ev.push({ kind: 'bump', i, x: cx + nx * BUMP_R, y: cy + ny * BUMP_R, speed: out })
  })

  // Slingshots: the face toward the table kicks, the back face is a plain rail.
  SLINGS.forEach(([ax, ay, bx, by], i) => {
    const q = closest(b.x, b.y, ax, ay, bx, by)
    const dx = b.x - q.x
    const dy = b.y - q.y
    const d = Math.hypot(dx, dy)
    const min = BALL_R + SLING_R
    if (d >= min || d === 0) return
    const nx = dx / d
    const ny = dy / d
    b.x = q.x + nx * min
    b.y = q.y + ny * min
    const vn = b.vx * nx + b.vy * ny
    const [ix, iy] = SLING_N[i] as [number, number]
    if (nx * ix + ny * iy > 0.5) {
      const out = Math.max(vn, SLING_KICK)
      b.vx += (out - vn) * nx
      b.vy += (out - vn) * ny
      w.slingLit[i] = 1
      ev.push({ kind: 'kick', side: (i >> 1) as Side, x: q.x, y: q.y, speed: out })
    } else if (vn < 0) {
      b.vx -= (1 + RAIL_E) * vn * nx
      b.vy -= (1 + RAIL_E) * vn * ny
      if (-vn > 200) ev.push({ kind: 'wall', x: q.x, y: q.y, speed: -vn })
    }
  })

  // Rails and walls.
  for (const [ax, ay, bx, by] of RAILS) {
    const q = closest(b.x, b.y, ax, ay, bx, by)
    const dx = b.x - q.x
    const dy = b.y - q.y
    const d = Math.hypot(dx, dy)
    const min = BALL_R + RAIL_R
    if (d >= min || d === 0) continue
    const nx = dx / d
    const ny = dy / d
    b.x = q.x + nx * min
    b.y = q.y + ny * min
    const vn = b.vx * nx + b.vy * ny
    if (vn < 0) {
      b.vx -= (1 + RAIL_E) * vn * nx
      b.vy -= (1 + RAIL_E) * vn * ny
      if (-vn > 200) ev.push({ kind: 'wall', x: q.x, y: q.y, speed: -vn })
    }
  }
}
