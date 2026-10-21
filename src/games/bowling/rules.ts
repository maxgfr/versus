import { collideDynamic, type Disc } from '../../engines/puck/index.ts'

/**
 * Bowling: one lane per player, simulated in red's frame (the bottom half,
 * pins toward the midline). Blue's lane is the same lane turned 180° about the
 * stage centre, so both players bowl with identical physics. Pure, no DOM.
 */

/** Lane geometry in red's frame. */
export const LANE = {
  cx: 500,
  x0: 262,
  x1: 738,
  /** Ball centre may roam into the gutters, up to these lines. */
  gutter0: 190,
  gutter1: 810,
  /** Past this line (toward the midline) the ball and pins are in the pit. */
  pitY: 960,
  /** Where the ball is held for a throw. */
  ballY: 1640,
  /** Headpin, the pin nearest the bowler; the rack widens toward the midline. */
  pinY: 1240,
  gap: 84,
  rowGap: 80,
}
export const BALL_R = 40
export const PIN_R = 24
/** A pin struck faster than this (world units / s) is knocked down for good. */
export const KNOCK = 90
export const BALL_DRAG = 0.5
export const PIN_DRAG = 2.2
const BALL_CAP = 2600
const REST = 22
const SUB = 4
const MAX_ROLL = 6
export const SETTLE = 1.2
export const FRAME = 1 / 60

export interface Pin extends Disc {
  /** Rack position, 0 (headpin) to 9. */
  slot: number
  down: boolean
}

export interface Ball extends Disc {
  /** Hook: heading change rate (rad / s) at full speed. */
  curve: number
  live: boolean
}

export interface Lane {
  /** Frames in the match. */
  total: number
  ball: Ball
  /** Pins still on the deck (standing at the start of the roll, plus any knocked this roll). */
  pins: Pin[]
  /** Rolls per frame, pins knocked in each. The last entry is the frame in progress. */
  frames: number[][]
  phase: 'ready' | 'roll' | 'settle' | 'done'
  /** When a bot may throw (game time). */
  botAt: number
  rollAt: number
  until: number
}

export type Event =
  | { kind: 'hit'; speed: number; x: number; y: number }
  | { kind: 'knock'; speed: number; x: number; y: number }
  | { kind: 'wall'; speed: number; x: number; y: number }
  | { kind: 'pit'; x: number; y: number }

/** Row of each rack slot: 0 holds one pin, row r holds r + 1. */
const ROW_OF = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3]

export function slotPos(slot: number): { x: number; y: number } {
  const r = ROW_OF[slot] ?? 0
  const k = slot - (r * (r + 1)) / 2
  return { x: LANE.cx + (k - r / 2) * LANE.gap, y: LANE.pinY - r * LANE.rowGap }
}

export function rack(): Pin[] {
  return Array.from({ length: 10 }, (_, slot) => {
    const p = slotPos(slot)
    return { slot, x: p.x, y: p.y, vx: 0, vy: 0, r: PIN_R, down: false }
  })
}

export function newLane(total: number, botAt = 0): Lane {
  return {
    total,
    ball: { x: LANE.cx, y: LANE.ballY, vx: 0, vy: 0, r: BALL_R, curve: 0, live: false },
    pins: rack(),
    frames: [[]],
    phase: 'ready',
    botAt,
    rollAt: 0,
    until: 0,
  }
}

/** A frame is over after a strike or a second roll. */
export function frameComplete(rolls: readonly number[]): boolean {
  return rolls.length >= 2 || rolls[0] === 10
}

export function laneDone(lane: Lane): boolean {
  const last = lane.frames[lane.frames.length - 1]
  return lane.frames.length === lane.total && !!last && frameComplete(last)
}

/** Put the pins for the next roll: a fresh rack on a new frame, the standing pins in place otherwise. */
export function prepare(lane: Lane): void {
  // The ball goes back to the hand, behind the foul line.
  lane.ball = { x: LANE.cx, y: LANE.ballY, vx: 0, vy: 0, r: BALL_R, curve: 0, live: false }
  const cur = lane.frames[lane.frames.length - 1] ?? []
  if (cur.length === 0) {
    lane.pins = rack()
    return
  }
  for (const p of lane.pins) {
    const s = slotPos(p.slot)
    p.x = s.x
    p.y = s.y
    p.vx = 0
    p.vy = 0
    p.down = false
  }
}

/** Launch the ball: `dx, dy` a unit direction (up the lane is negative y), `speed` world units / s, `curve` the hook. */
export function throwBall(
  lane: Lane,
  dx: number,
  dy: number,
  speed: number,
  curve: number,
  t: number,
): void {
  const len = Math.hypot(dx, dy) || 1
  const sp = Math.min(BALL_CAP, Math.max(0, speed))
  lane.ball = {
    x: LANE.cx,
    y: LANE.ballY,
    vx: (dx / len) * sp,
    vy: (dy / len) * sp,
    r: BALL_R,
    curve,
    live: true,
  }
  lane.phase = 'roll'
  lane.rollAt = t
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/**
 * Advance the roll by `dt`: the ball hooks and rolls, struck pins fly, and the
 * pins go down for good once they are hit hard enough or leave the lane.
 */
export function stepRoll(lane: Lane, dt: number, ev?: Event[]): void {
  const h = dt / SUB
  const b = lane.ball
  for (let i = 0; i < SUB; i++) {
    if (b.live) {
      const sp = Math.hypot(b.vx, b.vy)
      if (sp > 1) {
        const a = b.curve * h * Math.min(1.2, sp / 1400)
        const c = Math.cos(a)
        const s = Math.sin(a)
        const vx = b.vx * c - b.vy * s
        b.vy = b.vx * s + b.vy * c
        b.vx = vx
      }
      b.x += b.vx * h
      b.y += b.vy * h
      const k = Math.exp(-BALL_DRAG * h)
      b.vx *= k
      b.vy *= k
      // The gutters: a ball that drifts there rolls off the lane and bounces softly.
      if (b.x < LANE.gutter0) {
        if (b.vx < 0) {
          ev?.push({ kind: 'wall', speed: -b.vx, x: b.x, y: b.y })
          b.vx = -b.vx * 0.25
        }
        b.x = LANE.gutter0
      } else if (b.x > LANE.gutter1) {
        if (b.vx > 0) {
          ev?.push({ kind: 'wall', speed: b.vx, x: b.x, y: b.y })
          b.vx = -b.vx * 0.25
        }
        b.x = LANE.gutter1
      }
      if (b.y < LANE.pitY) {
        b.live = false
        ev?.push({ kind: 'pit', x: b.x, y: b.y })
      } else if (Math.hypot(b.vx, b.vy) < REST) {
        b.live = false
        b.vx = 0
        b.vy = 0
      }
    }
    // Every pin slides and slows; a knocked pin keeps going until it stops.
    for (const p of lane.pins) {
      p.x += p.vx * h
      p.y += p.vy * h
      const k = Math.exp(-PIN_DRAG * h)
      p.vx *= k
      p.vy *= k
    }
    // Ball against standing pins (the ball is much heavier).
    for (const p of lane.pins) {
      if (p.down) continue
      const c = collideDynamic(b, p, 4, 1, 0.55)
      if (c) {
        ev?.push({ kind: 'hit', speed: c.speed, x: c.x, y: c.y })
        if (Math.hypot(p.vx, p.vy) > KNOCK) knock(p, ev)
      }
    }
    // Pin against pin.
    for (let a = 0; a < lane.pins.length; a++) {
      for (let c2 = a + 1; c2 < lane.pins.length; c2++) {
        const pa = lane.pins[a] as Pin
        const pb = lane.pins[c2] as Pin
        if (pa.down && pb.down) continue
        const c = collideDynamic(pa, pb, 1, 1, 0.85)
        if (!c) continue
        if (!pa.down && Math.hypot(pa.vx, pa.vy) > KNOCK) knock(pa, ev)
        if (!pb.down && Math.hypot(pb.vx, pb.vy) > KNOCK) knock(pb, ev)
        if (!pa.down && !pb.down && c.speed > 120)
          ev?.push({ kind: 'hit', speed: c.speed, x: c.x, y: c.y })
      }
    }
    for (const p of lane.pins) {
      if (!p.down && (p.y < LANE.pitY || p.x < LANE.x0 - 40 || p.x > LANE.x1 + 40)) {
        p.down = true
        ev?.push({ kind: 'pit', x: p.x, y: p.y })
      }
    }
  }
}

function knock(p: Pin, ev?: Event[]): void {
  if (p.down) return
  p.down = true
  ev?.push({ kind: 'knock', speed: Math.hypot(p.vx, p.vy), x: p.x, y: p.y })
}

/** The roll is over when the ball has stopped (or gone) and nothing is still moving. */
export function rollOver(lane: Lane, t: number): boolean {
  if (t - lane.rollAt > MAX_ROLL) return true
  if (lane.ball.live) return false
  return lane.pins.every((p) => Math.hypot(p.vx, p.vy) < 20)
}

/** Count the pins knocked down this roll, record it, and move the lane on. Returns the count. */
export function resolve(lane: Lane): number {
  const knocked = lane.pins.filter((p) => p.down).length
  lane.pins = lane.pins.filter((p) => !p.down)
  const cur = lane.frames[lane.frames.length - 1] ?? []
  cur.push(knocked)
  if (frameComplete(cur) && lane.frames.length < lane.total) lane.frames.push([])
  lane.phase = laneDone(lane) ? 'done' : 'settle'
  return knocked
}

/** Running total after each frame; a frame still in progress has no entry. */
export function frameScores(frames: readonly number[][]): number[] {
  const out: number[] = []
  let running = 0
  for (const rolls of frames) {
    if (!frameComplete(rolls)) break
    const pins = rolls.reduce((a, b) => a + b, 0)
    const strike = rolls[0] === 10
    const spare = !strike && pins === 10
    running += pins + (strike ? 10 : spare ? 5 : 0)
    out.push(running)
  }
  return out
}

export function laneTotal(frames: readonly number[][]): number {
  const s = frameScores(frames)
  return s.length ? (s[s.length - 1] as number) : 0
}

/** Highest total wins. A level score is a draw. */
export function winnerOf(a: number, b: number): 0 | 1 | 'draw' {
  return a === b ? 'draw' : a > b ? 0 : 1
}

export interface Swipe {
  x: number
  y: number
  t: number
}

/**
 * The throw a finger track makes: direction from press to release (up the
 * lane only), speed from how fast it was flicked, and the hook from how much
 * the track bends (the second half turning against the first). Null for a tap
 * or a swipe that does not go up the lane.
 */
export function swipeThrow(
  pts: readonly Swipe[],
): { dx: number; dy: number; speed: number; curve: number } | null {
  if (pts.length < 2) return null
  const a = pts[0] as Swipe
  const b = pts[pts.length - 1] as Swipe
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 60 || dy > -len * 0.25) return null
  // A frame can carry several moves at once: never read a flick faster than 80 ms.
  const T = Math.max(0.08, b.t - a.t)
  // The hook is how the track bends: the second half turning against the first.
  const m = pts[Math.floor(pts.length / 2)] as Swipe
  const v1x = m.x - a.x
  const v1y = m.y - a.y
  const v2x = b.x - m.x
  const v2y = b.y - m.y
  let turn = 0
  if (Math.hypot(v1x, v1y) > 20 && Math.hypot(v2x, v2y) > 20) {
    turn = Math.atan2(v2y, v2x) - Math.atan2(v1y, v1x)
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn < -Math.PI) turn += Math.PI * 2
  }
  return {
    dx,
    dy,
    speed: clamp((len / T) * 0.75, 700, 2300),
    curve: clamp(turn * 2.5, -0.9, 0.9),
  }
}

/** Where a throw would go on an empty lane: points every `dt` seconds, for the aim preview. */
export function trajectory(
  dx: number,
  dy: number,
  speed: number,
  curve: number,
  seconds = 0.9,
  n = 26,
): { x: number; y: number }[] {
  const len = Math.hypot(dx, dy) || 1
  let vx = (dx / len) * Math.min(BALL_CAP, speed)
  let vy = (dy / len) * Math.min(BALL_CAP, speed)
  let x = LANE.cx
  let y = LANE.ballY
  const h = seconds / n
  const out = [{ x, y }]
  for (let i = 0; i < n; i++) {
    const sp = Math.hypot(vx, vy)
    const a = curve * h * Math.min(1.2, sp / 1400)
    const c = Math.cos(a)
    const s = Math.sin(a)
    const nx = vx * c - vy * s
    vy = vx * s + vy * c
    vx = nx
    x += vx * h
    y += vy * h
    const k = Math.exp(-BALL_DRAG * h)
    vx *= k
    vy *= k
    x = clamp(x, LANE.gutter0, LANE.gutter1)
    out.push({ x, y })
    if (y < LANE.pitY) break
  }
  return out
}
