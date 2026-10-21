import { other, type Side } from '../../core/game.ts'
import { H, W } from '../../core/stage.ts'
import {
  type Ballistics,
  launch,
  type Shell,
  type ShotParams,
  stepShell,
} from '../../engines/aim/index.ts'

/**
 * Pure cup pong. Players take turns flicking one ball across the table at the
 * rival's cups. The ball may touch the table once: it can bounce once and
 * still drop in. A ball in a cup takes the cup. First to sink the rival's
 * goal (all six cups by default) wins.
 */

/** Cups on each side: the most a match can need. */
export const CUPS = 6
/** Flight of the ball: gravity on height, launch speed, elevation and launch height. */
export const BALL: Ballistics = { g: 1400, vmax: 1400, elev: 1, z0: 50 }
/**
 * A flick this long (world units) is a full-power shot. Full power overshoots the
 * table; the far edge is reached at about two-thirds power, so flicks much over
 * ~190 px go out. The rival's cups sit at about 0.55 to 0.6 power, so 800 puts
 * them at a natural 160 to 180 px flick.
 */
export const FULL_FLICK = 800
/** Shortest flick that counts. */
export const MIN_FLICK = 40
/** Cup radius (drawn) and the inner radius a landing must be inside to drop in. */
export const CUP_R = 50
export const IN_R = 44
/** Where each side's ball rests before its flick: in front of its own cups, toward the middle. */
export const ORIGIN_Y: readonly number[] = [1290, 510]
export const ORIGIN_X = W / 2
/** Share of energy kept on the one allowed table bounce. */
const BOUNCE = 0.42
const SLIDE = 0.7

export interface Cup {
  side: Side
  x: number
  y: number
  alive: boolean
  /** Seconds since it was sunk (for the splash). */
  fall: number
}

export interface Ball {
  side: Side
  shell: Shell
  /** Table bounces so far (at most one). */
  bounces: number
}

export interface State {
  turn: Side
  /** Cups each side must sink to win this match. */
  goal: number
  cups: Cup[]
  ball: Ball | null
  /** aim: the turn's player may flick. fly: a ball is in the air. beat: a short pause after a shot. */
  phase: 'aim' | 'fly' | 'beat'
  /** Seconds left in the beat. */
  beat: number
  /** The flick being held right now (drawn as a preview). */
  aiming: ShotParams | null
  /** Match clock (s), and when the current turn began: animations are stamped on it so every device plays them alike. */
  t: number
  turnAt: number
}

export type Event =
  | { kind: 'bounce'; x: number; y: number }
  | { kind: 'cup'; side: Side; cup: number; x: number; y: number; left: number }
  | { kind: 'miss'; side: Side; x: number; y: number; out: boolean }
  | { kind: 'turn'; side: Side }

/** The six cups of `side`: a triangle at its own end of the table, apex toward the middle. */
export function cupsOf(side: Side): Cup[] {
  const pts: [number, number][] = [
    [500, 1400],
    [440, 1496],
    [560, 1496],
    [380, 1592],
    [500, 1592],
    [620, 1592],
  ]
  return pts.map(([x, y]) => {
    const p = side === 0 ? { x, y } : { x: W - x, y: H - y }
    return { side, x: p.x, y: p.y, alive: true, fall: 0 }
  })
}

export function newState(starter: Side, goal = CUPS): State {
  return {
    turn: starter,
    goal,
    cups: [...cupsOf(0), ...cupsOf(1)],
    ball: null,
    phase: 'aim',
    beat: 0,
    aiming: null,
    t: 0,
    turnAt: 0,
  }
}

export function originOf(side: Side): { x: number; y: number } {
  return { x: ORIGIN_X, y: ORIGIN_Y[side] ?? 0 }
}

/** Cups still standing on `side`'s end. */
export function standing(s: State, side: Side): number {
  return s.cups.filter((c) => c.side === side && c.alive).length
}

/** Rival cups `side` has sunk so far. */
export function sunkBy(s: State, side: Side): number {
  return s.cups.filter((c) => c.side === other(side) && !c.alive).length
}

/** Index of a standing rival cup the ball at (x, y) drops into, or -1. */
export function cupAt(s: State, side: Side, x: number, y: number): number {
  for (let i = 0; i < s.cups.length; i++) {
    const c = s.cups[i]
    if (!c || !c.alive || c.side !== other(side)) continue
    if (Math.hypot(x - c.x, y - c.y) < IN_R) return i
  }
  return -1
}

/** Is a ground point on the table (with a little margin for the rim)? */
export function onTable(x: number, y: number): boolean {
  return x > -30 && x < W + 30 && y > -30 && y < H + 30
}

/**
 * A flick from the rest point of `side`. The direction is the flick's, the speed
 * grows with its length. Null if the flick is too short or not toward the rival.
 */
export function shotFromFlick(side: Side, dx: number, dy: number): ShotParams | null {
  const len = Math.hypot(dx, dy)
  if (len < MIN_FLICK) return null
  const forward = side === 0 ? -dy : dy
  if (forward < len * 0.35) return null
  return {
    dx: dx / len,
    dy: dy / len,
    power: Math.min(1, Math.max(0.2, len / FULL_FLICK)),
  }
}

/** Start a flight from `side`'s rest point. */
export function fire(s: State, side: Side, shot: ShotParams): void {
  const o = originOf(side)
  s.ball = { side, shell: launch(o.x, o.y, shot, BALL), bounces: 0 }
  s.phase = 'fly'
  s.aiming = null
}

/**
 * Advance the flight (and the pause after it). Returns the events. `winner`
 * is set when the shot leaves one side without cups.
 */
export function advance(s: State, dt: number): { events: Event[]; winner: Side | null } {
  const events: Event[] = []
  s.t += dt
  for (const c of s.cups) if (!c.alive) c.fall += dt
  if (s.phase === 'beat') {
    s.beat -= dt
    if (s.beat <= 0) {
      const winner = standingWinner(s)
      if (winner === null) {
        s.turn = other(s.turn)
        s.phase = 'aim'
        s.turnAt = s.t
        events.push({ kind: 'turn', side: s.turn })
      }
      return { events, winner }
    }
    return { events, winner: null }
  }
  if (s.phase !== 'fly' || !s.ball) return { events, winner: null }
  const ball = s.ball
  const sh = ball.shell
  // Two substeps so a fast ball cannot skip the thin contact with a landing.
  for (let k = 0; k < 2; k++) {
    stepShell(sh, dt / 2, 0, BALL)
    if (!onTable(sh.x, sh.y)) {
      events.push({ kind: 'miss', side: ball.side, x: sh.x, y: sh.y, out: true })
      return end(s, events)
    }
    if (sh.z > 0) continue
    // The ball has touched the table.
    sh.z = 0
    const i = cupAt(s, ball.side, sh.x, sh.y)
    if (i >= 0) {
      const cup = s.cups[i]
      if (cup) {
        cup.alive = false
        cup.fall = 0
        events.push({
          kind: 'cup',
          side: ball.side,
          cup: i,
          x: cup.x,
          y: cup.y,
          left: s.goal - sunkBy(s, ball.side),
        })
      }
      return end(s, events)
    }
    if (ball.bounces === 0) {
      ball.bounces = 1
      sh.vz = -sh.vz * BOUNCE
      sh.vx *= SLIDE
      sh.vy *= SLIDE
      events.push({ kind: 'bounce', x: sh.x, y: sh.y })
      continue
    }
    events.push({ kind: 'miss', side: ball.side, x: sh.x, y: sh.y, out: false })
    return end(s, events)
  }
  return { events, winner: null }
}

function end(s: State, events: Event[]): { events: Event[]; winner: Side | null } {
  s.ball = null
  s.phase = 'beat'
  s.beat = 1.0
  return { events, winner: null }
}

/** The side that has sunk the goal's number of the other's cups, if any. */
export function standingWinner(s: State): Side | null {
  if (sunkBy(s, 1) >= s.goal) return 1
  if (sunkBy(s, 0) >= s.goal) return 0
  return null
}

/** Full-length ground track of a shot from `side`, unbounced: where it would land first. */
export function landingOf(side: Side, shot: ShotParams): { x: number; y: number } {
  const o = originOf(side)
  const sh = launch(o.x, o.y, shot, BALL)
  for (let i = 0; i < 1200; i++) {
    stepShell(sh, 1 / 120, 0, BALL)
    if (sh.z <= 0) break
  }
  return { x: sh.x, y: sh.y }
}
