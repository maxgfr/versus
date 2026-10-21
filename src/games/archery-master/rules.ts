import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Ballistics,
  launch,
  type Shell,
  type ShotParams,
  stepShell,
} from '../../engines/aim/index.ts'
import { MID, W } from '../../core/stage.ts'

/**
 * Pure archery: William Tell with a straw dummy in the middle of the table and
 * an apple on its head. Each archer shoots once a turn, both shoot once a round,
 * and after each round the shooting lines back off so the dummy is farther away.
 * An apple is a point; the dummy is a lost life. First to five apples, or the
 * last archer with lives. No DOM.
 */

export const ARROW: Ballistics = { g: 1000, vmax: 1300, elev: 0.9, z0: 60 }
export const DUMMY = { x: 500, y: MID }
export const BODY = { w: 84, h: 170 }
export const HEAD = { z: 205, r: 36 }
export const APPLE = { z: 262, r: 30 }
/** A near miss still counts within this many units of the apple. */
export const PAD = 12
export const LIVES = 3
export const TO_WIN = 5
export const GAP0 = 500
export const GAP_STEP = 50
export const GAP_MAX = 650
export const WIND_MAX = 110
export const MAX_ROUNDS = 40
export const RESULT_PAUSE = 1.3

export type Outcome = 'apple' | 'dummy' | 'wide' | 'short' | 'over'

export type Shot = ShotParams

export interface Arrow {
  side: Side
  dx: number
  dy: number
  power: number
  /** Seconds since release. */
  t: number
  /** Seconds from release until the arrow reaches the dummy's plane (or dies). */
  tEnd: number
  /** Height and sideways position where it crossed (or landed). */
  x: number
  z: number
  outcome: Outcome
}

export interface State {
  turn: Side
  starter: Side
  round: number
  /** Distance from the dummy to each shooting line. */
  gap: number
  wind: number
  apples: [number, number]
  lives: [number, number]
  /** Arrows that stuck in the dummy this round (for drawing). */
  stuck: { side: Side; x: number; z: number }[]
  phase: 'aim' | 'fly' | 'result' | 'over'
  timer: number
  arrow: Arrow | null
  /** The last shot's result, shown during 'result'. */
  last: { side: Side; outcome: Outcome } | null
  /** The arrow that just landed, so it can fly on (or carry the apple off) after the crossing. */
  lastArrow: Arrow | null
  /** Live aim of the archer on turn (synced so the online guest sees it). */
  aiming: Shot | null
  /** Match clock (s), and when the current turn began and the last arrow arrived: renderers tween from these. */
  now: number
  turnAt: number
  hitAt: number
}

export type Event =
  | { kind: 'turn'; side: Side }
  | { kind: 'loose'; side: Side }
  | { kind: 'shot'; side: Side; outcome: Outcome; x: number; z: number }
  | { kind: 'round'; round: number }
  | { kind: 'over'; winner: Side | 'draw' }

/** Where the shooting line of `side` sits (world y). */
export const lineY = (side: Side, gap: number): number => (side === 0 ? MID + gap : MID - gap)

export function newState(starter: Side, wind: number): State {
  return {
    turn: starter,
    starter,
    round: 1,
    gap: GAP0,
    wind,
    apples: [0, 0],
    lives: [LIVES, LIVES],
    stuck: [],
    phase: 'aim',
    timer: 0,
    arrow: null,
    last: null,
    lastArrow: null,
    aiming: null,
    now: 0,
    turnAt: 0,
    hitAt: -9,
  }
}

const classify = (dx: number, z: number): Outcome => {
  if (Math.hypot(dx, z - APPLE.z) <= APPLE.r + PAD) return 'apple'
  if (Math.hypot(dx, z - HEAD.z) <= HEAD.r) return 'dummy'
  if (Math.abs(dx) <= BODY.w && z >= 0 && z <= BODY.h) return 'dummy'
  if (z > APPLE.z + APPLE.r) return 'over'
  return 'wide'
}

/**
 * Fly a shot from `side`'s line and find where it crosses the dummy's plane.
 * Pure: the same inputs always give the same arrow, so the guest and bots can replay it.
 */
export function flight(
  side: Side,
  shot: Shot,
  gap: number,
  wind: number,
): { t: number; x: number; z: number; outcome: Outcome } {
  const y0 = lineY(side, gap)
  const s = launch(DUMMY.x, y0, shot, ARROW)
  const dt = 1 / 240
  for (let i = 0; i < 240 * 4; i++) {
    const py = s.y
    const px = s.x
    const pz = s.z
    stepShell(s, dt, wind, ARROW)
    const crossed = side === 0 ? s.y <= DUMMY.y && py > DUMMY.y : s.y >= DUMMY.y && py < DUMMY.y
    if (crossed) {
      const f = (py - DUMMY.y) / (py - s.y)
      const x = px + (s.x - px) * f
      const z = pz + (s.z - pz) * f
      return { t: s.t - dt * (1 - f), x, z, outcome: classify(x - DUMMY.x, z) }
    }
    if (s.z <= 0) return { t: s.t, x: s.x, z: 0, outcome: 'short' }
    if (s.x < -300 || s.x > W + 300) return { t: s.t, x: s.x, z: s.z, outcome: 'wide' }
    if (side === 0 ? s.y > y0 + 80 : s.y < y0 - 80)
      return { t: s.t, x: s.x, z: s.z, outcome: 'wide' }
  }
  return { t: 4, x: DUMMY.x, z: 0, outcome: 'wide' }
}

/** Loose an arrow. Returns false when it is not that archer's turn to shoot. */
export function loose(s: State, shot: Shot): boolean {
  if (s.phase !== 'aim') return false
  const side = s.turn
  const f = flight(side, shot, s.gap, s.wind)
  s.arrow = {
    side,
    dx: shot.dx,
    dy: shot.dy,
    power: shot.power,
    t: 0,
    tEnd: f.t,
    x: f.x,
    z: f.z,
    outcome: f.outcome,
  }
  s.aiming = null
  s.phase = 'fly'
  return true
}

/** Where an arrow is at time `t` after release (for drawing). */
export function arrowAt(a: Arrow, gap: number, wind: number): Shell {
  const sh = launch(DUMMY.x, lineY(a.side, gap), a, ARROW)
  const dt = 1 / 240
  for (let i = 0; i < Math.round(a.t / dt); i++) stepShell(sh, dt, wind, ARROW)
  return sh
}

/** Advance the flight, the result pause and the turn order by `dt`. */
export function advance(s: State, dt: number, rng: Rng): Event[] {
  const ev: Event[] = []
  s.now += dt
  if (s.phase === 'fly' && s.arrow) {
    s.arrow.t += dt
    if (s.arrow.t >= s.arrow.tEnd) resolve(s, ev)
  } else if (s.phase === 'result') {
    s.timer -= dt
    if (s.timer <= 0) nextTurn(s, ev, rng)
  }
  return ev
}

function resolve(s: State, ev: Event[]): void {
  const a = s.arrow
  if (!a) return
  s.arrow = null
  s.lastArrow = { ...a }
  const side = a.side
  if (a.outcome === 'apple') s.apples[side]++
  else if (a.outcome === 'dummy') {
    s.lives[side]--
    s.stuck.push({ side, x: a.x, z: a.z })
  }
  s.last = { side, outcome: a.outcome }
  s.hitAt = s.now
  ev.push({ kind: 'shot', side, outcome: a.outcome, x: a.x, z: a.z })
  s.phase = 'result'
  s.timer = RESULT_PAUSE
}

function nextTurn(s: State, ev: Event[], rng: Rng): void {
  if (winner(s) !== null || s.round > MAX_ROUNDS) {
    s.phase = 'over'
    const w = winner(s)
    ev.push({ kind: 'over', winner: w ?? leaderByApples(s) })
    return
  }
  if (s.turn === other(s.starter)) {
    // Both have shot this round: the lines back off, the wind changes.
    s.round++
    s.gap = Math.min(GAP_MAX, GAP0 + GAP_STEP * (s.round - 1))
    s.wind = rollWind(rng)
    s.stuck = []
    ev.push({ kind: 'round', round: s.round })
  }
  s.turn = other(s.turn)
  s.phase = 'aim'
  s.last = null
  s.turnAt = s.now
  ev.push({ kind: 'turn', side: s.turn })
}

export const rollWind = (rng: Rng): number => (rng.chance(0.2) ? 0 : rng.range(-WIND_MAX, WIND_MAX))

/** The match winner, or null while it is still open. */
export function winner(s: State): Side | null {
  if (s.apples[0] >= TO_WIN) return 0
  if (s.apples[1] >= TO_WIN) return 1
  if (s.lives[0] <= 0 && s.lives[1] > 0) return 1
  if (s.lives[1] <= 0 && s.lives[0] > 0) return 0
  return null
}

function leaderByApples(s: State): Side | 'draw' {
  if (s.apples[0] === s.apples[1]) return 'draw'
  return s.apples[0] > s.apples[1] ? 0 : 1
}
