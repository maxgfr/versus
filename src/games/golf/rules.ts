import { other, STEP, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W, H } from '../../core/stage.ts'
import {
  type Ballistics,
  launch,
  type Shell,
  type ShotParams,
  stepShell,
  trace,
} from '../../engines/aim/index.ts'

/**
 * Pure golf: three procedural holes, each player plays their own ball (the one
 * farthest from the cup plays next, as on a real course), lobs with
 * pseudo-height, rolls with surface friction. No DOM.
 */

export const HOLES = 3
/** A full-power lob at 45° carries about 480 units (then rolls ~190) and peaks near 120. */
export const BALL: Ballistics = { g: 1600, vmax: 620, elev: 1, z0: 12 }
export const WIND_MAX = 110
/** Putting speed at full pull; a putt rolls about 220 units at full power. */
export const PUTT_SPEED = 420
/** Sand: a bunker shot has only this share of the club's power. */
export const SAND_POWER = 0.6
/** A hole's score is capped here: past it the ball is picked up. */
export const MAX_STROKES = 8
export const CUP_R = 26
export const GREEN_R = 150
export const TEE_R = 92
/** Half the width of the fairway. */
export const FAIRWAY_R = 108
const CUP_SPEED = 130
const REST_SPEED = 10
const WALL = 34

export type Surface = 'tee' | 'fairway' | 'rough' | 'sand' | 'green' | 'water'

export interface Pt {
  x: number
  y: number
}

export interface Blob extends Pt {
  r: number
}

export interface Hole {
  par: number
  starter: Side
  tee: Pt
  bend: Pt
  cup: Pt
  bunkers: Blob[]
  ponds: Blob[]
}

/** A ball in the air (`air`) or on the ground. */
export type Ball = Shell & { air: boolean }

/** Friction per second on the ground: the speed decays as exp(-k t). */
const FRICTION: Record<Surface, number> = {
  tee: 1.5,
  fairway: 1.5,
  rough: 4.5,
  sand: 11,
  green: 1.9,
  water: 0,
}
/** Share of the horizontal speed kept when the ball lands. */
const RETAIN: Record<Surface, number> = {
  tee: 0.45,
  fairway: 0.45,
  rough: 0.28,
  sand: 0,
  green: 0.4,
  water: 0,
}

export interface Hit {
  kind: 'land' | 'rest' | 'sunk' | 'water'
  x: number
  y: number
  surface: Surface
}

export type Event =
  | { kind: 'hit'; hit: Hit; side: Side }
  | { kind: 'pickup'; side: Side }
  | { kind: 'turn'; side: Side }
  | { kind: 'hole'; side: Side }

export interface State {
  holes: Hole[]
  hole: number
  /** The side striking now (or whose stroke is rolling). */
  turn: Side
  phase: 'aim' | 'fly' | 'beat'
  /** Each side's own ball. */
  balls: [Ball, Ball]
  /** Where each side's next stroke is played from. */
  rest: [Pt, Pt]
  /** Where each side's last stroke was played from (a splash drops the ball back there). */
  drop: [Pt, Pt]
  /** Holed out (or picked up) on this hole. */
  holed: [boolean, boolean]
  wind: number
  strokes: [number, number]
  holeStart: [number, number]
  /** Strokes per side for each finished hole. */
  card: [number, number][]
  after: 'turn' | 'water' | 'sunk' | 'hole'
  beat: number
  aiming: ShotParams | null
  /** Render stamps (game time), so the online guest replays the same animations. */
  holeAt: number
  swingAt: number
  sunkAt: number
  endAt: number
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const lerp = (a: Pt, b: Pt, t: number): Pt => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
})

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const t = clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy), 0, 1)
  return dist(p, { x: a.x + vx * t, y: a.y + vy * t })
}

/** A hole from the seed: tee at one end, cup at the other, a bend, bunkers and maybe a pond. */
export function makeHole(rng: Rng, index: number, starter: Side): Hole {
  const dir = starter === 0 ? -1 : 1
  const tee = { x: rng.range(300, 700), y: starter === 0 ? 1560 : 240 }
  const len = rng.range(760, 1000)
  const cup = { x: clamp(tee.x + rng.range(-260, 260), 180, 820), y: tee.y + dir * len }
  const bend = {
    x: clamp((tee.x + cup.x) / 2 + rng.range(-170, 170), 160, 840),
    y: (tee.y + cup.y) / 2,
  }
  const along = (t: number): Pt =>
    t < 0.5 ? lerp(tee, bend, t * 2) : lerp(bend, cup, (t - 0.5) * 2)
  const bunkers: Blob[] = []
  const nb = rng.int(1, 3)
  for (let i = 0; i < nb; i++) {
    const r = rng.range(48, 70)
    const p = along(rng.range(0.3, 0.85))
    const side = rng.chance(0.5) ? 1 : -1
    const b = { x: clamp(p.x + side * (FAIRWAY_R + 34 + r * 0.6), 100, W - 100), y: p.y, r }
    if (dist(b, cup) < GREEN_R + r + 30 || dist(b, tee) < TEE_R + r + 30) continue
    bunkers.push(b)
  }
  const ponds: Blob[] = []
  if (rng.chance([0.3, 0.75, 0.85][index] ?? 0.8)) {
    const p = along(rng.range(0.4, 0.6))
    ponds.push({ x: clamp(p.x + rng.range(-40, 40), 160, 840), y: p.y, r: rng.range(64, 84) })
  }
  return { par: len > 900 ? 4 : 3, starter, tee, bend, cup, bunkers, ponds }
}

export function newState(rng: Rng, first: Side, wind: number): State {
  const holes: Hole[] = []
  for (let i = 0; i < HOLES; i++) holes.push(makeHole(rng, i, i % 2 === 0 ? first : other(first)))
  const tee = (holes[0] as Hole).tee
  return {
    holes,
    hole: 0,
    turn: first,
    phase: 'aim',
    balls: [restBall(tee), restBall(tee)],
    rest: [{ ...tee }, { ...tee }],
    drop: [{ ...tee }, { ...tee }],
    holed: [false, false],
    wind,
    strokes: [0, 0],
    holeStart: [0, 0],
    card: [],
    after: 'turn',
    beat: 0,
    aiming: null,
    holeAt: 0,
    swingAt: -10,
    sunkAt: -10,
    endAt: -1,
  }
}

export function restBall(p: Pt): Ball {
  return { x: p.x, y: p.y, z: 0, vx: 0, vy: 0, vz: 0, t: 0, air: false }
}

export function surfaceAt(h: Hole, x: number, y: number): Surface {
  const p = { x, y }
  if (h.ponds.some((b) => dist(p, b) <= b.r)) return 'water'
  if (dist(p, h.cup) <= GREEN_R) return 'green'
  if (dist(p, h.tee) <= TEE_R) return 'tee'
  if (h.bunkers.some((b) => dist(p, b) <= b.r)) return 'sand'
  if (Math.min(segDist(p, h.tee, h.bend), segDist(p, h.bend, h.cup)) <= FAIRWAY_R) return 'fairway'
  return 'rough'
}

/** The ball leaves `from` with the stroke: a putt on the green, a lob everywhere else. */
export function plan(h: Hole, from: Pt, shot: ShotParams): Ball {
  if (surfaceAt(h, from.x, from.y) === 'green') {
    const v = PUTT_SPEED * shot.power
    return { x: from.x, y: from.y, z: 0, vx: shot.dx * v, vy: shot.dy * v, vz: 0, t: 0, air: false }
  }
  const k = surfaceAt(h, from.x, from.y) === 'sand' ? SAND_POWER : 1
  return {
    ...launch(from.x, from.y, { dx: shot.dx, dy: shot.dy, power: shot.power * k }, BALL),
    air: true,
  }
}

/** Points the preview draws: the first half of the lob, or the putt line. */
export function previewOf(
  h: Hole,
  from: Pt,
  shot: ShotParams,
  wind: number,
): { x: number; y: number; z: number }[] {
  if (surfaceAt(h, from.x, from.y) === 'green') {
    const len = (PUTT_SPEED * shot.power) / FRICTION.green
    const out: { x: number; y: number; z: number }[] = []
    for (let i = 1; i <= 8; i++) {
      const d = (len * i) / 8
      out.push({ x: from.x + shot.dx * d, y: from.y + shot.dy * d, z: 0 })
    }
    return out
  }
  const k = surfaceAt(h, from.x, from.y) === 'sand' ? SAND_POWER : 1
  return trace(from.x, from.y, { dx: shot.dx, dy: shot.dy, power: shot.power * k }, BALL, wind, 0.5)
}

/** Advance the ball one step. Returns a landing (non-terminal) or the end of the stroke. */
export function stepBall(b: Ball, dt: number, wind: number, h: Hole): Hit | null {
  if (b.air) {
    stepShell(b, dt, wind, BALL)
    if (b.z > 0) return null
    b.z = 0
    const surface = surfaceAt(h, b.x, b.y)
    if (surface === 'water') return { kind: 'water', x: b.x, y: b.y, surface }
    b.air = false
    b.vz = 0
    if (dist(b, h.cup) <= CUP_R && Math.hypot(b.vx, b.vy) <= CUP_SPEED)
      return { kind: 'sunk', x: h.cup.x, y: h.cup.y, surface }
    b.vx *= RETAIN[surface]
    b.vy *= RETAIN[surface]
    return { kind: 'land', x: b.x, y: b.y, surface }
  }
  const before = surfaceAt(h, b.x, b.y)
  if (before === 'water') return { kind: 'water', x: b.x, y: b.y, surface: before }
  const k = Math.exp(-FRICTION[before] * dt)
  b.vx *= k
  b.vy *= k
  b.x += b.vx * dt
  b.y += b.vy * dt
  if (b.x < WALL) {
    b.x = WALL
    b.vx = Math.abs(b.vx) * 0.4
  } else if (b.x > W - WALL) {
    b.x = W - WALL
    b.vx = -Math.abs(b.vx) * 0.4
  }
  if (b.y < WALL) {
    b.y = WALL
    b.vy = Math.abs(b.vy) * 0.4
  } else if (b.y > H - WALL) {
    b.y = H - WALL
    b.vy = -Math.abs(b.vy) * 0.4
  }
  const surface = surfaceAt(h, b.x, b.y)
  if (surface === 'water') return { kind: 'water', x: b.x, y: b.y, surface }
  const speed = Math.hypot(b.vx, b.vy)
  if (dist(b, h.cup) <= CUP_R && speed <= CUP_SPEED)
    return { kind: 'sunk', x: h.cup.x, y: h.cup.y, surface }
  if (speed < REST_SPEED) return { kind: 'rest', x: b.x, y: b.y, surface }
  return null
}

/** Play a stroke to its end without touching the state (the bot's look-ahead). */
export function runShot(h: Hole, from: Pt, shot: ShotParams, wind: number): Hit {
  const b = plan(h, from, shot)
  for (let i = 0; i < 60 * 12; i++) {
    const hit = stepBall(b, STEP, wind, h)
    if (hit && hit.kind !== 'land') return hit
  }
  return { kind: 'rest', x: b.x, y: b.y, surface: surfaceAt(h, b.x, b.y) }
}

/** Strokes `side` has taken on the hole being played. */
export const holeStrokes = (s: State, side: Side): number => s.strokes[side] - s.holeStart[side]

/** Apply one stroke: it counts for `turn`, with `turn`'s ball. */
export function fire(s: State, shot: ShotParams): void {
  const h = holeOf(s)
  const side = s.turn
  s.drop[side] = { ...s.rest[side] }
  s.balls[side] = plan(h, s.rest[side], shot)
  s.strokes[side]++
  s.aiming = null
  s.phase = 'fly'
}

/** Who plays next: the ball still in play farthest from the cup (ties go to the other side). */
export function nextTurn(s: State): Side {
  const h = holeOf(s)
  const [a, b] = s.holed
  if (a !== b) return a ? 1 : 0
  const o = other(s.turn)
  const dOther = dist(s.rest[o], h.cup)
  const dTurn = dist(s.rest[s.turn], h.cup)
  return dTurn > dOther + 0.5 ? s.turn : o
}

/** Advance the stroke or the pause after it. `nextWind` rolls the wind for a new turn. */
export function advance(s: State, dt: number, nextWind: () => number): Event[] {
  const ev: Event[] = []
  const h = s.holes[s.hole]
  if (!h) return ev
  const side = s.turn
  if (s.phase === 'fly') {
    const hit = stepBall(s.balls[side], dt, s.wind, h)
    if (hit) {
      ev.push({ kind: 'hit', hit, side })
      if (hit.kind !== 'land') {
        if (hit.kind === 'water') {
          s.balls[side] = restBall(s.drop[side])
          s.rest[side] = { ...s.drop[side] }
          s.strokes[side]++
          s.after = 'water'
          s.beat = 1.1
        } else if (hit.kind === 'sunk') {
          s.balls[side] = { ...restBall(h.cup) }
          s.rest[side] = { ...h.cup }
          s.holed[side] = true
          s.after = s.holed[other(side)] ? 'hole' : 'sunk'
          s.beat = 1.6
        } else {
          s.rest[side] = { x: hit.x, y: hit.y }
          s.balls[side] = restBall(s.rest[side])
          s.after = 'turn'
          s.beat = 0.7
        }
        // Past the cap the ball is picked up: the hole scores MAX_STROKES.
        if (!s.holed[side] && holeStrokes(s, side) >= MAX_STROKES) {
          s.strokes[side] = s.holeStart[side] + MAX_STROKES
          s.holed[side] = true
          s.after = s.holed[other(side)] ? 'hole' : 'sunk'
          ev.push({ kind: 'pickup', side })
        }
        s.phase = 'beat'
      }
    }
    return ev
  }
  if (s.phase === 'beat') {
    s.beat -= dt
    if (s.beat > 0) return ev
    if (s.after === 'hole') {
      s.card.push([holeStrokes(s, 0), holeStrokes(s, 1)])
      s.holeStart = [s.strokes[0], s.strokes[1]]
      s.hole++
      const next = s.holes[s.hole]
      if (next) {
        s.rest = [{ ...next.tee }, { ...next.tee }]
        s.drop = [{ ...next.tee }, { ...next.tee }]
        s.balls = [restBall(next.tee), restBall(next.tee)]
        s.holed = [false, false]
        s.turn = next.starter
        s.wind = nextWind()
        s.phase = 'aim'
        ev.push({ kind: 'hole', side: s.turn })
        ev.push({ kind: 'turn', side: s.turn })
      }
      return ev
    }
    s.turn = nextTurn(s)
    s.wind = nextWind()
    s.phase = 'aim'
    ev.push({ kind: 'turn', side: s.turn })
  }
  return ev
}

export const done = (s: State): boolean => s.hole >= HOLES

/** The hole being played (the last one once the round is over, so the final frames still draw). */
export const holeOf = (s: State): Hole => s.holes[Math.min(s.hole, s.holes.length - 1)] as Hole

/** Fewest strokes wins. */
export function result(s: State): Side | 'draw' {
  const [r, b] = s.strokes
  return r < b ? 0 : b < r ? 1 : 'draw'
}

/** Holes a side won (fewer strokes on that hole). */
export function holesWon(s: State, side: Side): number {
  return s.card.filter((c) => c[side] < c[other(side)]).length
}
