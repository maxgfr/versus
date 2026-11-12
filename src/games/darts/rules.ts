import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure darts, played to the official x01 rules: each player starts on 501 (or
 * 301) and every dart is taken off. The leg is won by reaching exactly zero
 * with a double (the bull counts as a double). Going below zero, to one, or to
 * zero without a double is a bust: the visit stops and the score goes back to
 * what it was before it. Three darts a visit; a match is first to N legs, the
 * player who throws first alternating from leg to leg.
 *
 * A flick sets where the dart lands: the flick vector,
 * measured against the ideal flick that would hit the centre from the thrower's
 * edge, moves the landing point. How fast the finger is moving when it lets go
 * matters too: a limp release lobs the dart and it sags short, a crisp one flies
 * true, and a wild one wobbles. No DOM.
 */

/** The official starting score, and the shorter 301 game. */
export const START = 501
export const STARTS = [501, 301] as const
export const DARTS_PER_TURN = 3
/** r keeps the number ring clear of the pause button at the left edge. */
export const BOARD = { x: 500, y: 900, r: 370 }
/** Board units per world unit of flick error. */
export const DART_K = 1.2
/** Release speeds (world units/s): below SOFT the dart sags, above WILD it starts to wobble. */
export const SOFT = 650
export const WILD = 2200
/** Release speed past WILD at which the wobble is full. */
export const WOBBLE_SPEED = 4200
/** How far (board units) a dart let go with no speed at all sags short. */
export const SAG = 48
/** Wobble (board units, one sigma) of a clean release, and of the wildest. */
const SIGMA_MIN = 4
const SIGMA_MAX = 32
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
  /** How hard it went in, 0..1 (its thunk and quiver). */
  force: number
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
  /** How hard it was thrown, 0..1. */
  force: number
}

export interface State {
  turn: Side
  /** Who threw first in this leg: a round ends when the turn comes back to them. */
  first: Side
  /** Darts thrown by the side on turn in its current visit (0..3). */
  throws: number
  /** Completed rounds of this leg (a red visit and a blue visit each). */
  rounds: number
  /** Every leg starts on this score (501 or 301). */
  start: number
  /** Points each side still has to score, down to an exact zero on a double. */
  left: [number, number]
  /** The thrower's score before this visit: a bust goes back to it. */
  visitFrom: number
  /** This visit went bust. */
  bust: boolean
  /** Legs won, and the legs that take the match. */
  legs: [number, number]
  goal: number
  /** Who just checked out (the leg is over, pausing before the next), or null. */
  checkout: Side | null
  /** The match winner once decided. */
  winner: Side | null
  darts: Dart[]
  flight: Flight | null
  phase: 'aim' | 'fly' | 'beat'
  beat: number
  /** The dart that just stuck, for its float. */
  last: Dart | null
  /** Where the flick being made would land (synced for the online guest). */
  aim: Pt | null
  /** The finger's speed right now while aiming (world units/s), for the reticle's force read-out. */
  aimSpeed: number
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

/** One-sigma wobble (board units) of a dart released at `speed`: tight when crisp, wide when wild. */
export function spreadOf(speed: number): number {
  const k = Math.min(1, Math.max(0, (speed - WILD) / (WOBBLE_SPEED - WILD)))
  return SIGMA_MIN + (SIGMA_MAX - SIGMA_MIN) * k
}

/** How far (board units) a dart released at `speed` falls short of its line. */
export function sagOf(speed: number): number {
  return speed >= SOFT ? 0 : SAG * (1 - Math.max(0, speed) / SOFT)
}

/** The sag as an offset: short of the line means back toward the thrower's own edge. */
export function sagVec(side: Side, speed: number): Pt {
  const d = sagOf(speed)
  return { x: 0, y: side === 0 ? d : -d }
}

/** 0..1: how hard a dart released at `speed` hits (its thunk, quiver and flight time). */
export function forceOf(speed: number): number {
  return Math.min(1, Math.max(0, speed / WOBBLE_SPEED))
}

/** Wobble of a human flick: a gaussian whose spread grows once the release gets wild. */
export function wobble(rng: Rng, speed: number): Pt {
  const sigma = spreadOf(speed)
  return { x: gauss(rng) * sigma, y: gauss(rng) * sigma }
}

/** Where a human flick released at `speed` lands: its line, the sag of a soft release, the wobble. */
export function release(side: Side, flick: Pt, speed: number, rng: Rng): Pt {
  const w = wobble(rng, speed)
  const sag = sagVec(side, speed)
  return landingOf(side, flick, { x: w.x + sag.x, y: w.y + sag.y })
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

export function newState(first: Side, goal = 1, start = START): State {
  return {
    turn: first,
    first,
    throws: 0,
    rounds: 0,
    start,
    left: [start, start],
    visitFrom: start,
    bust: false,
    legs: [0, 0],
    goal,
    checkout: null,
    winner: null,
    darts: [],
    flight: null,
    phase: 'aim',
    beat: 0,
    last: null,
    aim: null,
    aimSpeed: 0,
    roundAt: 0,
    turnAt: 0,
    endAt: -1,
  }
}

/** Throw: the dart flies from the edge to `to`, and sticks when it lands. Harder throws fly faster. */
export function throwDart(s: State, to: Pt, force = 0.5): void {
  const sc = scoreAt(to)
  s.flight = {
    side: s.turn,
    to: sc.ring === 'miss' ? clampOut(to) : to,
    t: 0,
    dur: 0.5 - 0.22 * Math.min(1, Math.max(0, force)),
    pts: sc.pts,
    label: sc.label,
    ring: sc.ring,
    force,
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
  | { kind: 'stick'; dart: Dart }
  | { kind: 'turn'; side: Side }
  | { kind: 'round'; n: number }
  | { kind: 'bust'; side: Side }
  | { kind: 'checkout'; side: Side }
  | { kind: 'leg'; n: number }

/** A dart that may finish a leg: any double, and the bull (the double of the outer bull). */
export const isDouble = (ring: Ring): boolean => ring === 'double' || ring === 'bull'

/**
 * What a dart scoring `pts` on `ring` does to a side with `left` to go: the
 * new score, a bust (below zero, one, or zero not on a double) or the
 * checkout (exactly zero on a double).
 */
export function scoreDart(left: number, pts: number, ring: Ring): 'bust' | 'checkout' | number {
  const rem = left - pts
  if (rem === 0 && isDouble(ring)) return 'checkout'
  if (rem < 2) return 'bust'
  return rem
}

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
      force: f.force,
    }
    s.darts.push(dart)
    s.throws++
    s.last = dart
    s.flight = null
    s.phase = 'beat'
    ev.push({ kind: 'stick', dart })
    const after = scoreDart(s.left[f.side], f.pts, f.ring)
    if (after === 'checkout') {
      s.left[f.side] = 0
      s.checkout = f.side
      s.beat = 1.8
      ev.push({ kind: 'checkout', side: f.side })
    } else if (after === 'bust') {
      // The visit is over and none of it counts.
      s.left[f.side] = s.visitFrom
      s.bust = true
      s.throws = DARTS_PER_TURN
      s.beat = 1.2
      ev.push({ kind: 'bust', side: f.side })
    } else {
      s.left[f.side] = after
      s.beat = s.throws >= DARTS_PER_TURN ? 0.95 : 0.5
    }
    return ev
  }
  if (s.phase === 'beat') {
    s.beat -= dt
    if (s.beat > 0) return ev
    if (s.checkout !== null) {
      const w = s.checkout
      s.checkout = null
      s.legs[w]++
      if (s.legs[w] >= s.goal) {
        s.winner = w
        return ev
      }
      newLeg(s)
      ev.push({ kind: 'leg', n: s.legs[0] + s.legs[1] + 1 })
      ev.push({ kind: 'turn', side: s.turn })
      return ev
    }
    if (s.throws >= DARTS_PER_TURN) {
      s.throws = 0
      s.turn = other(s.turn)
      s.visitFrom = s.left[s.turn]
      s.bust = false
      // A round is one visit each: it ends when the turn is back with whoever opened.
      if (s.turn === s.first) {
        s.rounds++
        ev.push({ kind: 'round', n: s.rounds })
      }
    }
    s.phase = 'aim'
    if (s.throws === 0) ev.push({ kind: 'turn', side: s.turn })
  }
  return ev
}

/** The next leg: both back on the starting score, the other player throwing first. */
function newLeg(s: State): void {
  s.first = other(s.first)
  s.turn = s.first
  s.throws = 0
  s.rounds = 0
  s.left = [s.start, s.start]
  s.visitFrom = s.start
  s.bust = false
  s.darts = []
  s.last = null
  s.phase = 'aim'
}

export const done = (s: State): boolean => s.winner !== null

/** Who took the match (a leg always has a winner: there are no draws in darts). */
export function result(s: State): Side | 'draw' {
  return s.winner ?? 'draw'
}

/** The double that finishes `left` with one dart (`D16`, `Bull`), or null if none does. */
export function finishOf(left: number): string | null {
  if (left === 50) return 'Bull'
  if (left >= 2 && left <= 40 && left % 2 === 0) return `D${left / 2}`
  return null
}

/** The bot's target: treble 20 at the top of the board, or the bull. */
/** Bull's-eye. */
export const BULL_PT: Pt = { x: BOARD.x, y: BOARD.y }

export const T20: Pt = { x: BOARD.x, y: BOARD.y - BOARD.r * ((TREBLE_IN + TREBLE_OUT) / 2) }
