import type { Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import { W } from '../../core/stage.ts'
import {
  capSpeed,
  collideDynamic,
  collideWalls,
  type Contact,
  type Disc,
  disc,
  integrate,
  rink,
  speedOf,
} from '../../engines/puck/index.ts'

/** Pure soccer pool: button-football discs and a ball on a pitch. No DOM, no sound. */

/** The ball's pitch: goal mouths in both end lines. */
export const RINK = rink({ goal: 380, corner: 150, y0: 140, y1: 1660 })
/** Discs bounce off the whole pitch, goal lines included (they cannot enter a goal). */
export const SOLID = rink({ goal: 0, corner: 150, y0: 140, y1: 1660 })

export const BALL_R = 40
export const DISC_R = 66
const BALL_M = 1
const DISC_M = 3
const DRAG_DISC = 2.4
const DRAG_BALL = 1.15
/** Disc speed (units/s) at full power. */
export const SHOT_SPEED = 2300
const MAX_SPEED = 3200
const STOP_V = 18
const SUBSTEPS = 4
/** Safety valve: a turn never lasts longer than this (s). */
const MAX_ROLL = 9
export const GOAL_PAUSE = 1.7
export const DISCS_PER_SIDE = 5

export interface Piece extends Disc {
  side: Side
}

export interface World {
  ball: Disc
  /** 0..4 red, 5..9 blue. */
  discs: Piece[]
  /** Goals scored: [by red, by blue]. */
  score: [number, number]
  /** Whose shot it is (or whose turn it was, while rolling). */
  turn: Side
  /** aim: waiting for a shot. roll: everything moving. goal: celebration pause. */
  phase: 'aim' | 'roll' | 'goal'
  /** Seconds in the current phase. */
  t: number
}

export type Event =
  | Contact
  | { kind: 'goal'; side: Side; x: number; y: number; speed: number }
  | { kind: 'kick'; side: Side; disc: number; x: number; y: number; speed: number }
  | { kind: 'turn'; side: Side }

/** Red's formation in red's frame (bottom half). Blue's is the same, rotated. */
const FORMATION: [number, number][] = [
  [500, 1560],
  [290, 1370],
  [710, 1370],
  [365, 1080],
  [635, 1080],
]

export function formation(): { x: number; y: number; side: Side }[] {
  const out: { x: number; y: number; side: Side }[] = []
  for (const side of [0, 1] as Side[]) {
    for (const [x, y] of FORMATION) {
      const p = frame(side, x, y)
      out.push({ x: p.x, y: p.y, side })
    }
  }
  return out
}

function placeAll(w: World): void {
  w.ball = disc(W / 2, 900, BALL_R)
  w.discs = formation().map((f) => Object.assign(disc(f.x, f.y, DISC_R), { side: f.side }))
}

export function newWorld(turn: Side): World {
  const w: World = {
    ball: disc(W / 2, 900, BALL_R),
    discs: [],
    score: [0, 0],
    turn,
    phase: 'aim',
    t: 0,
  }
  placeAll(w)
  return w
}

/** Indices of the discs `side` owns. */
export function ownDiscs(w: World, side: Side): number[] {
  const out: number[] = []
  w.discs.forEach((d, i) => {
    if (d.side === side) out.push(i)
  })
  return out
}

/**
 * Flick disc `idx` (must belong to the side to play) in direction (dx, dy) with
 * `power` 0..1. Starts the roll. Returns the kick event, or [] when refused.
 */
export function shoot(w: World, idx: number, dx: number, dy: number, power: number): Event[] {
  const d = w.discs[idx]
  if (!d || w.phase !== 'aim' || d.side !== w.turn) return []
  const m = Math.hypot(dx, dy)
  if (m < 1e-6) return []
  const p = Math.max(0, Math.min(1, power))
  if (p <= 0) return []
  d.vx = (dx / m) * p * SHOT_SPEED
  d.vy = (dy / m) * p * SHOT_SPEED
  w.phase = 'roll'
  w.t = 0
  return [{ kind: 'kick', side: d.side, disc: idx, x: d.x, y: d.y, speed: p * SHOT_SPEED }]
}

/** Every piece back on its formation spot, ball on the centre spot, at rest. */
export function reset(w: World): void {
  placeAll(w)
  w.phase = 'aim'
  w.t = 0
}

export function moving(w: World): boolean {
  if (speedOf(w.ball) > STOP_V) return true
  return w.discs.some((d) => speedOf(d) > STOP_V)
}

function freeze(w: World): void {
  for (const d of w.discs) d.vx = d.vy = 0
  w.ball.vx = w.ball.vy = 0
}

/** Advance one fixed step (1/60 s). Returns what happened, for juice. */
export function step(w: World, dt: number): Event[] {
  const ev: Event[] = []
  if (w.phase === 'goal') {
    w.t += dt
    if (w.t >= GOAL_PAUSE) reset(w)
    return ev
  }
  if (w.phase !== 'roll') return ev
  w.t += dt
  const h = dt / SUBSTEPS
  for (let s = 0; s < SUBSTEPS; s++) {
    if (substep(w, h, ev)) return ev
  }
  if (!moving(w) || w.t >= MAX_ROLL) {
    freeze(w)
    w.turn = w.turn === 0 ? 1 : 0
    w.phase = 'aim'
    w.t = 0
    ev.push({ kind: 'turn', side: w.turn })
  }
  return ev
}

/**
 * The side whose goal the ball has crossed: its centre past the end line, inside
 * the mouth. (Counting the centre, not the whole ball, so a ball that stalls
 * half-way over the line still scores instead of sitting in the net forever.)
 */
export function goalScorer(b: Disc): Side | null {
  if (Math.abs(b.x - W / 2) >= RINK.goal / 2) return null
  if (b.y < RINK.y0) return 0
  if (b.y > RINK.y1) return 1
  return null
}

/** One physics substep. Returns true when a goal ended the roll. */
function substep(w: World, h: number, ev: Event[]): boolean {
  const b = w.ball
  for (const d of w.discs) integrate(d, h, DRAG_DISC)
  integrate(b, h, DRAG_BALL)
  for (const d of w.discs) {
    const c = collideWalls(d, SOLID)
    if (c && c.speed > 30) ev.push(c)
  }
  const cb = collideWalls(b, RINK)
  if (cb && cb.speed > 30) ev.push(cb)
  const n = w.discs.length
  for (let i = 0; i < n; i++) {
    const a = w.discs[i]
    if (!a) continue
    const hit = collideDynamic(b, a, BALL_M, DISC_M, 0.9)
    if (hit && hit.speed > 30) ev.push(hit)
    for (let j = i + 1; j < n; j++) {
      const o = w.discs[j]
      if (!o) continue
      const c = collideDynamic(a, o, DISC_M, DISC_M, 0.9)
      if (c && c.speed > 30) ev.push(c)
    }
  }
  for (const d of w.discs) capSpeed(d, MAX_SPEED)
  capSpeed(b, MAX_SPEED)
  const scorer = goalScorer(b)
  if (scorer !== null) {
    w.score[scorer]++
    ev.push({ kind: 'goal', side: scorer, x: b.x, y: b.y, speed: speedOf(b) })
    freeze(w)
    w.phase = 'goal'
    w.t = 0
    // The conceding side kicks off.
    w.turn = scorer === 0 ? 1 : 0
    return true
  }
  return false
}

/** The side that reached `target` goals first, if any. */
export function winner(w: World, target: number): Side | null {
  if (w.score[0] >= target) return 0
  if (w.score[1] >= target) return 1
  return null
}

/** The point a side must drive the ball past to score. */
export function attackPoint(side: Side): { x: number; y: number } {
  return side === 0 ? { x: W / 2, y: RINK.y0 - 30 } : { x: W / 2, y: RINK.y1 + 30 }
}

export function clone(w: World): World {
  const discs: Piece[] = []
  for (const d of w.discs) discs.push({ ...d })
  return {
    ball: { ...w.ball },
    discs,
    score: [w.score[0], w.score[1]],
    turn: w.turn,
    phase: w.phase,
    t: w.t,
  }
}

export interface Trial {
  /** Side that scored during the trial, if any. */
  goal: Side | null
  /** Closest the ball got to the rival goal (units). */
  near: number
}

/**
 * Simulate a candidate shot on a copy of `w` and report how it went. Used by the
 * bot to compare shots without touching the real world.
 */
export function trial(w: World, idx: number, dx: number, dy: number, power: number): Trial {
  const side = w.turn
  const c = clone(w)
  shoot(c, idx, dx, dy, power)
  const goalAt = attackPoint(side)
  let near = Math.hypot(c.ball.x - goalAt.x, c.ball.y - goalAt.y)
  for (let i = 0; i < 220 && c.phase === 'roll'; i++) {
    const ev = step(c, 1 / 60)
    for (const e of ev) if (e.kind === 'goal') return { goal: e.side, near: 0 }
    near = Math.min(near, Math.hypot(c.ball.x - goalAt.x, c.ball.y - goalAt.y))
  }
  return { goal: null, near }
}
