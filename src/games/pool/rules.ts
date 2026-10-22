import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { collideDynamic, type Disc, integrate, speedOf } from '../../engines/puck/index.ts'

/**
 * Pure 8-ball pool on a felt table. Balls are discs (puck engine physics), the
 * cushions and pockets are simple rules here. Groups, fouls, ball in hand and the
 * 8 ball are all decided by `settle`. No DOM, no sound.
 */

/** The playing surface, in world units (the rails sit outside it). */
export const TABLE = { x0: 110, y0: 150, x1: 890, y1: 1650 }
export const BR = 38
/** Pockets: four corners, then the two middles. */
export const POCKETS: { x: number; y: number; r: number }[] = [
  { x: TABLE.x0, y: TABLE.y0, r: 62 },
  { x: TABLE.x1, y: TABLE.y0, r: 62 },
  { x: TABLE.x0, y: TABLE.y1, r: 62 },
  { x: TABLE.x1, y: TABLE.y1, r: 62 },
  { x: (TABLE.x0 + TABLE.x1) / 2, y: TABLE.y0, r: 56 },
  { x: (TABLE.x0 + TABLE.x1) / 2, y: TABLE.y1, r: 56 },
]
export const DRAG = 1.45
const CUSHION_E = 0.74
const BALL_E = 0.95
/** Cue speed (units/s) at full power. */
export const SHOT_SPEED = 2100
const MAX_SPEED = 2600
const STOP_V = 14
const SUBSTEPS = 4
/** Racks that run this long are settled on the balls left. */
const MAX_SHOTS = 120
/** The head spot (where the cue starts) and the foot spot (apex of the rack). */
export const HEAD = { x: 500, y: 1330 }
export const FOOT = { x: 500, y: 430 }

export type Group = 'solid' | 'stripe' | null

export interface Ball extends Disc {
  /** 0 = cue, 1..7 solids, 8 black, 9..15 stripes. */
  n: number
  /** On the table (false = potted). */
  on: boolean
  /** Pocket it went into (-1 = on the table), and when (world time). */
  pocket: number
  at: number
}

export interface World {
  /** Index = ball number. */
  balls: Ball[]
  turn: Side
  /** aim: the shooter may strike. place: ball in hand, the shooter must place the cue. roll: balls moving. rack: a rack just ended. */
  phase: 'aim' | 'place' | 'roll' | 'rack'
  /** Seconds in the current roll. */
  t: number
  /** Group owned by each side (null until someone pots a ball of the group). */
  groups: [Group, Group]
  /** Racks won by each side. */
  wins: [number, number]
  /** Who breaks this rack. */
  breaker: Side
  /** Shots taken in this rack. */
  shots: number
  /** Balls potted in the current shot, in order. */
  potted: number[]
  /** First object ball the cue touched this shot (-1 = none). */
  firstHit: number
  /** Last foul, for the banner ('' = none). */
  foul: '' | 'scratch' | 'miss' | 'wrong' | 'eight'
  /** Winner of the rack that just ended. */
  rackWinner: Side | -1
  /** World time. */
  time: number
}

export type Event =
  | { kind: 'hit'; speed: number; x: number; y: number }
  | { kind: 'cushion'; speed: number; x: number; y: number }
  | { kind: 'pot'; n: number; pocket: number; x: number; y: number }
  | { kind: 'foul'; why: 'scratch' | 'miss' | 'wrong' | 'eight'; side: Side }
  | { kind: 'turn'; side: Side }
  | { kind: 'rack'; side: Side }

export const other = (s: Side): Side => (s === 0 ? 1 : 0)

export function groupOf(n: number): Group {
  if (n >= 1 && n <= 7) return 'solid'
  if (n >= 9 && n <= 15) return 'stripe'
  return null
}

/** Ball n's spot in the rack triangle (row r, column c). */
function rackSpot(index: number): { x: number; y: number } {
  let r = 0
  while (((r + 1) * (r + 2)) / 2 <= index) r++
  const c = index - (r * (r + 1)) / 2
  const row = BR * 2 + 1
  return { x: FOOT.x + (c - r / 2) * row, y: FOOT.y + r * row * 0.87 }
}

function ball(n: number, x: number, y: number): Ball {
  return { x, y, vx: 0, vy: 0, r: BR, n, on: true, pocket: -1, at: -10 }
}

/** A full rack: 8 in the middle of row 3, one solid and one stripe in the back corners. */
export function rackBalls(rng: Rng): Ball[] {
  const solids = rng.shuffle([1, 2, 3, 4, 5, 6, 7])
  const stripes = rng.shuffle([9, 10, 11, 12, 13, 14, 15])
  const cornerS = solids.pop() ?? 1
  const cornerT = stripes.pop() ?? 9
  const rest = rng.shuffle([...solids, ...stripes])
  const order: number[] = Array.from({ length: 15 }, () => 0)
  order[4] = 8
  order[10] = cornerS
  order[14] = cornerT
  let k = 0
  for (let i = 0; i < 15; i++) {
    if (order[i] === 0) order[i] = rest[k++] ?? 0
  }
  // Index = ball number: the rack position of each number is looked up by where it sits.
  const out: Ball[] = Array.from({ length: 16 }, (_, n) => ball(n, HEAD.x, HEAD.y))
  order.forEach((n, i) => {
    const p = rackSpot(i)
    out[n] = ball(n, p.x, p.y)
  })
  return out
}

export function newWorld(breaker: Side, rng: Rng): World {
  return {
    balls: rackBalls(rng),
    turn: breaker,
    phase: 'aim',
    t: 0,
    groups: [null, null],
    wins: [0, 0],
    breaker,
    shots: 0,
    potted: [],
    firstHit: -1,
    foul: '',
    rackWinner: -1,
    time: 0,
  }
}

/** Set up a new rack (same match): the loser of the last rack breaks. */
export function rerack(w: World, rng: Rng): void {
  w.balls = rackBalls(rng)
  w.turn = w.breaker
  w.phase = 'aim'
  w.t = 0
  w.groups = [null, null]
  w.shots = 0
  w.potted = []
  w.firstHit = -1
  w.foul = ''
  w.rackWinner = -1
}

export function onTable(w: World): Ball[] {
  return w.balls.filter((b) => b.on)
}

/** How many of `side`'s balls are still on the table (the 8 ball counts once its group is cleared). */
export function left(w: World, side: Side): number {
  const g = w.groups[side]
  if (!g) return 7
  return w.balls.filter((b) => b.on && groupOf(b.n) === g).length
}

/** Can the cue be put down at (x, y)? On the table, clear of every other ball. */
export function validPlace(w: World, x: number, y: number): boolean {
  if (x < TABLE.x0 + BR || x > TABLE.x1 - BR || y < TABLE.y0 + BR || y > TABLE.y1 - BR) return false
  for (const b of w.balls) {
    if (!b.on || b.n === 0) continue
    if (Math.hypot(b.x - x, b.y - y) < BR * 2 + 2) return false
  }
  return true
}

/** Put the cue ball down (ball in hand). Returns false when the spot is not free. */
export function placeCue(w: World, x: number, y: number): boolean {
  if (w.phase !== 'place' || !validPlace(w, x, y)) return false
  const c = w.balls[0]
  if (!c) return false
  c.x = x
  c.y = y
  c.vx = c.vy = 0
  c.on = true
  c.pocket = -1
  w.phase = 'aim'
  return true
}

/** Strike the cue ball along the unit direction (dx, dy) with power 0..1. */
export function strike(w: World, dx: number, dy: number, power: number): boolean {
  const c = w.balls[0]
  if (!c || !c.on || w.phase !== 'aim') return false
  const m = Math.hypot(dx, dy)
  const p = Math.max(0, Math.min(1, power))
  if (m < 1e-6 || p <= 0) return false
  c.vx = (dx / m) * p * SHOT_SPEED
  c.vy = (dy / m) * p * SHOT_SPEED
  w.phase = 'roll'
  w.t = 0
  w.potted = []
  w.firstHit = -1
  w.shots++
  return true
}

/** Where the first ball (or cushion) on the line from (x, y) along (dx, dy) would stop the cue. */
export function raycast(
  w: World,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { t: number; hit: number } {
  let best = Infinity
  let hit = -1
  for (const b of w.balls) {
    if (!b.on || b.n === 0) continue
    const fx = b.x - x
    const fy = b.y - y
    const proj = fx * dx + fy * dy
    if (proj <= 0) continue
    const perp2 = fx * fx + fy * fy - proj * proj
    const min = BR * 2
    if (perp2 >= min * min) continue
    const t = proj - Math.sqrt(min * min - perp2)
    if (t > 0 && t < best) {
      best = t
      hit = b.n
    }
  }
  // Cushions: the distance along the ray to each rail line.
  const lim = (v0: number, v1: number, d: number, p: number) => {
    if (d > 0) return (v1 - p) / d
    if (d < 0) return (v0 - p) / d
    return Infinity
  }
  const tx = Math.min(lim(TABLE.x0 + BR, TABLE.x1 - BR, dx, x), lim(TABLE.x0, TABLE.x1, dx, x))
  const ty = Math.min(lim(TABLE.y0 + BR, TABLE.y1 - BR, dy, y), lim(TABLE.y0, TABLE.y1, dy, y))
  const wall = Math.min(tx, ty)
  if (wall < best) return { t: Math.max(0, wall), hit: -1 }
  return { t: Math.max(0, best), hit }
}

/** Advance one fixed step (1/60 s). */
export function step(w: World, dt: number): Event[] {
  const ev: Event[] = []
  w.time += dt
  if (w.phase === 'rack') {
    w.t += dt
    return ev
  }
  if (w.phase !== 'roll') return ev
  w.t += dt
  const h = dt / SUBSTEPS
  for (let s = 0; s < SUBSTEPS; s++) substep(w, h, ev)
  const moving = w.balls.some((b) => b.on && speedOf(b) > STOP_V)
  if (!moving || w.t > 30) {
    for (const b of w.balls) {
      b.vx = 0
      b.vy = 0
    }
    settle(w, ev)
  }
  return ev
}

function substep(w: World, h: number, ev: Event[]): void {
  const live = w.balls.filter((b) => b.on)
  for (const b of live) integrate(b, h, DRAG)
  // Cushions.
  for (const b of live) {
    const lo = TABLE.x0 + BR
    const hi = TABLE.x1 - BR
    const top = TABLE.y0 + BR
    const bot = TABLE.y1 - BR
    if (b.x < lo || b.x > hi) {
      const sp = Math.abs(b.vx)
      b.x = b.x < lo ? lo : hi
      b.vx = -b.vx * CUSHION_E
      if (sp > 120) ev.push({ kind: 'cushion', speed: sp, x: b.x, y: b.y })
    }
    if (b.y < top || b.y > bot) {
      const sp = Math.abs(b.vy)
      b.y = b.y < top ? top : bot
      b.vy = -b.vy * CUSHION_E
      if (sp > 120) ev.push({ kind: 'cushion', speed: sp, x: b.x, y: b.y })
    }
  }
  // Ball against ball.
  for (let i = 0; i < live.length; i++) {
    const a = live[i]
    if (!a) continue
    for (let j = i + 1; j < live.length; j++) {
      const o = live[j]
      if (!o) continue
      const c = collideDynamic(a, o, 1, 1, BALL_E)
      if (!c) continue
      if (c.speed > 40) ev.push({ kind: 'hit', speed: c.speed, x: c.x, y: c.y })
      if (a.n === 0 && w.firstHit < 0) w.firstHit = o.n
      else if (o.n === 0 && w.firstHit < 0) w.firstHit = a.n
    }
  }
  // Pockets.
  for (const b of live) {
    POCKETS.forEach((p, k) => {
      if (!b.on || Math.hypot(b.x - p.x, b.y - p.y) > p.r) return
      b.on = false
      b.pocket = k
      b.at = w.time
      b.vx = b.vy = 0
      w.potted.push(b.n)
      ev.push({ kind: 'pot', n: b.n, pocket: k, x: p.x, y: p.y })
    })
  }
  for (const b of live) {
    const sp = speedOf(b)
    if (sp > MAX_SPEED) {
      b.vx *= MAX_SPEED / sp
      b.vy *= MAX_SPEED / sp
    }
  }
}

/** The shot is over: call fouls, assign groups, end the rack, or pass the turn. */
function settle(w: World, ev: Event[]): void {
  const shooter = w.turn
  const potted = w.potted
  const own = w.groups[shooter]
  const cuePotted = potted.includes(0)
  let foul: World['foul'] = ''
  if (cuePotted) foul = 'scratch'
  else if (w.firstHit < 0) foul = 'miss'
  else if (w.firstHit === 8) {
    if (own === null || left(w, shooter) > 0) foul = 'eight'
  } else if (own !== null && groupOf(w.firstHit) !== own) foul = 'wrong'
  // The break: an 8 ball potted on it goes back on the spot (it never decides the rack).
  if (w.shots === 1 && potted.includes(8) && w.groups[0] === null && w.groups[1] === null) {
    const eight = w.balls[8]
    if (eight) {
      eight.on = true
      eight.pocket = -1
      eight.x = FOOT.x
      eight.y = FOOT.y
      const spot = nearestFree(w, FOOT.x, FOOT.y, eight)
      eight.x = spot.x
      eight.y = spot.y
    }
    potted.splice(potted.indexOf(8), 1)
  }
  // The first legal pot claims its group for the shooter.
  if (!foul && w.groups[0] === null && w.groups[1] === null) {
    const first = potted.find((n) => n !== 0 && n !== 8)
    if (first !== undefined) {
      const g = groupOf(first)
      w.groups[shooter] = g
      w.groups[other(shooter)] = g === 'solid' ? 'stripe' : 'solid'
    }
  }
  // The 8 ball decides the rack.
  if (potted.includes(8)) {
    // Only a shooter already on the black wins: sinking the last ball of the
    // group and the 8 on the same stroke still loses.
    const clean =
      !foul && own !== null && left(w, shooter) === 0 && !potted.some((n) => groupOf(n) === own)
    endRack(w, clean ? shooter : other(shooter), ev)
    return
  }
  if (w.shots >= MAX_SHOTS) {
    const a = left(w, shooter)
    const b = left(w, other(shooter))
    endRack(w, b < a ? other(shooter) : shooter, ev)
    return
  }
  const mine = w.groups[shooter]
  const legal = mine !== null && potted.some((n) => n !== 0 && n !== 8 && groupOf(n) === mine)
  if (foul) {
    // Ball in hand for the opponent: the cue is put down anywhere by them.
    w.foul = foul
    ev.push({ kind: 'foul', why: foul, side: shooter })
    w.turn = other(shooter)
    w.phase = 'place'
    ev.push({ kind: 'turn', side: w.turn })
  } else if (legal) {
    w.foul = ''
    w.phase = 'aim'
  } else {
    w.foul = ''
    w.turn = other(shooter)
    w.phase = 'aim'
    ev.push({ kind: 'turn', side: w.turn })
  }
}

function endRack(w: World, winner: Side, ev: Event[]): void {
  w.wins[winner]++
  w.rackWinner = winner
  w.phase = 'rack'
  w.t = 0
  w.breaker = other(winner)
  ev.push({ kind: 'rack', side: winner })
}

/** The free spot nearest (x, y), searching outward; `skip` is ignored. */
function nearestFree(w: World, x: number, y: number, skip: Ball): { x: number; y: number } {
  for (let r = 0; r < 600; r += 6) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (validPlaceIgnoring(w, px, py, skip)) return { x: px, y: py }
    }
  }
  return { x, y }
}

function validPlaceIgnoring(w: World, x: number, y: number, skip: Ball): boolean {
  if (x < TABLE.x0 + BR || x > TABLE.x1 - BR || y < TABLE.y0 + BR || y > TABLE.y1 - BR) return false
  for (const b of w.balls) {
    if (!b.on || b === skip) continue
    if (Math.hypot(b.x - x, b.y - y) < BR * 2 + 2) return false
  }
  return true
}

export function winner(w: World, target: number): Side | null {
  if (w.wins[0] >= target) return 0
  if (w.wins[1] >= target) return 1
  return null
}
