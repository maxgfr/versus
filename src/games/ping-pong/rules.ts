import { type Difficulty, other, type Side } from '../../core/game.ts'
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
export const BASE_SPEED = 950
const RAMP = 45
export const MAX_SPEED = 2100
/** A bat driven into the ball adds up to this much pace on top of the rally speed. */
const SMASH = 1000
/** Forward bat speed (units/s) that counts as a full smash. */
const SMASH_FULL = 2400
/** No return leaves faster than this (keeps a smash returnable and tunnel-free). */
const MAX_SHOT = 3200
/** Sideways bat speed brushes the ball: lateral curve (units/s²) per unit of bat speed, and its cap. */
const SPIN_K = 0.8
const SPIN_MAX = 1700
/** Spin fades out over a flight (per second). */
const SPIN_DECAY = 1.4
const SERVE_SPREAD = 260
const SUBSTEPS = 4
export const POINT_PAUSE = 1.1

/**
 * Against the computer its level also sets the pace: every shot's speed (serve,
 * rally ramp, smash and their caps) is scaled. Local 2P and online play at 1.
 */
export const TEMPO: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.28 }

/** The tempo of a match, fixed once at setup. */
export function tempoOf(d: Difficulty, bots: readonly boolean[]): number {
  return bots.some(Boolean) ? TEMPO[d] : 1
}

export interface World {
  ball: Disc
  bats: [Disc, Disc]
  score: [number, number]
  /** Who served the first point; alternation is derived from it. */
  first: Side
  /** Points to win (the deuce serve rule needs it). */
  target: number
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
  /** Sidespin: lateral acceleration (units/s²) the ball curves with, from a brushing stroke. */
  spin: number
  /** Pace multiplier on every shot (1 = normal), fixed for the match. */
  tempo: number
}

export type Event =
  | {
      kind: 'hit'
      side: Side
      x: number
      y: number
      /** Speed the ball leaves the bat at. */
      speed: number
      rally: number
      /** 0..1: how hard the bat was driven into the ball (forward bat speed). */
      power: number
      /** -1..1: how much sidespin the stroke put on it. */
      spin: number
    }
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

/**
 * Points alternate serve every two points, starting with `first`; once both
 * players are one point from `target` (deuce), the serve alternates every point.
 */
export function serverOf(score: [number, number], first: Side, target = Infinity): Side {
  const total = score[0] + score[1]
  const deuce = (target - 1) * 2
  if (score[0] >= target - 1 && score[1] >= target - 1) {
    const atDeuce = Math.floor(deuce / 2) % 2 === 0 ? first : other(first)
    return (total - deuce) % 2 === 0 ? atDeuce : other(atDeuce)
  }
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

export function newWorld(first: Side, target = 7, tempo = 1): World {
  const w: World = {
    ball: disc(W / 2, MID, BALL_R),
    bats: [disc(W / 2, REST_Y[0], BAT_R), disc(W / 2, REST_Y[1], BAT_R)],
    score: [0, 0],
    first,
    target,
    server: first,
    phase: 'serve',
    pause: 0,
    rally: 0,
    speed: BASE_SPEED * tempo,
    last: null,
    fromY: MID,
    bounced: false,
    spin: 0,
    tempo,
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

/**
 * Drive a bat for one substep. The finger moves once per frame, so the target is
 * walked from where the bat stood at the start of the frame (`from`) by `k` of the
 * way: the bat then moves evenly through the substeps and its velocity is the
 * finger's real speed in every one (otherwise all the motion lands in the first
 * substep and a hit reads 4× or 0× the swing).
 */
function moveBat(
  p: Disc,
  cmd: Cmd,
  side: Side,
  h: number,
  from?: { x: number; y: number },
  k = 1,
): void {
  const t = cmd.target[side]
  if (t) {
    const tx = from ? from.x + (t.x - from.x) * k : t.x
    const ty = from ? from.y + (t.y - from.y) * k : t.y
    driveTo(p, tx, ty, cmd.speed[side], h, bandOf(side))
  } else {
    p.vx = 0
    p.vy = 0
  }
}

function launch(w: World, rng: Rng, ev: Event[]): void {
  const side = w.server
  w.phase = 'play'
  w.rally = 0
  w.speed = BASE_SPEED * w.tempo
  w.last = side
  w.fromY = w.ball.y
  w.bounced = false
  w.spin = 0
  w.ball.vx = rng.range(-SERVE_SPREAD, SERVE_SPREAD) * w.tempo
  w.ball.vy = (side === 0 ? -1 : 1) * w.speed
  ev.push({ kind: 'serve', side, x: w.ball.x, y: w.ball.y })
}

/** Bounce off the side walls. The rail eats the spin, so a curling ball cannot hug it. */
function wallBounce(w: World, ev: Event[]): void {
  const b = w.ball
  if (b.x - b.r < TABLE.x0) {
    b.x = TABLE.x0 + b.r
    ev.push({ kind: 'wall', x: b.x, y: b.y, speed: Math.abs(b.vx) })
    b.vx = Math.abs(b.vx)
    w.spin = 0
  } else if (b.x + b.r > TABLE.x1) {
    b.x = TABLE.x1 - b.r
    ev.push({ kind: 'wall', x: b.x, y: b.y, speed: Math.abs(b.vx) })
    b.vx = -Math.abs(b.vx)
    w.spin = 0
  }
}

/**
 * A bat meets the ball: it must come from the table side and be closing in.
 * The offset from the bat's centre sets the angle; the rally speed sets the base
 * pace, driving the bat forward into the ball smashes it faster, and a sideways
 * swipe brushes sidespin onto it (the ball curls the way the bat moved).
 */
function batHit(w: World, side: Side, ev: Event[]): void {
  const b = w.ball
  const bat = w.bats[side]
  const dir = side === 0 ? -1 : 1
  const dx = b.x - bat.x
  const dy = b.y - bat.y
  const min = BAT_R + b.r
  // A bat cannot strike twice in a row: a bat lunging faster than its own
  // return would otherwise catch the ball again within the same swing.
  if (w.last === side && w.phase === 'play') return
  if (dx * dx + dy * dy >= min * min) return
  if (dir * dy < -b.r * 0.5) return
  if ((b.vx - bat.vx) * dx + (b.vy - bat.vy) * dy >= 0) return
  w.rally++
  w.speed = Math.min(MAX_SPEED, BASE_SPEED + w.rally * RAMP) * w.tempo
  const angle = Math.max(-1, Math.min(1, dx / min)) * MAX_ANGLE
  const push = bat.vy * dir
  const power = Math.max(0, Math.min(1, push / SMASH_FULL))
  // Pulling the bat back on contact blocks: a softer, shorter return.
  const block = Math.max(-0.3, Math.min(0, push / 4000))
  const shot = w.speed * (1 + block) + power * SMASH * w.tempo
  b.vx = Math.sin(angle) * shot + bat.vx * 0.15
  let vy = dir * Math.cos(angle) * shot
  // A return always goes back over the net, however the bat was moving, and
  // leaves faster than the bat chasing it (capped so it stays playable).
  const least = Math.min(MAX_SHOT * w.tempo, Math.max(shot * 0.4, push + 80))
  if (vy * dir < least) vy = dir * least
  b.vy = vy
  w.spin = Math.max(-SPIN_MAX, Math.min(SPIN_MAX, bat.vx * SPIN_K))
  const dist = Math.hypot(dx, dy) || 0.0001
  b.x = bat.x + (dx / dist) * min
  b.y = bat.y + (dy / dist) * min
  w.last = side
  w.fromY = b.y
  w.bounced = false
  ev.push({
    kind: 'hit',
    side,
    x: b.x,
    y: b.y,
    speed: Math.hypot(b.vx, b.vy),
    rally: w.rally,
    power,
    spin: w.spin / SPIN_MAX,
  })
}

/**
 * Where the ball in play will cross the line `y`, flying it forward with its
 * real spin and wall bounces (null if it is moving away or would take longer
 * than `maxT`). The bot reads the curl this way instead of a straight line.
 */
export function predictCross(w: World, y: number, maxT = 2.5): number | null {
  const b = w.ball
  if (Math.abs(b.vy) < 1 || (y - b.y) * b.vy < 0) return null
  const h = 1 / 120
  const decay = Math.exp(-SPIN_DECAY * h)
  let x = b.x
  let by = b.y
  let vx = b.vx
  let spin = w.spin
  for (let t = 0; t < maxT; t += h) {
    vx += spin * h
    spin *= decay
    const ny = by + b.vy * h
    x += vx * h
    if (x - b.r < TABLE.x0) {
      x = TABLE.x0 + b.r
      vx = Math.abs(vx)
      spin = 0
    } else if (x + b.r > TABLE.x1) {
      x = TABLE.x1 - b.r
      vx = -Math.abs(vx)
      spin = 0
    }
    if ((by - y) * (ny - y) <= 0) return x
    by = ny
  }
  return null
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
  w.spin = 0
  w.server = serverOf(w.score, w.first, w.target)
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
  const from = [
    { x: w.bats[0].x, y: w.bats[0].y },
    { x: w.bats[1].x, y: w.bats[1].y },
  ]
  const decay = Math.exp(-SPIN_DECAY * h)
  for (let s = 0; s < SUBSTEPS; s++) {
    const k = (s + 1) / SUBSTEPS
    for (const side of [0, 1] as Side[]) moveBat(w.bats[side], cmd, side, h, from[side], k)
    if (w.phase === 'serve') {
      holdBall(w)
      if (cmd.serve[w.server]) launch(w, rng, ev)
      continue
    }
    const prevY = w.ball.y
    w.ball.vx += w.spin * h
    w.spin *= decay
    w.ball.x += w.ball.vx * h
    w.ball.y += w.ball.vy * h
    bounceCheck(w, prevY, ev)
    wallBounce(w, ev)
    batHit(w, 0, ev)
    batHit(w, 1, ev)
    if (outOfPlay(w, ev)) break
  }
  return ev
}
