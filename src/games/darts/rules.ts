import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure darts: a board in the middle, three darts a turn, a set number of rounds
 * (five by default). A flick sets where the dart lands: the flick vector,
 * measured against the ideal flick that would hit the centre from the thrower's
 * edge, moves the landing point. Faster flicks wobble more. No DOM.
 */

export const ROUNDS = 5
export const DARTS_PER_TURN = 3
/** r keeps the number ring clear of the pause button at the left edge. */
export const BOARD = { x: 500, y: 900, r: 370 }
/** Board units per world unit of flick error. */
export const DART_K = 1.2
/** Flick speed (world units/s) that wobbles the dart fully. */
export const WOBBLE_SPEED = 2400
/** Flicks shorter than this are taps, not throws. */
export const FLICK_MIN = 40

/** Where each side throws from: the middle of its own edge. */
export const EDGE: [Pt, Pt] = [
  { x: 500, y: 1560 },
  { x: 500, y: 240 },
]

/** The layout from the top (20) clockwise, as on a real board. */
export const SEGMENTS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]

/** Ring radii as fractions of the board radius (standard proportions). */
export const BULL = 0.037
export const OUTER_BULL = 0.094
export const TREBLE_IN = 0.582
export const TREBLE_OUT = 0.629
export const DOUBLE_IN = 0.953

export interface Pt {
  x: number
  y: number
}

export type Ring = 'bull' | 'outer' | 'treble' | 'double' | 'single' | 'miss'

export interface Score {
  pts: number
  label: string
  ring: Ring
}

export interface Dart {
  x: number
  y: number
  side: Side
  pts: number
  label: string
  ring: Ring
  /** Game time it stuck (for its wobble), set by the game. */
  at?: number
}

export interface Flight {
  side: Side
  to: Pt
  t: number
  dur: number
  pts: number
  label: string
  ring: Ring
}

export interface State {
  turn: Side
  /** Darts thrown by the side on turn in its current turn (0..3). */
  throws: number
  /** Completed rounds (a red turn and a blue turn each). */
  rounds: number
  /** Rounds in this match (the match length). */
  total: number
  totals: [number, number]
  darts: Dart[]
  flight: Flight | null
  phase: 'aim' | 'fly' | 'beat'
  beat: number
  /** The dart that just stuck, for its float. */
  last: Dart | null
  /** Where the flick being made would land (synced for the online guest). */
  aim: Pt | null
  /** Render stamps (game time), so the online guest replays the same animations. */
  roundAt: number
  turnAt: number
  endAt: number
}

/** The ideal flick for a side: from its edge straight at the centre. */
export function idealFlick(side: Side): Pt {
  return { x: BOARD.x - EDGE[side].x, y: BOARD.y - EDGE[side].y }
}

/** Where a flick lands, plus the noise on top (board units). */
export function landingOf(side: Side, flick: Pt, noise: Pt = { x: 0, y: 0 }): Pt {
  const ideal = idealFlick(side)
  return {
    x: BOARD.x + (flick.x - ideal.x) * DART_K + noise.x,
    y: BOARD.y + (flick.y - ideal.y) * DART_K + noise.y,
  }
}

/** The flick that lands the dart at `target` (board coordinates), for the bot. */
export function flickFor(side: Side, target: Pt): Pt {
  const ideal = idealFlick(side)
  return {
    x: ideal.x + (target.x - BOARD.x) / DART_K,
    y: ideal.y + (target.y - BOARD.y) / DART_K,
  }
}

/** Box-Muller: one standard normal draw. */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng.next())
  const v = rng.next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Wobble of a human flick: a gaussian whose spread grows with the flick speed. */
export function wobble(rng: Rng, speed: number): Pt {
  const sigma = 3 + 30 * Math.min(1, speed / WOBBLE_SPEED)
  return { x: gauss(rng) * sigma, y: gauss(rng) * sigma }
}

/** The number of the segment at a board offset (20 at the top, clockwise). */
export function segmentAt(dx: number, dy: number): number {
  const seg = Math.PI / 10
  let a = Math.atan2(dy, dx) + Math.PI / 2 + seg / 2
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  const i = Math.floor(a / seg) % SEGMENTS.length
  return SEGMENTS[i] ?? 20
}

/** What a dart scores where it lands. */
export function scoreAt(p: Pt): Score {
  const dx = p.x - BOARD.x
  const dy = p.y - BOARD.y
  const f = Math.hypot(dx, dy) / BOARD.r
  if (f > 1) return { pts: 0, label: 'Miss', ring: 'miss' }
  if (f < BULL) return { pts: 50, label: 'Bull', ring: 'bull' }
  if (f < OUTER_BULL) return { pts: 25, label: 'Outer bull', ring: 'outer' }
  const n = segmentAt(dx, dy)
  if (f > DOUBLE_IN) return { pts: 2 * n, label: `Double ${n}`, ring: 'double' }
  if (f > TREBLE_IN && f < TREBLE_OUT) return { pts: 3 * n, label: `Treble ${n}`, ring: 'treble' }
  return { pts: n, label: `${n}`, ring: 'single' }
}

export function newState(first: Side, total = ROUNDS): State {
  return {
    turn: first,
    throws: 0,
    rounds: 0,
    total,
    totals: [0, 0],
    darts: [],
    flight: null,
    phase: 'aim',
    beat: 0,
    last: null,
    aim: null,
    roundAt: 0,
    turnAt: 0,
    endAt: -1,
  }
}

/** Throw: the dart flies from the edge to `to`, and sticks when it lands. */
export function throwDart(s: State, to: Pt): void {
  const sc = scoreAt(to)
  s.flight = {
    side: s.turn,
    to: sc.ring === 'miss' ? clampOut(to) : to,
    t: 0,
    dur: 0.42,
    pts: sc.pts,
    label: sc.label,
    ring: sc.ring,
  }
  s.phase = 'fly'
}

/** A dart that misses the board lands on the surround, just past the wire. */
export function clampOut(p: Pt): Pt {
  const dx = p.x - BOARD.x
  const dy = p.y - BOARD.y
  const d = Math.hypot(dx, dy) || 1
  const r = Math.min(BOARD.r * 1.12, d)
  return { x: BOARD.x + (dx / d) * r, y: BOARD.y + (dy / d) * r }
}

export type Event =
  { kind: 'stick'; dart: Dart } | { kind: 'turn'; side: Side } | { kind: 'round'; n: number }

/** Advance the flight and the pause after each dart. */
export function advance(s: State, dt: number): Event[] {
  const ev: Event[] = []
  if (s.phase === 'fly' && s.flight) {
    s.flight.t += dt
    if (s.flight.t < s.flight.dur) return ev
    const f = s.flight
    const dart: Dart = {
      x: f.to.x,
      y: f.to.y,
      side: f.side,
      pts: f.pts,
      label: f.label,
      ring: f.ring,
    }
    s.darts.push(dart)
    s.totals[f.side] += f.pts
    s.throws++
    s.last = dart
    s.flight = null
    s.phase = 'beat'
    s.beat = s.throws >= DARTS_PER_TURN ? 1.1 : 0.7
    ev.push({ kind: 'stick', dart })
    return ev
  }
  if (s.phase === 'beat') {
    s.beat -= dt
    if (s.beat > 0) return ev
    if (s.throws >= DARTS_PER_TURN) {
      s.throws = 0
      s.turn = other(s.turn)
      if (s.turn === 0) {
        s.rounds++
        if (!done(s)) ev.push({ kind: 'round', n: s.rounds })
      }
    }
    s.phase = 'aim'
    if (!done(s) && s.throws === 0) ev.push({ kind: 'turn', side: s.turn })
  }
  return ev
}

export const done = (s: State): boolean => s.rounds >= s.total

/** Highest total wins; equal totals are a draw. */
export function result(s: State): Side | 'draw' {
  const [r, b] = s.totals
  return r > b ? 0 : b > r ? 1 : 'draw'
}

/** The bot's target: treble 20 at the top of the board, or the bull. */
/** Bull's-eye. */
export const BULL_PT: Pt = { x: BOARD.x, y: BOARD.y }

export const T20: Pt = { x: BOARD.x, y: BOARD.y - BOARD.r * ((TREBLE_IN + TREBLE_OUT) / 2) }
