import { other, type Side } from '../../core/game.ts'
import { W } from '../../core/stage.ts'

/**
 * Pure penalty shootout. Each kick: the shooter swipes at the ball, the other
 * player drags their keeper along their goal line and may dive. The goal is at
 * the keeper's edge; the ball starts at the shooter's side of the midline.
 */

/** The pitch inside its boards; each end leaves room for a scoreboard behind the goal. */
export const PITCH = { x0: 60, x1: 940, y0: 130, y1: 1670 }
/** The goal mouth, centred on the stage. */
export const GOAL = { x0: 260, x1: 740 }
/** Goal line guarded by each keeper: red's is the bottom line, blue's the top. */
export const LINE: [number, number] = [1590, 210]
/** Keepers stand just in front of their line. */
export const KEEPER_Y: [number, number] = [1540, 260]
/** Where each shooter's ball is placed (1000 units from the line it shoots at). */
export const SPOT: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: W / 2, y: 1210 },
  { x: W / 2, y: 590 },
]
export const KEEPER_HOME = W / 2
export const REACH_STAND = 96
export const REACH_DIVE = 120
const KEEPER_SPEED = 900
const KEEPER_LIE = 0.55
const DIVE_SPEED = 900
export const DIVE_T = 0.24
const SPEED_MIN = 900
const SPEED_MAX = 2200
const CURL = 520
const SUBSTEPS = 4
export const INTRO_T = 1.1
export const RESULT_T = 1.5

export interface Keeper {
  x: number
  /** Dive direction (-1, 0, 1) while diving. */
  dive: number
  /** Seconds left in the current dive. */
  diveT: number
  /** Seconds left lying on the ground after a dive (slow to get up). */
  lie: number
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  /** Lateral acceleration sign/strength from the swipe bend (-1..1). */
  curl: number
}

/** A kick: direction (unit), power 0..1 and curl -1..1. */
export interface Shot {
  dx: number
  dy: number
  power: number
  curl: number
}

export interface World {
  keepers: [Keeper, Keeper]
  ball: Ball
  /** Kicks completed so far (kick k is shot by side k % 2). */
  done: number
  shooter: Side
  phase: 'intro' | 'aim' | 'shot' | 'result' | 'over'
  /** Seconds left in the 'intro' or 'result' phase. */
  timer: number
  outcome: 'goal' | 'save' | 'miss' | null
  score: [number, number]
  /** Preview of the shot being aimed (for the online guest to draw). */
  aim: Shot | null
}

export type Event =
  | { kind: 'intro'; side: Side }
  | { kind: 'kick'; side: Side; x: number; y: number; power: number }
  | { kind: 'dive'; side: Side; x: number; y: number; dir: number }
  | { kind: 'goal'; side: Side; x: number; y: number }
  | { kind: 'save'; side: Side; x: number; y: number }
  | { kind: 'miss'; side: Side; x: number; y: number }

export interface Cmd {
  /** Where each keeper should stand (null = hold). */
  keepX: [number | null, number | null]
  /** Dive this step (-1 / 1), 0 for none, per keeper. Only honoured in 'shot'. */
  dive: [number, number]
  /** The shooter's kick this step, if any. Only honoured in 'aim'. */
  shot: Shot | null
}

export const shooterOf = (done: number): Side => (done % 2 === 0 ? 0 : 1)

export function newWorld(): World {
  const mk = (): Keeper => ({ x: KEEPER_HOME, dive: 0, diveT: 0, lie: 0 })
  const shooter = shooterOf(0)
  return {
    keepers: [mk(), mk()],
    ball: { x: SPOT[shooter].x, y: SPOT[shooter].y, vx: 0, vy: 0, curl: 0 },
    done: 0,
    shooter,
    phase: 'intro',
    timer: INTRO_T,
    outcome: null,
    score: [0, 0],
    aim: null,
  }
}

/** Who guards the line the shooter aims at. */
export const keeperOf = (shooter: Side): Side => other(shooter)

/** Keeper x range along the goal line. */
export const keeperRange = (): [number, number] => [GOAL.x0 + 36, GOAL.x1 - 36]

/**
 * The shootout ends when a side can no longer be caught, or after both sides
 * have taken `rounds` kicks and are level, sudden death in pairs.
 */
export function outcome(score: [number, number], done: number, rounds: number): Side | null {
  const a = (done + 1) >> 1
  const b = done >> 1
  const [sa, sb] = score
  if (a === b && a >= rounds) return sa === sb ? null : sa > sb ? 0 : 1
  const regulation = a < rounds || b < rounds
  const remA = regulation ? Math.max(0, rounds - a) : a > b ? 0 : 1
  const remB = regulation ? Math.max(0, rounds - b) : b > a ? 0 : 1
  if (sa > sb + remB) return 0
  if (sb > sa + remA) return 1
  return null
}

/** Turn a swipe into a shot. `power` 0..1 maps to 900..2200 units/s. */
export function speedOf(power: number): number {
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.max(0, Math.min(1, power))
}

/** Ball state after kicking `shot` from the shooter's spot. */
export function launch(shot: Shot, shooter: Side): Ball {
  const v = speedOf(shot.power)
  const s = SPOT[shooter]
  return { x: s.x, y: s.y, vx: shot.dx * v, vy: shot.dy * v, curl: shot.curl }
}

/** Where a ball in flight will cross `line` (or null), simulated like the real flight. */
export function crossOf(ball: Ball, line: number): number | null {
  const b = { ...ball }
  const h = 1 / 60 / SUBSTEPS
  for (let i = 0; i < 60 * 4 * SUBSTEPS; i++) {
    const prev = b.y
    b.vx += b.curl * CURL * h
    b.x += b.vx * h
    b.y += b.vy * h
    if ((prev - line) * (b.y - line) <= 0) return b.x
    if (b.y < PITCH.y0 - 20 || b.y > PITCH.y1 + 20) return null
  }
  return null
}

/** Where a fresh kick will cross `line`. */
export function crossX(shot: Shot, shooter: Side, line: number): number | null {
  return crossOf(launch(shot, shooter), line)
}

/** The flight as points, every `every` seconds until it leaves play (for the preview). */
export function trace(
  shot: Shot,
  shooter: Side,
  every = 0.07,
  max = 16,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const b = launch(shot, shooter)
  const h = 1 / 60 / SUBSTEPS
  const per = Math.max(1, Math.round(every / h))
  for (let i = 0; pts.length < max && i < 60 * 3 * SUBSTEPS; i++) {
    b.vx += b.curl * CURL * h
    b.x += b.vx * h
    b.y += b.vy * h
    if (i % per === 0) pts.push({ x: b.x, y: b.y })
    if (b.y < PITCH.y0 - 20 || b.y > PITCH.y1 + 20) break
  }
  return pts
}

function clampKeeper(x: number): number {
  const [lo, hi] = keeperRange()
  return x < lo ? lo : x > hi ? hi : x
}

function moveKeeper(k: Keeper, target: number | null, dt: number): void {
  if (k.diveT > 0) {
    k.diveT = Math.max(0, k.diveT - dt)
    k.x = clampKeeper(k.x + k.dive * DIVE_SPEED * dt)
    if (k.diveT === 0) k.lie = KEEPER_LIE
    return
  }
  if (k.lie > 0) k.lie = Math.max(0, k.lie - dt)
  if (target === null) return
  const speed = KEEPER_SPEED * (k.lie > 0 ? 0.35 : 1)
  const d = target - k.x
  const m = Math.min(Math.abs(d), speed * dt)
  k.x = clampKeeper(k.x + Math.sign(d) * m)
}

/** The keeper dives in `dir` (only once, and not while lying down). */
function dive(k: Keeper, dir: number, side: Side, ev: Event[]): void {
  if (dir === 0 || k.diveT > 0 || k.lie > 0) return
  k.dive = dir > 0 ? 1 : -1
  k.diveT = DIVE_T
  ev.push({ kind: 'dive', side, x: k.x, y: KEEPER_Y[side], dir: k.dive })
}

/** Resolve the shot at the goal line: goal, save or miss. */
function resolve(w: World, xAt: number | null, ev: Event[]): void {
  const shooter = w.shooter
  const keeper = keeperOf(shooter)
  const line = LINE[keeper]
  const k = w.keepers[keeper]
  const reach = k.diveT > 0 ? REACH_DIVE : REACH_STAND
  const b = w.ball
  b.vx = 0
  b.vy = 0
  if (xAt === null) {
    w.outcome = 'miss'
    ev.push({ kind: 'miss', side: shooter, x: b.x, y: b.y })
  } else {
    b.x = xAt
    b.y = line
    const inMouth = xAt >= GOAL.x0 && xAt <= GOAL.x1
    if (inMouth && Math.abs(xAt - k.x) <= reach) {
      w.outcome = 'save'
      ev.push({ kind: 'save', side: keeper, x: xAt, y: line })
    } else if (inMouth) {
      w.outcome = 'goal'
      w.score[shooter]++
      ev.push({ kind: 'goal', side: shooter, x: xAt, y: line })
    } else {
      w.outcome = 'miss'
      ev.push({ kind: 'miss', side: shooter, x: xAt, y: line })
    }
  }
  w.phase = 'result'
  w.timer = RESULT_T
}

/** Ball in flight, checked against the keeper's line each substep. */
function flight(w: World, dt: number, ev: Event[]): void {
  const h = dt / SUBSTEPS
  const b = w.ball
  const line = LINE[keeperOf(w.shooter)]
  for (let s = 0; s < SUBSTEPS; s++) {
    const prev = b.y
    b.vx += b.curl * CURL * h
    b.x += b.vx * h
    b.y += b.vy * h
    if ((prev - line) * (b.y - line) <= 0) return resolve(w, b.x, ev)
    if (b.x < PITCH.x0 - 20 || b.x > PITCH.x1 + 20 || b.y < PITCH.y0 - 20 || b.y > PITCH.y1 + 20)
      return resolve(w, null, ev)
  }
}

/**
 * Advance one fixed step. Keepers move in every phase; the shot and the dive
 * are honoured only in their own phase, so nobody can act early.
 */
export function step(w: World, dt: number, cmd: Cmd, rounds: number): Event[] {
  const ev: Event[] = []
  const keeper = keeperOf(w.shooter)
  for (const side of [0, 1] as Side[]) {
    const k = w.keepers[side]
    const target = cmd.keepX[side] ?? null
    if (side === keeper && w.phase === 'shot' && cmd.dive[side] !== 0)
      dive(k, cmd.dive[side], side, ev)
    moveKeeper(k, target, dt)
  }
  switch (w.phase) {
    case 'intro':
      w.timer -= dt
      if (w.timer <= 0) {
        w.phase = 'aim'
        ev.push({ kind: 'intro', side: w.shooter })
      }
      break
    case 'aim':
      if (cmd.shot) {
        const v = speedOf(cmd.shot.power)
        const b = launch(cmd.shot, w.shooter)
        w.ball = b
        w.aim = null
        w.phase = 'shot'
        ev.push({
          kind: 'kick',
          side: w.shooter,
          x: b.x,
          y: b.y,
          power: v / SPEED_MAX,
        })
      }
      break
    case 'shot':
      flight(w, dt, ev)
      break
    case 'result':
      w.timer -= dt
      if (w.timer <= 0) {
        w.done++
        const winner = outcome(w.score, w.done, rounds)
        if (winner !== null) {
          w.phase = 'over'
        } else {
          w.shooter = shooterOf(w.done)
          w.ball = { x: SPOT[w.shooter].x, y: SPOT[w.shooter].y, vx: 0, vy: 0, curl: 0 }
          w.outcome = null
          w.phase = 'intro'
          w.timer = INTRO_T
        }
      }
      break
    case 'over':
      break
  }
  return ev
}
