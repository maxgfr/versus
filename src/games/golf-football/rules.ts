import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import {
  type Ballistics,
  launch,
  type Shell,
  type ShotParams,
  stepShell,
  trace,
} from '../../engines/aim/index.ts'

/**
 * Pure field goals: two posts at the far ends of one pitch, kicks alternate and
 * walk back from the posts. A kick is good when it crosses the goal line between
 * the posts, above the bar and below the ceiling. Like a shoot-out, the regular
 * kicks stop as soon as one side cannot catch up; level after them is sudden
 * death. The swipe's length sets the power, its speed the loft: a slow swipe
 * floats a high kick, a snappy one drives it low and fast (less time in the
 * wind). No DOM.
 */

export const KICKS = 5
/** Kick spots, measured from the goal line: each round the kicker stands farther back. */
export const SPOT_DIST = [320, 460, 600, 740, 880]
/** Sudden death: each round the kickers stand a little farther back, up to the last spot. */
export const SUDDEN_DIST = [820, 900, 980, 1060, 1100]
export const SUDDEN_KICKS = 24
export const BALL: Ballistics = { g: 900, vmax: 1000, elev: 1.1, z0: 30 }
export const WIND_MAX = 100
/** Swipe length for full power, in world units. */
export const SWIPE_MAX = 380
export const SWIPE_MIN = 40
/** Crossbar height, and the height above which a kick sails over the top. */
export const BAR = 200
export const CEIL = 320
export const POST_HALF = 120
export const GOAL_X = 500
export const GOAL_TOP = 330
export const GOAL_BOT = 1470
/** Half thickness of an upright and of the crossbar: a kick that clips one rings off it. */
export const POST_R = 14
export const BAR_R = 12

export type Outcome = 'good' | 'low' | 'over' | 'wide' | 'short' | 'post' | 'bar'

/** A kick: direction and power, plus its loft (1 = neutral, higher floats, lower drives). */
export interface Swing extends ShotParams {
  loft?: number
}

export const LOFT_HIGH = 1.35
export const LOFT_LOW = 0.8
/** Swipe speeds (world units/s) at the two ends of the loft range. */
export const SWIPE_SLOW = 700
export const SWIPE_FAST = 3400

/** The loft a swipe of this speed gives: slow floats, fast drives. */
export function loftOf(speed: number): number {
  const k = Math.min(1, Math.max(0, (speed - SWIPE_SLOW) / (SWIPE_FAST - SWIPE_SLOW)))
  return LOFT_HIGH + (LOFT_LOW - LOFT_HIGH) * k
}

/** The kick's flight for a loft: range goes as v² · elev, so speed scales by 1/√loft to keep the range. */
export function ballOf(loft = 1): Ballistics {
  return { ...BALL, elev: BALL.elev * loft, vmax: BALL.vmax / Math.sqrt(loft) }
}

export interface Spot {
  x: number
  y: number
  d: number
}

/** A kick in the air. `py` is the previous ground y, to catch the goal line. */
export type Kick = Shell & { side: Side; py: number }

export interface State {
  turn: Side
  /** Each side's spots, in kick order (regular kicks, then sudden death). */
  spots: [Spot[], Spot[]]
  /** Regular kicks each before sudden death (the match length). */
  regular: number
  kicks: [number, number]
  points: [number, number]
  sudden: boolean
  phase: 'aim' | 'fly' | 'beat'
  kick: Kick | null
  /** The last outcome, shown for a beat. */
  last: { side: Side; outcome: Outcome } | null
  /** Every kick so far per side: true = good. */
  log: [boolean[], boolean[]]
  beat: number
  wind: number
  aiming: Swing | null
  /** Render stamps (game time), so the online guest replays the same animations. */
  kickAt: number
  outAt: number
  suddenAt: number
  endAt: number
}

export type Event =
  | { kind: 'kick'; side: Side; outcome: Outcome; x: number; y: number; z: number }
  | { kind: 'turn'; side: Side }
  | { kind: 'sudden' }
  | { kind: 'bounce'; x: number; y: number; speed: number }

export const goalY = (side: Side): number => (side === 0 ? GOAL_TOP : GOAL_BOT)
/** Forward for a side's kick, in world y: red kicks up the pitch, blue down. */
export const forwardY = (side: Side): number => (side === 0 ? -1 : 1)

/** Distances of `n` regular spots: evenly spread from the nearest default spot to the farthest. */
function regularDists(n: number): number[] {
  const near = SPOT_DIST[0] ?? 320
  const far = SPOT_DIST[SPOT_DIST.length - 1] ?? 880
  return Array.from({ length: n }, (_, i) => (n === 1 ? near : near + ((far - near) * i) / (n - 1)))
}

function spotsFor(rng: Rng, side: Side, regular: number): Spot[] {
  const out: Spot[] = []
  const ds = regularDists(regular)
  for (let i = 0; i < SUDDEN_KICKS; i++)
    ds.push(SUDDEN_DIST[Math.min(i, SUDDEN_DIST.length - 1)] ?? 1150)
  for (const d of ds) {
    const x = Math.round(GOAL_X + rng.range(-90, 90))
    const y = side === 0 ? GOAL_TOP + d : GOAL_BOT - d
    out.push({ x, y, d })
  }
  return out
}

export function newState(rng: Rng, first: Side, wind: number, regular = KICKS): State {
  return {
    turn: first,
    spots: [spotsFor(rng, 0, regular), spotsFor(rng, 1, regular)],
    regular,
    kicks: [0, 0],
    points: [0, 0],
    sudden: false,
    phase: 'aim',
    kick: null,
    last: null,
    log: [[], []],
    beat: 0,
    wind,
    aiming: null,
    kickAt: -10,
    outAt: -10,
    suddenAt: -10,
    endAt: -1,
  }
}

/** The spot the side on turn kicks from next. */
export function spotOf(s: State, side: Side): Spot {
  const list = s.spots[side]
  return (list[Math.min(s.kicks[side], list.length - 1)] ?? { x: GOAL_X, y: 0, d: 0 }) as Spot
}

export function fire(s: State, shot: Swing): void {
  const spot = spotOf(s, s.turn)
  s.kick = { ...launch(spot.x, spot.y, shot, ballOf(shot.loft)), side: s.turn, py: spot.y }
  s.aiming = null
  s.phase = 'fly'
}

/** The preview of a swipe from the spot (dotted arc, as in the aim engine). */
export function previewOf(
  s: State,
  side: Side,
  shot: Swing,
): { x: number; y: number; z: number }[] {
  const spot = spotOf(s, side)
  return trace(spot.x, spot.y, shot, ballOf(shot.loft), s.wind, 0.6)
}

/** Two substeps per frame so a fast kick cannot skip the goal line. */
export function stepKick(k: Kick, wind: number): Outcome | null {
  for (let i = 0; i < 2; i++) {
    const py = k.y
    stepShell(k, 1 / 120, wind, BALL)
    const goal = goalY(k.side)
    const crossed = k.side === 0 ? py > goal && k.y <= goal : py < goal && k.y >= goal
    if (crossed) {
      const off = Math.abs(k.x - GOAL_X)
      if (Math.abs(off - POST_HALF) < POST_R && k.z <= CEIL) return 'post'
      if (off > POST_HALF) return 'wide'
      if (Math.abs(k.z - BAR) < BAR_R) return 'bar'
      if (k.z < BAR) return 'low'
      if (k.z > CEIL) return 'over'
      return 'good'
    }
    if (k.z <= 0) return 'short'
    if (k.x < -200 || k.x > W + 200) return 'wide'
  }
  return null
}

/** Fly a kick to its outcome without touching state (the bot's look-ahead). */
export function runKick(
  s: State,
  side: Side,
  shot: Swing,
  wind: number,
): { outcome: Outcome; x: number; z: number } {
  const spot = spotOf(s, side)
  const k: Kick = { ...launch(spot.x, spot.y, shot, ballOf(shot.loft)), side, py: spot.y }
  for (let i = 0; i < 60 * 6; i++) {
    const outcome = stepKick(k, wind)
    if (outcome) return { outcome, x: k.x, z: k.z }
  }
  return { outcome: 'wide', x: k.x, z: k.z }
}

export function advance(s: State, dt: number, nextWind: () => number): Event[] {
  const ev: Event[] = []
  if (s.phase === 'fly' && s.kick) {
    const k = s.kick
    const out = stepKick(k, s.wind)
    if (out) {
      if (out === 'good') s.points[k.side]++
      s.kicks[k.side]++
      s.last = { side: k.side, outcome: out }
      s.log[k.side].push(out === 'good')
      ev.push({ kind: 'kick', side: k.side, outcome: out, x: k.x, y: k.y, z: k.z })
      // The ball plays on through the beat: off the woodwork it springs back.
      if (out === 'post' || out === 'bar') {
        k.vy *= -0.4
        k.vx *= 0.6
        if (out === 'bar') k.vz = Math.abs(k.vz) * 0.3 + 120
      }
      s.phase = 'beat'
      s.beat = 1.3
    }
  } else if (s.phase === 'beat') {
    const k = s.kick
    if (k) {
      stepShell(k, dt, s.wind, BALL)
      if (k.z < 0) {
        k.z = 0
        const vz = -k.vz
        if (vz > 140) ev.push({ kind: 'bounce', x: k.x, y: k.y, speed: vz })
        k.vz = vz > 80 ? vz * 0.45 : 0
        k.vx *= 0.7
        k.vy *= 0.7
      }
    }
    s.beat -= dt
    if (s.beat > 0) return ev
    const level = s.kicks[0] === s.kicks[1] && s.kicks[0] >= s.regular
    if (level && s.points[0] !== s.points[1]) return ev
    if (level && !s.sudden) {
      s.sudden = true
      ev.push({ kind: 'sudden' })
    }
    s.kick = null
    s.turn = other(s.turn)
    s.wind = nextWind()
    s.phase = 'aim'
    ev.push({ kind: 'turn', side: s.turn })
  }
  return ev
}

/**
 * The winner once decided. During the regular kicks, as soon as one side leads
 * by more than the other has kicks left. After them (and in sudden death),
 * when both have kicked as often and the points differ.
 */
export function result(s: State): Side | null {
  if (!s.sudden && s.kicks[0] <= s.regular && s.kicks[1] <= s.regular) {
    const left: [number, number] = [s.regular - s.kicks[0], s.regular - s.kicks[1]]
    if (s.points[0] > s.points[1] + left[1]) return 0
    if (s.points[1] > s.points[0] + left[0]) return 1
  }
  if (s.kicks[0] !== s.kicks[1] || s.kicks[0] < s.regular) return null
  if (s.points[0] === s.points[1]) return null
  return s.points[0] > s.points[1] ? 0 : 1
}

export const isOver = (s: State): boolean => result(s) !== null
