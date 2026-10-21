import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Ballistics,
  type Impact,
  launch,
  type Shell,
  simulate,
  stepShell,
} from '../../engines/aim/index.ts'

/**
 * Pure hammer throw. Each athlete spins a hammer on a handle; holding spins it
 * faster, letting go throws the ball along the handle's tangent. The angle at
 * release decides the direction: it must land inside the sector toward the far
 * end. Three throws each, alternating; the longest valid throw wins.
 */

export const THROWS = 3
/** Athletes stand at the two ends. */
export const ATHLETE: readonly { x: number; y: number }[] = [
  { x: 500, y: 1600 },
  { x: 500, y: 200 },
]
/** Length of the handle, from the athlete's centre to the ball. */
export const HANDLE = 110
/** Half-width of the sector each throw must land inside (radians). */
export const SECTOR = 0.36
/** World units per metre: the arcs are every 10 m. */
export const METRE = 30
/** Spin speed (rad/s) when the spin starts and once it is fully wound, and how long winding takes. */
export const SPIN0 = 3.2
export const SPIN1 = 7
export const WIND = 1.8
/** Ball speed as a share of the handle's speed at release. */
const LAUNCH = 0.95
/** Flight of the thrown ball: elevation 45°, low gravity for a long arc. */
export const THROW_BALLISTICS: Ballistics = { g: 900, vmax: 750, elev: 1, z0: 60 }
/** Past this, a ball has left the field: it is down wherever it is. */
const FIELD = { x0: -200, x1: 1200, y0: -200, y1: 2000 }
/** Where marks are drawn: the table itself. */
const MARK = { x0: 60, x1: 940, y0: 60, y1: 1740 }

export interface Spin {
  side: Side
  /** Seconds the spin has been held. */
  hold: number
  /** Handle angle (radians). */
  theta: number
  /** Angular speed (rad/s). */
  omega: number
}

export interface Flight {
  side: Side
  shell: Shell
  /** Release angle, for the mark. */
  theta: number
}

export interface Mark {
  side: Side
  x: number
  y: number
  /** Distance from the athlete (world units); 0 for a foul. */
  range: number
  foul: boolean
  /** Match clock when it landed (for the pop-in and the measuring sweep). */
  at: number
}

export interface State {
  turn: Side
  /** Throws each side makes in this match. */
  throws: number
  /** Throws each side has made. */
  thrown: [number, number]
  /** Longest valid throw each side has made (world units). */
  best: [number, number]
  spin: Spin | null
  flight: Flight | null
  marks: Mark[]
  phase: 'aim' | 'fly' | 'beat'
  /** Seconds left in the beat after a landing. */
  beat: number
  /** Match clock (s) and when things happened on it, so every device animates them alike. */
  t: number
  throwAt: number
  turnAt: number
  /** When the last throw landed and the result was settled; -1 while playing. */
  endAt: number
}

export type Event =
  | { kind: 'throw'; side: Side; x: number; y: number; omega: number }
  | { kind: 'land'; side: Side; x: number; y: number; range: number; foul: boolean; best: boolean }
  | { kind: 'turn'; side: Side }
  | { kind: 'whirl'; side: Side }

export function newState(starter: Side, throws = THROWS): State {
  return {
    turn: starter,
    throws,
    thrown: [0, 0],
    best: [0, 0],
    spin: null,
    flight: null,
    marks: [],
    phase: 'aim',
    beat: 0,
    t: 0,
    throwAt: -9,
    turnAt: 0,
    endAt: -1,
  }
}

/** The handle angle at which a throw leaves straight down the sector: red's points up, blue's down. */
export function idealAngle(side: Side): number {
  return side === 0 ? Math.PI : 0
}

/** Wrap an angle to [-π, π). */
export function wrap(a: number): number {
  const t = (((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return t - Math.PI
}

/** Did the handle pass `target` while turning from `from` to `to` (a small step on the circle)? */
export function passed(from: number, to: number, target: number): boolean {
  const d = wrap(target - from)
  const moved = wrap(to - from)
  return d >= 0 && d < moved
}

/** Does a release at this handle angle send the ball inside the sector? */
export function inSector(side: Side, theta: number): boolean {
  return Math.abs(wrap(theta - idealAngle(side))) <= SECTOR
}

/** Angular speed after holding for `hold` seconds. */
export function spinSpeed(hold: number): number {
  return SPIN0 + (SPIN1 - SPIN0) * Math.min(1, hold / WIND)
}

/** Where the ball is on the handle, for a handle angle. */
export function handOf(side: Side, theta: number): { x: number; y: number } {
  const a = ATHLETE[side] as { x: number; y: number }
  return { x: a.x + Math.cos(theta) * HANDLE, y: a.y + Math.sin(theta) * HANDLE }
}

/**
 * Share of the speed a release at this angle keeps: right on the ideal line the
 * whole of it, falling off toward the sector lines, so timing the release is
 * what separates a good throw from a great one.
 */
export function accuracy(side: Side, theta: number): number {
  const e = Math.min(1, Math.abs(wrap(theta - idealAngle(side))) / SECTOR)
  return 1 - 0.18 * e * e
}

/** The shot `side` makes letting go at (theta, omega): `shotOf` scaled by the release's accuracy. */
export function shotFor(
  side: Side,
  theta: number,
  omega: number,
): { dx: number; dy: number; power: number } {
  const sh = shotOf(theta, omega)
  return { ...sh, power: sh.power * accuracy(side, theta) }
}

/** The shot a release at (theta, omega) makes: direction is the handle's tangent. */
export function shotOf(theta: number, omega: number): { dx: number; dy: number; power: number } {
  const v = omega * HANDLE * LAUNCH
  return {
    dx: -Math.sin(theta),
    dy: Math.cos(theta),
    power: Math.min(1, v / THROW_BALLISTICS.vmax),
  }
}

/**
 * Where a release at this angle and speed would land, and whether it is a foul.
 * Used for the live readout while the spin is held, and by the bot.
 */
export function predict(
  side: Side,
  theta: number,
  omega: number,
): Impact & { range: number; foul: boolean } {
  const h = handOf(side, theta)
  const im = simulate(h.x, h.y, shotFor(side, theta, omega), THROW_BALLISTICS, 0, [])
  const a = ATHLETE[side] as { x: number; y: number }
  return { ...im, range: Math.hypot(im.x - a.x, im.y - a.y), foul: !inSector(side, theta) }
}

export function canSpin(s: State, side: Side): boolean {
  return s.phase === 'aim' && s.turn === side && s.spin === null && s.thrown[side] < s.throws
}

/** Begin winding a spin for `side`. */
export function startSpin(s: State, side: Side): void {
  s.spin = { side, hold: 0, theta: idealAngle(side) + Math.PI, omega: SPIN0 }
}

/** Keep the spin going for dt seconds. */
export function stepSpin(s: State, dt: number): Event[] {
  const sp = s.spin
  if (!sp) return []
  const before = Math.floor(sp.theta / Math.PI)
  sp.hold += dt
  sp.omega = spinSpeed(sp.hold)
  sp.theta += sp.omega * dt
  const ev: Event[] = []
  if (Math.floor(sp.theta / Math.PI) !== before) ev.push({ kind: 'whirl', side: sp.side })
  return ev
}

/** Let go: the ball is thrown along the handle's tangent. */
export function release(s: State): Event | null {
  const sp = s.spin
  if (!sp) return null
  const side = sp.side
  const h = handOf(side, sp.theta)
  const sh = launch(h.x, h.y, shotFor(side, sp.theta, sp.omega), THROW_BALLISTICS)
  s.flight = { side, shell: sh, theta: sp.theta }
  s.spin = null
  s.phase = 'fly'
  s.thrown[side]++
  s.throwAt = s.t
  return { kind: 'throw', side, x: h.x, y: h.y, omega: sp.omega }
}

/**
 * Fly the ball; when it lands, record the throw and start the beat. Then, once
 * the beat is over, the turn passes (or the match ends, see `leader`).
 */
export function advance(s: State, dt: number): Event[] {
  const ev: Event[] = []
  s.t += dt
  if (s.phase === 'beat') {
    s.beat -= dt
    if (s.beat <= 0 && !over(s)) {
      s.turn = other(s.turn)
      s.phase = 'aim'
      s.turnAt = s.t
      ev.push({ kind: 'turn', side: s.turn })
    }
    return ev
  }
  const f = s.flight
  if (s.phase !== 'fly' || !f) return ev
  const sh = f.shell
  for (let k = 0; k < 2; k++) {
    stepShell(sh, dt / 2, 0, THROW_BALLISTICS)
    const outside = sh.x < FIELD.x0 || sh.x > FIELD.x1 || sh.y < FIELD.y0 || sh.y > FIELD.y1
    if (sh.z > 0 && !outside) continue
    ev.push(land(s, f))
    return ev
  }
  return ev
}

function land(s: State, f: Flight): Event {
  const a = ATHLETE[f.side] as { x: number; y: number }
  const sh = f.shell
  const foul = !inSector(f.side, f.theta)
  const range = foul ? 0 : Math.hypot(sh.x - a.x, sh.y - a.y)
  const best = !foul && range > s.best[f.side]
  if (best) s.best[f.side] = range
  // A foul can sail off the table: its mark is shown at the nearest point of the table.
  const x = foul ? Math.min(MARK.x1, Math.max(MARK.x0, sh.x)) : sh.x
  const y = foul ? Math.min(MARK.y1, Math.max(MARK.y0, sh.y)) : sh.y
  s.marks.push({ side: f.side, x, y, range, foul, at: s.t })
  s.flight = null
  s.phase = 'beat'
  s.beat = 1.4
  return { kind: 'land', side: f.side, x, y, range, foul, best }
}

/** Every throw has been made and the last one has landed. */
export function over(s: State): boolean {
  return s.thrown[0] >= s.throws && s.thrown[1] >= s.throws && s.phase !== 'fly'
}

/** The side with the longest valid throw, or null when level. */
export function leader(s: State): Side | null {
  const [r, b] = s.best
  if (r === b) return null
  return r > b ? 0 : 1
}

/** Metres to one decimal, for the readouts. */
export function metres(range: number): number {
  return Math.round((range / METRE) * 10) / 10
}

/** A seeded start for the match: whoever the rng says, so both devices agree. */
export function starterOf(rng: Rng): Side {
  return rng.chance(0.5) ? 0 : 1
}
