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
 * rival's cups. Cups stand CUP_H tall: a ball that comes down inside a rival
 * rim takes the cup, one that clips a rim pops back up, one that runs into a
 * cup's wall bounces off it. The ball may touch the table once and still drop
 * in off the bounce. First to sink the rival's goal (all six cups by default)
 * wins.
 *
 * The flick's length sets how far the ball goes; its speed sets the arc: a
 * snappy flick fires a fast, flat ball, a slow push a floaty lob that lands in
 * the same place.
 */

/** Cups on each side: the most a match can need. */
export const CUPS = 6
/** Flight of the ball (a neutral arc): gravity on height, launch speed, elevation and launch height. */
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
/** Cup radius (drawn) and the inner radius a ball must come down inside to drop in. */
export const CUP_R = 50
export const IN_R = 44
/** How tall a cup stands: the rim is drawn this high up. */
export const CUP_H = 90
export const BALL_R = 14
/** Where each side's ball rests before its flick: in front of its own cups, toward the middle. */
export const ORIGIN_Y: readonly number[] = [1290, 510]
export const ORIGIN_X = W / 2
/** Share of the fall speed kept on the one allowed table bounce: enough to clear a rim. */
const BOUNCE = 0.66
const SLIDE = 0.7
/** Arc range: a slow push lobs (steeper), a fast flick drives (flatter). */
export const ARC_LOB = 1.3
export const ARC_DRIVE = 0.7
/** Flick speeds (world units/s) at the two ends of the arc range. */
export const FLICK_SLOW = 500
export const FLICK_FAST = 3200
const SUBSTEPS = 4

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
  /** Rim and wall touches so far. */
  rims: number
}

/** A flick: direction and power like any aimed shot, plus its arc (elevation ratio, 1 = neutral). */
export interface Flick extends ShotParams {
  arc?: number
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
  aiming: Flick | null
  /** Match clock (s), and when the current turn began: animations are stamped on it so every device plays them alike. */
  t: number
  turnAt: number
}

export type Event =
  | { kind: 'bounce'; x: number; y: number; speed: number }
  | { kind: 'rim'; x: number; y: number; speed: number; cup: number }
  | {
      kind: 'cup'
      side: Side
      cup: number
      x: number
      y: number
      left: number
      speed: number
      rims: number
      bounced: boolean
    }
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

/** Index of a standing rival cup whose rim the point (x, y) is inside, or -1. */
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

/** The arc a flick of this speed (world units/s) throws: slow lobs, fast drives. */
export function arcOf(speed: number): number {
  const k = Math.min(1, Math.max(0, (speed - FLICK_SLOW) / (FLICK_FAST - FLICK_SLOW)))
  return ARC_LOB + (ARC_DRIVE - ARC_LOB) * k
}

/**
 * The ball's flight for an arc. Range on the flat goes as v² · elev, so the
 * launch speed scales by 1/√arc: a lob and a drive of the same power land
 * (almost) together, the drive gets there much sooner.
 */
export function ballistics(arc = 1): Ballistics {
  return { ...BALL, elev: arc, vmax: BALL.vmax / Math.sqrt(arc) }
}

/**
 * A flick from the rest point of `side`. The direction is the flick's, the range
 * grows with its length, the arc with its speed. Null if the flick is too short
 * or not toward the rival.
 */
export function shotFromFlick(side: Side, dx: number, dy: number, speed?: number): Flick | null {
  const len = Math.hypot(dx, dy)
  if (len < MIN_FLICK) return null
  const forward = side === 0 ? -dy : dy
  if (forward < len * 0.35) return null
  const shot: Flick = {
    dx: dx / len,
    dy: dy / len,
    power: Math.min(1, Math.max(0.2, len / FULL_FLICK)),
  }
  if (speed !== undefined) shot.arc = arcOf(speed)
  return shot
}

/** Start a flight from `side`'s rest point. */
export function fire(s: State, side: Side, shot: Flick): void {
  const o = originOf(side)
  s.ball = { side, shell: launch(o.x, o.y, shot, ballistics(shot.arc)), bounces: 0, rims: 0 }
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
  // Substeps: a fast drive moves under 8 units each, far less than a cup wall.
  for (let k = 0; k < SUBSTEPS; k++) {
    const pz = sh.z
    stepShell(sh, dt / SUBSTEPS, 0, BALL)
    if (!onTable(sh.x, sh.y)) {
      events.push({ kind: 'miss', side: ball.side, x: sh.x, y: sh.y, out: true })
      return end(s, events)
    }
    if (touchCups(s, ball, pz, events)) return end(s, events)
    if (sh.z > 0) continue
    // The ball has touched the table.
    sh.z = 0
    if (ball.bounces === 0) {
      ball.bounces = 1
      const speed = -sh.vz
      sh.vz = -sh.vz * BOUNCE
      sh.vx *= SLIDE
      sh.vy *= SLIDE
      events.push({ kind: 'bounce', x: sh.x, y: sh.y, speed })
      continue
    }
    events.push({ kind: 'miss', side: ball.side, x: sh.x, y: sh.y, out: false })
    return end(s, events)
  }
  return { events, winner: null }
}

/**
 * The ball against the standing cups, after a substep (`pz` is its height
 * before it). Inside a rim and below it: in the cup (a rival's cup is taken,
 * the thrower's own just swallows the ball). Coming down onto the rim ring:
 * pops back up and out. Running into the wall below the rim: bounces off.
 * Returns true when the shot is over.
 */
function touchCups(s: State, ball: Ball, pz: number, events: Event[]): boolean {
  const sh = ball.shell
  if (sh.z >= CUP_H) return false
  for (let i = 0; i < s.cups.length; i++) {
    const c = s.cups[i] as Cup
    if (!c.alive) continue
    const dx = sh.x - c.x
    const dy = sh.y - c.y
    const d = Math.hypot(dx, dy)
    if (d >= CUP_R + BALL_R) continue
    if (d < IN_R) {
      if (c.side === ball.side) {
        events.push({ kind: 'miss', side: ball.side, x: c.x, y: c.y, out: false })
        return true
      }
      c.alive = false
      c.fall = 0
      events.push({
        kind: 'cup',
        side: ball.side,
        cup: i,
        x: c.x,
        y: c.y,
        left: s.goal - sunkBy(s, ball.side),
        speed: Math.hypot(sh.vx, sh.vy, sh.vz),
        rims: ball.rims,
        bounced: ball.bounces > 0,
      })
      return true
    }
    // Outside the inner rim but touching the cup: push the ball out to the wall.
    const nx = d > 1e-6 ? dx / d : 1
    const ny = d > 1e-6 ? dy / d : 0
    const speed = Math.hypot(sh.vx, sh.vy, sh.vz)
    const vn = sh.vx * nx + sh.vy * ny
    if (pz >= CUP_H) {
      // Came down on the rim: it pops up and rolls off outward.
      sh.z = CUP_H
      sh.vz = Math.abs(sh.vz) * 0.45
      const out = Math.max(90, Math.abs(vn) * 0.5)
      sh.vx = sh.vx * 0.6 + nx * (out - vn * 0.6)
      sh.vy = sh.vy * 0.6 + ny * (out - vn * 0.6)
    } else {
      // Ran into the wall below the rim: reflect off it, losing pace.
      sh.x = c.x + nx * (CUP_R + BALL_R)
      sh.y = c.y + ny * (CUP_R + BALL_R)
      if (vn < 0) {
        sh.vx = (sh.vx - 2 * vn * nx) * 0.5
        sh.vy = (sh.vy - 2 * vn * ny) * 0.5
      }
    }
    ball.rims++
    events.push({ kind: 'rim', x: c.x + nx * CUP_R, y: c.y + ny * CUP_R, speed, cup: i })
    return false
  }
  return false
}

function end(s: State, events: Event[]): { events: Event[]; winner: Side | null } {
  s.ball = null
  s.phase = 'beat'
  s.beat = 0.9
  return { events, winner: null }
}

/** The side that has sunk the goal's number of the other's cups, if any. */
export function standingWinner(s: State): Side | null {
  if (sunkBy(s, 1) >= s.goal) return 1
  if (sunkBy(s, 0) >= s.goal) return 0
  return null
}

/**
 * Where a shot from `side` first comes down through height `z` (the table by
 * default, a rim at CUP_H), ignoring the cups: its ground track.
 */
export function landingOf(side: Side, shot: Flick, z = 0): { x: number; y: number } {
  const o = originOf(side)
  const b = ballistics(shot.arc)
  const sh = launch(o.x, o.y, shot, b)
  for (let i = 0; i < 1200; i++) {
    stepShell(sh, 1 / 120, 0, b)
    if (sh.z <= z && sh.vz < 0) break
  }
  return { x: sh.x, y: sh.y }
}
