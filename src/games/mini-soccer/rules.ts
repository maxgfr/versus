import type { Side } from '../../core/game.ts'
import { MID, W } from '../../core/stage.ts'
import {
  capSpeed,
  collideDynamic,
  collideWalls,
  type Disc,
  disc,
  integrate,
  rink,
  scoredBy,
} from '../../engines/puck/index.ts'

/**
 * Pure mini soccer on the puck engine: two discs per side, flicked by drag and
 * release (slingshot), one ball, goals at the ends of the rink. The clock runs
 * during play; a level game at full time goes to a golden goal.
 */

/** The pitch: a rounded rink with goal mouths; each end leaves room for a scoreboard behind the net. */
export const RINK = rink({ y0: 200, y1: 1600, goal: 360 })
export const PLAYER_R = 74
export const BALL_R = 46
/** Seconds before a disc can be flicked again. */
export const COOLDOWN = 0.6
/** In the closing seconds (and a golden goal) discs recharge quicker: a frantic finish. */
export const COOLDOWN_RUSH = 0.4
export const RUSH_AT = 15
const MAX_FLICK = 2100
const MAX_BALL = 3000
const MAX_PLAYER = 2600
const DRAG_PLAYER = 2.4
const DRAG_BALL = 0.5
const SUBSTEPS = 4
export const GOAL_PAUSE = 1.6
/** At a kick-off after a goal, the scorers wait this long before they can flick. */
export const KICKOFF_LOCK = 0.5
/** After a goal the ball restarts this far into the kicking side's half. */
export const KICKOFF_DEPTH = 160
/** A golden goal with no goal for this long kicks off again, so nobody waits forever. */
export const GOLDEN_STALL = 25

export interface World {
  ball: Disc
  /** Four discs: side * 2 + k (k = the lane in 2 vs 2, the choice in 1 vs 1). */
  players: Disc[]
  /** Seconds left before each disc can be flicked again. */
  cool: number[]
  score: [number, number]
  /** Seconds left on the clock. */
  left: number
  /** Level at full time: the next goal wins. */
  golden: boolean
  /** Seconds of golden goal without a goal. */
  stall: number
  phase: 'play' | 'goal' | 'end'
  /** Seconds left in the goal pause. */
  pause: number
  winner: Side | null
  /** Who kicks off after the current goal pause (the side that conceded). */
  kick: Side | null
  /** Flick preview per disc, for the online guest to draw. */
  aims: ({ dx: number; dy: number; power: number } | null)[]
}

export interface Flick {
  index: number
  dx: number
  dy: number
  power: number
}

export interface Cmd {
  flicks: Flick[]
}

export type Event =
  | { kind: 'flick'; index: number; x: number; y: number; power: number }
  | { kind: 'hit'; index: number; x: number; y: number; speed: number }
  | { kind: 'wall'; x: number; y: number; speed: number }
  | { kind: 'goal'; side: Side; x: number; y: number; golden: boolean }
  | { kind: 'golden' }

/**
 * Home spot of a disc at kick-off: each side's left disc stands up front, its
 * right disc keeps goal (so nobody can walk the ball in straight from a restart).
 */
export function homeOf(index: number): { x: number; y: number } {
  const side = index >> 1
  const k = index & 1
  if (k === 0) return { x: 330, y: side === 0 ? MID + 250 : MID - 250 }
  return { x: 600, y: side === 0 ? RINK.y1 - 230 : RINK.y0 + 230 }
}

export function newWorld(seconds: number): World {
  return {
    ball: disc(W / 2, MID, BALL_R),
    players: [0, 1, 2, 3].map((i) => {
      const h = homeOf(i)
      return disc(h.x, h.y, PLAYER_R)
    }),
    cool: [0, 0, 0, 0],
    score: [0, 0],
    left: seconds,
    golden: false,
    stall: 0,
    phase: 'play',
    pause: 0,
    winner: null,
    kick: null,
    aims: [null, null, null, null],
  }
}

/**
 * Put everyone back for a kick-off. The side that just conceded (`to`) gets the
 * ball in its own half and the first touch: the scorers' discs stay locked for
 * a moment. The restart is long enough from goal that a keeper can answer it.
 */
function kickOff(w: World, to: Side | null = null): void {
  // The restart is taken from the kicking side's own half, in front of its forward.
  const by = to === null ? MID : to === 0 ? MID + KICKOFF_DEPTH : MID - KICKOFF_DEPTH
  w.ball = disc(W / 2, by, BALL_R)
  w.players.forEach((p, i) => {
    const h = homeOf(i)
    p.x = h.x
    p.y = h.y
    p.vx = 0
    p.vy = 0
  })
  w.cool = [0, 1, 2, 3].map((i) => (to !== null && i >> 1 !== to ? KICKOFF_LOCK : 0))
  w.phase = 'play'
  w.stall = 0
}

/** The cooldown a flick starts now: shorter in the closing seconds and a golden goal. */
export function cooldownOf(w: World): number {
  return w.golden || w.left <= RUSH_AT ? COOLDOWN_RUSH : COOLDOWN
}

/** Flick: the disc takes a velocity along the drag; a disc that is cooling down ignores it. */
function flick(w: World, f: Flick, ev: Event[]): void {
  const i = f.index
  const p = w.players[i]
  if (!p || (w.cool[i] ?? 0) > 0) return
  const v = Math.max(0, Math.min(1, f.power)) * MAX_FLICK
  p.vx = f.dx * v
  p.vy = f.dy * v
  w.cool[i] = cooldownOf(w)
  ev.push({ kind: 'flick', index: i, x: p.x, y: p.y, power: f.power })
}

function score(w: World, side: Side, ev: Event[]): void {
  const b = w.ball
  w.score[side]++
  ev.push({ kind: 'goal', side, x: b.x, y: b.y, golden: w.golden })
  if (w.golden) {
    w.phase = 'end'
    w.winner = side
    return
  }
  w.phase = 'goal'
  w.pause = GOAL_PAUSE
  w.kick = side === 0 ? 1 : 0
}

/** Full time: a clear lead wins; a level game goes to a golden goal. */
function fullTime(w: World, ev: Event[]): void {
  w.left = 0
  if (w.score[0] !== w.score[1]) {
    w.phase = 'end'
    w.winner = w.score[0] > w.score[1] ? 0 : 1
    return
  }
  w.golden = true
  ev.push({ kind: 'golden' })
}

/**
 * Advance one fixed step. Flicks apply first; then the discs, the ball and the
 * rink are integrated in substeps, with contacts reported as events.
 */
export function step(w: World, dt: number, cmd: Cmd): Event[] {
  const ev: Event[] = []
  for (let i = 0; i < 4; i++) w.cool[i] = Math.max(0, (w.cool[i] ?? 0) - dt)
  if (w.phase === 'end') return ev
  if (w.phase === 'goal') {
    w.pause -= dt
    if (w.pause <= 0) kickOff(w, w.kick)
    return ev
  }
  if (!w.golden) {
    w.left = Math.max(0, w.left - dt)
    if (w.left <= 0) fullTime(w, ev)
  } else {
    w.stall += dt
    if (w.stall > GOLDEN_STALL) {
      kickOff(w)
      return ev
    }
  }
  for (const f of cmd.flicks) flick(w, f, ev)

  const h = dt / SUBSTEPS
  const b = w.ball
  for (let s = 0; s < SUBSTEPS; s++) {
    for (const p of w.players) {
      integrate(p, h, DRAG_PLAYER)
      capSpeed(p, MAX_PLAYER)
      collideWalls(p, RINK, 0.7)
    }
    integrate(b, h, DRAG_BALL)
    const wall = collideWalls(b, RINK, 0.9)
    if (wall && wall.speed > 180) ev.push({ kind: 'wall', x: b.x, y: b.y, speed: wall.speed })
    w.players.forEach((p, i) => {
      const hit = collideDynamic(p, b, 2, 1, 0.85)
      if (hit) {
        ev.push({ kind: 'hit', index: i, x: hit.x, y: hit.y, speed: hit.speed })
        collideWalls(b, RINK, 0.9)
        collideWalls(p, RINK, 0.7)
      }
    })
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const a = w.players[i]
        const c = w.players[j]
        if (a && c) collideDynamic(a, c, 2, 2, 0.8)
      }
    }
    capSpeed(b, MAX_BALL)
    // A goal is a ball fully past a goal line, inside the mouth.
    const sc = scoredBy(b, RINK)
    if (sc !== null) {
      score(w, sc, ev)
      return ev
    }
  }
  return ev
}

/** The disc nearest a point, among those listed (index into `w.players`). */
export function nearestDisc(
  w: World,
  x: number,
  y: number,
  indices: readonly number[],
): number | null {
  let best: number | null = null
  let bd = Infinity
  for (const i of indices) {
    const p = w.players[i]
    if (!p) continue
    const d = Math.hypot(p.x - x, p.y - y)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}
