import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { type Box, type Disc, disc, driveTo, rink } from '../../engines/puck/index.ts'

/**
 * Pure table tennis, seen from above. Two round bats slide along their own
 * edge; a ball bounces off the side walls and leaves the table at either end.
 * No DOM, no sound: events describe what happened for the juice layer.
 */

/** The table: open at both ends (no goal mouths, no rounded corners). Each end leaves room for its player's scoreboard. */
export const TABLE = rink({ x0: 70, y0: 190, x1: 930, y1: 1610, corner: 0, goal: 0 })
export const BAT_R = 84
export const BALL_R = 28
/** How far a bat may stray from its own edge, measured from the midline (near / far). */
export const BAT_NEAR = 300
export const BAT_FAR = 620
/** Resting height of each bat between rallies (the bot waits here). */
export const REST_Y: [number, number] = [MID + 500, MID - 500]
const MAX_ANGLE = 0.95
const BASE_SPEED = 950
const RAMP = 45
const MAX_SPEED = 2100
const SERVE_SPREAD = 260
const SUBSTEPS = 4
export const POINT_PAUSE = 1.1

export interface World {
  ball: Disc
  bats: [Disc, Disc]
  score: [number, number]
  /** Who served the first point; alternation is derived from it. */
  first: Side
  /** Who serves the current (or next) point. */
  server: Side
  /** 'serve': ball held over the server's bat. 'play': in flight. 'point': pause after a point. */
  phase: 'serve' | 'play' | 'point'
  /** Seconds left in the 'point' pause. */
  pause: number
  /** Bat contacts in the current rally. */
  rally: number
  /** Speed (units/s) the next return leaves at. */
  speed: number
  /** Who touched the ball last. */
  last: Side | null
  /** Where the ball last left a bat (y), for the drawn arc over the net. */
  fromY: number
  /** Whether the ball has bounced on the receiver's half since the last touch. */
  bounced: boolean
}

export type Event =
  | { kind: 'hit'; side: Side; x: number; y: number; speed: number; rally: number }
  | { kind: 'wall'; x: number; y: number; speed: number }
  | { kind: 'bounce'; side: Side; x: number; y: number }
  | { kind: 'serve'; side: Side; x: number; y: number }
  | { kind: 'point'; side: Side; x: number; y: number; rally: number }

export type Target = { x: number; y: number } | null

/** What each side asks for this step: where its bat should go, how fast, and whether it serves. */
export interface Cmd {
  target: [Target, Target]
  speed: [number, number]
  serve: [boolean, boolean]
}

/** Bat band: the centres a bat may occupy, on its own half of the table. */
export function bandOf(side: Side): Box {
  const x0 = TABLE.x0 + BAT_R + 8
  const x1 = TABLE.x1 - BAT_R - 8
  return side === 0
    ? { x0, x1, y0: MID + BAT_NEAR, y1: MID + BAT_FAR }
    : { x0, x1, y0: MID - BAT_FAR, y1: MID - BAT_NEAR }
}

/** Points alternate serve every two points, starting with `first`. */
export function serverOf(score: [number, number], first: Side): Side {
  const total = score[0] + score[1]
  return Math.floor(total / 2) % 2 === 0 ? first : other(first)
}

/** Match point rule: first to `target` with a two-point lead, or `target + 4` (the cap) outright. */
export function winner(score: [number, number], target: number): Side | null {
  const hi = Math.max(score[0], score[1])
  const lo = Math.min(score[0], score[1])
  if (hi < target) return null
  if (hi - lo < 2 && hi < target + 4) return null
  return score[0] > score[1] ? 0 : 1
}

/** Offset (ball x relative to the bat, in bat-radius units) → outgoing angle. */
export function offsetOf(bat: Disc, ball: Disc): number {
  return (ball.x - bat.x) / (BAT_R + BALL_R)
}

export function newWorld(first: Side): World {
  const w: World = {
    ball: disc(W / 2, MID, BALL_R),
    bats: [disc(W / 2, REST_Y[0], BAT_R), disc(W / 2, REST_Y[1], BAT_R)],
    score: [0, 0],
    first,
    server: first,
    phase: 'serve',
    pause: 0,
    rally: 0,
    speed: BASE_SPEED,
    last: null,
    fromY: MID,
    bounced: false,
  }
  holdBall(w)
  return w
}

/** Keep the ball resting just in front of the server's bat. */
function holdBall(w: World): void {
  const bat = w.bats[w.server]
  const gap = BAT_R + BALL_R + 18
  w.ball.x = bat.x
  w.ball.y = w.server === 0 ? bat.y - gap : bat.y + gap
  w.ball.vx = 0
  w.ball.vy = 0
}

function moveBat(p: Disc, cmd: Cmd, side: Side, h: number): void {
  const t = cmd.target[side]
  if (t) driveTo(p, t.x, t.y, cmd.speed[side], h, bandOf(side))
  else {
    p.vx = 0
    p.vy = 0
  }
}

function launch(w: World, rng: Rng, ev: Event[]): void {
  const side = w.server
  w.phase = 'play'
  w.rally = 0
  w.speed = BASE_SPEED
  w.last = side
  w.fromY = w.ball.y
  w.bounced = false
  w.ball.vx = rng.range(-SERVE_SPREAD, SERVE_SPREAD)
  w.ball.vy = (side === 0 ? -1 : 1) * w.speed
  ev.push({ kind: 'serve', side, x: w.ball.x, y: w.ball.y })
}

/** Bounce off the side walls. */
function wallBounce(b: Disc, ev: Event[]): void {
  if (b.x - b.r < TABLE.x0) {
    b.x = TABLE.x0 + b.r
    ev.push({ kind: 'wall', x: b.x, y: b.y, speed: Math.abs(b.vx) })
    b.vx = Math.abs(b.vx)
  } else if (b.x + b.r > TABLE.x1) {
    b.x = TABLE.x1 - b.r
    ev.push({ kind: 'wall', x: b.x, y: b.y, speed: Math.abs(b.vx) })
    b.vx = -Math.abs(b.vx)
  }
}

/**
 * A bat meets the ball: it must come from the table side and be closing in.
 * The offset from the bat's centre sets the angle; the rally speed sets the pace.
 */
function batHit(w: World, side: Side, ev: Event[]): void {
  const b = w.ball
  const bat = w.bats[side]
  const dir = side === 0 ? -1 : 1
  const dx = b.x - bat.x
  const dy = b.y - bat.y
  const min = BAT_R + b.r
  if (dx * dx + dy * dy >= min * min) return
  if (dir * dy < -b.r * 0.5) return
  if ((b.vx - bat.vx) * dx + (b.vy - bat.vy) * dy >= 0) return
  w.rally++
  w.speed = Math.min(MAX_SPEED, BASE_SPEED + w.rally * RAMP)
  const angle = Math.max(-1, Math.min(1, dx / min)) * MAX_ANGLE
  b.vx = Math.sin(angle) * w.speed + bat.vx * 0.25
  let vy = dir * Math.cos(angle) * w.speed + bat.vy * 0.25
  // A return always goes back over the net, however the bat was moving.
  if (vy * dir < w.speed * 0.4) vy = dir * w.speed * 0.4
  b.vy = vy
  const dist = Math.hypot(dx, dy) || 0.0001
  b.x = bat.x + (dx / dist) * min
  b.y = bat.y + (dy / dist) * min
  w.last = side
  w.fromY = b.y
  w.bounced = false
  ev.push({ kind: 'hit', side, x: b.x, y: b.y, speed: w.speed, rally: w.rally })
}

/** Where a ball sent toward `side` touches the table (y): a little short of the middle of that half. */
export const bounceY = (side: Side): number => (side === 0 ? MID + 240 : MID - 240)

/**
 * Drawn height of the ball (cosmetic, derived from state): an arc from the bat
 * over the net to the bounce on the receiver's half, then a smaller rise toward
 * the receiver's bat, falling again past it.
 */
export function heightOf(w: World): number {
  if (w.phase !== 'play' || w.last === null) return 0
  const to = other(w.last)
  const by = bounceY(to)
  const y = w.ball.y
  const leg1 = by - w.fromY
  if (!w.bounced && Math.abs(leg1) > 1) {
    const t = Math.max(0, Math.min(1, (y - w.fromY) / leg1))
    return 4 * 110 * t * (1 - t)
  }
  const t2 = Math.max(0, Math.min(2, (y - by) / (REST_Y[to] - by)))
  return 70 * Math.sin((Math.PI / 2) * t2)
}

/** The ball crossing its bounce line on the receiver's half (once per leg). */
function bounceCheck(w: World, prevY: number, ev: Event[]): void {
  if (w.bounced || w.last === null) return
  const to = other(w.last)
  const by = bounceY(to)
  if ((prevY - by) * (w.ball.y - by) <= 0) {
    w.bounced = true
    ev.push({ kind: 'bounce', side: to, x: w.ball.x, y: by })
  }
}

/** The ball left the table: whoever's edge it fell off conceded the point. */
function outOfPlay(w: World, ev: Event[]): boolean {
  const b = w.ball
  let scorer: Side | null = null
  if (b.y - b.r > TABLE.y1) scorer = 1
  else if (b.y + b.r < TABLE.y0) scorer = 0
  if (scorer === null) return false
  w.score[scorer]++
  w.phase = 'point'
  w.pause = POINT_PAUSE
  w.server = serverOf(w.score, w.first)
  ev.push({
    kind: 'point',
    side: scorer,
    x: Math.max(TABLE.x0, Math.min(TABLE.x1, b.x)),
    y: scorer === 0 ? TABLE.y0 : TABLE.y1,
    rally: w.rally,
  })
  return true
}

/**
 * Advance one fixed step. `cmd.target[side]` is where that side's bat wants to be
 * (null = hold still), `cmd.serve[side]` launches the ball when that side serves.
 */
export function step(w: World, dt: number, cmd: Cmd, rng: Rng): Event[] {
  const ev: Event[] = []
  if (w.phase === 'point') {
    w.pause -= dt
    for (const side of [0, 1] as Side[]) moveBat(w.bats[side], cmd, side, dt)
    if (w.pause <= 0) {
      w.phase = 'serve'
      holdBall(w)
    }
    return ev
  }
  const h = dt / SUBSTEPS
  for (let s = 0; s < SUBSTEPS; s++) {
    for (const side of [0, 1] as Side[]) moveBat(w.bats[side], cmd, side, h)
    if (w.phase === 'serve') {
      holdBall(w)
      if (cmd.serve[w.server]) launch(w, rng, ev)
      continue
    }
    const prevY = w.ball.y
    w.ball.x += w.ball.vx * h
    w.ball.y += w.ball.vy * h
    bounceCheck(w, prevY, ev)
    wallBounce(w.ball, ev)
    batHit(w, 0, ev)
    batHit(w, 1, ev)
    if (outOfPlay(w, ev)) break
  }
  return ev
}
