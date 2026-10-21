import { other, type Side } from '../../core/game.ts'
import { type Ballistics, launch, type ShotParams, stepShell } from '../../engines/aim/index.ts'

/**
 * Pure cornhole: one slanted board in the middle of the table with a hole in
 * its centre. Players alternate tossing four bags each per round. A bag lands
 * where its arc ends, slides on its own momentum, and then either drops into
 * the hole (3), stops on the board (1), or goes over the edge / lands on the
 * table (0). Points cancel within a round; first to the match target wins
 * (11 points by default, chosen before the game). No DOM.
 */

/** The bag's arc. Full power lands about 1300 units out. */
export const TOSS: Ballistics = { g: 1300, vmax: 1000, elev: 0.8, z0: 80 }
export const BOARD = { x: 240, y: 470, w: 520, h: 860 }
export const HOLE = { x: 500, y: 900, r: 58 }
/** Where each side throws from (world units). Red is at the bottom. */
export const THROW: readonly { x: number; y: number }[] = [
  { x: 500, y: 1600 },
  { x: 500, y: 200 },
]
export const BAG_R = 26
/** Share of ground speed kept when a bag lands on the board. */
export const LAND = 0.3
/** Sliding friction (units/s²). */
export const DECEL = 230
/** A bag slower than this inside the hole's rim drops in. */
export const CAPTURE = 170
/** Below this speed a sliding bag stops. */
export const STOP = 6
export const BAGS_EACH = 4
/** Default match length: points to win. The chosen target is kept in `State.target`. */
export const TO_WIN = 11
export const SCORE_PAUSE = 2.2

export type BagState = 'air' | 'slide' | 'rest' | 'hole' | 'off' | 'table'

export interface Bag {
  side: Side
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  st: BagState
  /** Seconds since the bag entered its current state. */
  since: number
  /** Spin of the bag on the board (rad), for drawing. */
  rot?: number
}

export interface State {
  turn: Side
  starter: Side
  round: number
  /** Match totals, red first. */
  score: [number, number]
  /** Points that win the match (the match length chosen before the game). */
  target: number
  /** Bags thrown this round, in order. */
  bags: Bag[]
  tosses: [number, number]
  /** aim: the turn's player may throw. fly: bags still moving. score: round summary. over: match decided. */
  phase: 'aim' | 'fly' | 'score' | 'over'
  /** Seconds left in the 'score' pause. */
  timer: number
  /** Live aim of the player whose turn it is (synced so the online guest sees it). */
  aiming: ShotParams | null
  /** Points each side made in the round that just ended. */
  roundPts: [number, number] | null
  /** Match clock (s) and when the round started / was scored: renderers tween from these. */
  now: number
  roundAt: number
  scoredAt: number
}

export type Event =
  | { kind: 'turn'; side: Side }
  | { kind: 'land'; side: Side; x: number; y: number }
  | { kind: 'table'; side: Side; x: number; y: number }
  | { kind: 'hole'; side: Side; x: number; y: number }
  | { kind: 'rest'; side: Side; x: number; y: number }
  | { kind: 'off'; side: Side; x: number; y: number }
  | { kind: 'bump'; x: number; y: number }
  | { kind: 'scored'; pts: [number, number]; gain: Side | null; amount: number }
  | { kind: 'round'; round: number }

export function newState(starter: Side, target = TO_WIN): State {
  return {
    turn: starter,
    starter,
    round: 1,
    score: [0, 0],
    target,
    bags: [],
    tosses: [0, 0],
    phase: 'aim',
    timer: 0,
    aiming: null,
    roundPts: null,
    now: 0,
    roundAt: 0,
    scoredAt: -9,
  }
}

export const onBoard = (x: number, y: number): boolean =>
  x >= BOARD.x && x <= BOARD.x + BOARD.w && y >= BOARD.y && y <= BOARD.y + BOARD.h

export const inHole = (x: number, y: number): boolean =>
  (x - HOLE.x) ** 2 + (y - HOLE.y) ** 2 <= HOLE.r * HOLE.r

/** Points one bag is worth when the round ends. */
export function bagPoints(b: Bag): number {
  if (b.st === 'hole') return 3
  if (b.st === 'rest') return 1
  return 0
}

/** Throw the current player's next bag. Returns false when it is not their throw. */
export function toss(s: State, shot: ShotParams): boolean {
  if (s.phase !== 'aim' || s.tosses[s.turn] >= BAGS_EACH) return false
  const o = THROW[s.turn] as { x: number; y: number }
  const sh = launch(o.x, o.y, shot, TOSS)
  s.bags.push({
    side: s.turn,
    x: o.x,
    y: o.y,
    z: sh.z,
    vx: sh.vx,
    vy: sh.vy,
    vz: sh.vz,
    st: 'air',
    since: 0,
    rot: s.bags.length * 1.3,
  })
  s.tosses[s.turn]++
  s.aiming = null
  s.phase = 'fly'
  return true
}

/** The winner once someone has reached the match target, else null. */
export function winner(s: State): Side | null {
  if (s.score[0] >= s.target && s.score[0] >= s.score[1]) return 0
  if (s.score[1] >= s.target) return 1
  return null
}

/** Advance bags and phases by `dt` seconds. Mutates `s`, returns what happened. */
export function advance(s: State, dt: number): Event[] {
  const ev: Event[] = []
  s.now += dt
  if (s.phase === 'score') {
    s.timer -= dt
    if (s.timer <= 0) nextRound(s, ev)
    return ev
  }
  if (s.phase !== 'fly') return ev
  for (const b of s.bags) b.since += dt
  // Two substeps: a fast bag must not skip past a pushed one.
  for (let k = 0; k < 2; k++) {
    for (const b of s.bags) moveBag(b, dt / 2, ev)
    collide(s.bags, ev)
  }
  if (!s.bags.some((b) => b.st === 'air' || b.st === 'slide')) settleTurn(s, ev)
  return ev
}

function moveBag(b: Bag, dt: number, ev: Event[]): void {
  if (b.st === 'air') {
    b.rot = (b.rot ?? 0) + (b.side === 0 ? 6 : -6) * dt
    b.vz -= TOSS.g * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.z += b.vz * dt
    if (b.z > 0 || b.vz > 0) return
    b.z = 0
    b.since = 0
    if (onBoard(b.x, b.y)) {
      b.st = 'slide'
      b.vx *= LAND
      b.vy *= LAND
      ev.push({ kind: 'land', side: b.side, x: b.x, y: b.y })
    } else {
      b.st = 'table'
      b.vx = 0
      b.vy = 0
      ev.push({ kind: 'table', side: b.side, x: b.x, y: b.y })
    }
    return
  }
  if (b.st === 'off') {
    // Falling off the board: sink out of sight, no more physics.
    b.z = Math.max(-300, b.z - 900 * dt)
    return
  }
  if (b.st !== 'slide') return
  const sp = Math.hypot(b.vx, b.vy)
  if (inHole(b.x, b.y) && sp < CAPTURE) {
    b.st = 'hole'
    b.since = 0
    b.x = HOLE.x
    b.y = HOLE.y
    b.vx = 0
    b.vy = 0
    ev.push({ kind: 'hole', side: b.side, x: HOLE.x, y: HOLE.y })
    return
  }
  const ns = Math.max(0, sp - DECEL * dt)
  if (sp > 0) {
    const k = ns / sp
    b.vx *= k
    b.vy *= k
  }
  b.x += b.vx * dt
  b.y += b.vy * dt
  b.rot = (b.rot ?? 0) + ns * 0.004 * dt * (b.side === 0 ? 1 : -1)
  if (!onBoard(b.x, b.y)) {
    b.st = 'off'
    b.since = 0
    b.vx = 0
    b.vy = 0
    ev.push({ kind: 'off', side: b.side, x: b.x, y: b.y })
    return
  }
  if (ns < STOP) {
    b.vx = 0
    b.vy = 0
    b.st = 'rest'
    b.since = 0
    ev.push({ kind: 'rest', side: b.side, x: b.x, y: b.y })
  }
}

/** Bags touching each other: a moving bag shoves whatever it meets (equal mass, bouncy). */
function collide(bags: Bag[], ev: Event[]): void {
  for (let i = 0; i < bags.length; i++) {
    for (let j = i + 1; j < bags.length; j++) {
      const a = bags[i] as Bag
      const b = bags[j] as Bag
      if (!live(a) || !live(b)) continue
      if (a.st !== 'slide' && b.st !== 'slide') continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d >= BAG_R * 2 || d === 0) continue
      const nx = dx / d
      const ny = dy / d
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      // Separate the pair so they do not stick together.
      const push = (BAG_R * 2 - d) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      if (rel <= 0) continue
      const J = rel * 0.8
      a.vx -= J * nx
      a.vy -= J * ny
      b.vx += J * nx
      b.vy += J * ny
      for (const c of [a, b]) {
        if (c.st === 'rest') {
          c.st = 'slide'
          c.since = 0
        }
      }
      ev.push({ kind: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    }
  }
}

const live = (b: Bag): boolean => b.st === 'air' || b.st === 'slide' || b.st === 'rest'

function settleTurn(s: State, ev: Event[]): void {
  if (s.tosses[0] + s.tosses[1] < BAGS_EACH * 2) {
    s.turn = other(s.turn)
    s.phase = 'aim'
    ev.push({ kind: 'turn', side: s.turn })
    return
  }
  // Round over: cancellation, only the difference counts for the leader.
  const pts: [number, number] = [0, 0]
  for (const b of s.bags) pts[b.side] += bagPoints(b)
  const diff = pts[0] - pts[1]
  const gain: Side | null = diff === 0 ? null : diff > 0 ? 0 : 1
  const amount = Math.abs(diff)
  if (gain !== null) s.score[gain] += amount
  s.roundPts = pts
  s.scoredAt = s.now
  s.phase = 'score'
  s.timer = SCORE_PAUSE
  ev.push({ kind: 'scored', pts, gain, amount })
}

function nextRound(s: State, ev: Event[]): void {
  if (winner(s) !== null) {
    s.phase = 'over'
    return
  }
  s.round++
  s.starter = other(s.starter)
  s.turn = s.starter
  s.bags = []
  s.tosses = [0, 0]
  s.roundPts = null
  s.roundAt = s.now
  s.phase = 'aim'
  ev.push({ kind: 'round', round: s.round })
  ev.push({ kind: 'turn', side: s.turn })
}

/** Where a shot lands on the ground (for the bot and tests). */
export function landingOf(side: Side, shot: ShotParams): { x: number; y: number } {
  const o = THROW[side] as { x: number; y: number }
  const sh = launch(o.x, o.y, shot, TOSS)
  for (let i = 0; i < 2000 && sh.z > 0; i++) stepShell(sh, 1 / 120, 0, TOSS)
  return { x: sh.x, y: sh.y }
}
