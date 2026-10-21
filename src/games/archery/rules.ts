import { other, type Side } from '../../core/game.ts'
import type { ShotParams } from '../../engines/aim/index.ts'

/**
 * Pure archery: one target in the middle, five arrows each, alternating. An
 * arrow flies straight from the bow along the aim, the aim swaying a little,
 * and wind drifts it sideways. Its range comes from the draw. Rings 10 to 1. No DOM.
 */

export const ARROWS = 5
export const TARGET = { x: 500, y: 900, r: 380 }
export const BOW: [Pt, Pt] = [
  { x: 500, y: 1600 },
  { x: 500, y: 200 },
]
/** Range at full draw, in world units. */
export const RANGE_MAX = 1000
/** Draw length (world units) for a full draw; the DragAim's maxPull. */
export const MAX_PULL = 360
export const MIN_POWER = 0.2
/** Wind drift per unit of wind strength, in world units. */
export const DRIFT = 0.2
export const WIND_MAX = 300

export interface Pt {
  x: number
  y: number
}

export interface Arrow {
  x: number
  y: number
  side: Side
  score: number
  label: string
  /** Game time it struck (for its quiver), set by the game. */
  at?: number
}

export interface Flight {
  side: Side
  from: Pt
  to: Pt
  t: number
  dur: number
  score: number
  label: string
}

export interface State {
  turn: Side
  /** Arrows shot by each side. */
  shot: [number, number]
  totals: [number, number]
  stuck: Arrow[]
  flight: Flight | null
  phase: 'aim' | 'fly' | 'beat'
  beat: number
  wind: number
  /** The draw on the side to move (synced, so the online guest sees the aim). */
  aim: ShotParams | null
  last: Arrow | null
  /** Render stamps (game time), so the online guest replays the same animations. */
  looseAt: number
  endAt: number
}

/** A small, slow sway of the aim, bigger with a bigger draw. */
export function swayAt(t: number, side: Side, power: number): number {
  const a = 0.028 + 0.02 * power
  return a * (Math.sin(t * 2.7 + side * 2.1) + 0.5 * Math.sin(t * 6.3 + side))
}

/** Where an arrow loosed now from `side` with this draw comes down. */
export function landingOf(side: Side, shot: ShotParams, t: number, wind: number): Pt {
  const a = Math.atan2(shot.dy, shot.dx) + swayAt(t, side, shot.power)
  const range = shot.power * RANGE_MAX
  return {
    x: BOW[side].x + Math.cos(a) * range + wind * DRIFT,
    y: BOW[side].y + Math.sin(a) * range,
  }
}

/** Ring 10 to 1 (10 is the centre), 0 off the target. */
export function scoreAt(p: Pt): { score: number; label: string } {
  const d = Math.hypot(p.x - TARGET.x, p.y - TARGET.y)
  if (d > TARGET.r) return { score: 0, label: 'Miss' }
  const ring = Math.max(1, 10 - Math.floor(d / (TARGET.r / 10)))
  const label = ring === 10 ? 'Bullseye!' : ring >= 8 ? 'Nice!' : `${ring}`
  return { score: ring, label }
}

export function newState(first: Side, wind: number): State {
  return {
    turn: first,
    shot: [0, 0],
    totals: [0, 0],
    stuck: [],
    flight: null,
    phase: 'aim',
    beat: 0,
    wind,
    aim: null,
    last: null,
    looseAt: -10,
    endAt: -1,
  }
}

/** Loose an arrow from the side on turn. */
export function loose(s: State, shot: ShotParams, t: number): void {
  const side = s.turn
  const to = landingOf(side, shot, t, s.wind)
  const sc = scoreAt(to)
  s.flight = { side, from: { ...BOW[side] }, to, t: 0, dur: 0.45, score: sc.score, label: sc.label }
  s.shot[side]++
  s.aim = null
  s.phase = 'fly'
}

export type Event = { kind: 'stick'; arrow: Arrow } | { kind: 'turn'; side: Side }

export function advance(s: State, dt: number, nextWind: () => number): Event[] {
  const ev: Event[] = []
  if (s.phase === 'fly' && s.flight) {
    s.flight.t += dt
    if (s.flight.t < s.flight.dur) return ev
    const f = s.flight
    const arrow: Arrow = { x: f.to.x, y: f.to.y, side: f.side, score: f.score, label: f.label }
    s.stuck.push(arrow)
    s.totals[f.side] += f.score
    s.last = arrow
    s.flight = null
    s.phase = 'beat'
    s.beat = 1.0
    ev.push({ kind: 'stick', arrow })
  } else if (s.phase === 'beat') {
    s.beat -= dt
    if (s.beat > 0) return ev
    if (done(s)) return ev
    s.turn = other(s.turn)
    s.wind = nextWind()
    s.phase = 'aim'
    ev.push({ kind: 'turn', side: s.turn })
  }
  return ev
}

/** Over once every arrow has landed (not merely been loosed), so the last one still counts. */
export const done = (s: State): boolean => s.stuck.length >= 2 * ARROWS

/** Highest total wins; equal totals draw. */
export function result(s: State): Side | 'draw' {
  const [r, b] = s.totals
  return r > b ? 0 : b > r ? 1 : 'draw'
}
