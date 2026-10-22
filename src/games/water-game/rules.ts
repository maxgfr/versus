import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { hash01 } from '../../engines/runner/index.ts'

/**
 * Pure rules for Water Game. Each player has a water tank in their own half.
 * The layout is written once in red's frame (the bottom half, y grows toward
 * red); blue's tank is the same layout turned 180° by `frame()`.
 *
 * Rings sink slowly through the water. A pump blasts bubbles up from its nozzle:
 * bubbles lift the rings they reach and push them sideways (the left pump pushes
 * right, the right pump pushes left). A ring that sinks onto a peg's tip slides
 * down it and stays there. A ring that misses settles on the sand, which slopes
 * into the nozzle wells, so it rolls back over a nozzle to be blown up again:
 * every ring can be landed, the first player to land all of them wins.
 */

/** Rings each player has to land. */
export const RINGS = 6
/** Seconds between two rings leaving the dispenser. */
export const DROP_EVERY = 3.4
/** Seconds before the first ring. */
export const FIRST_DROP = 1.2

/** The tank in red's frame: rim at `top`, water from `surface` to `floor`. */
export const TANK = { x0: 110, x1: 890, top: 990, surface: 1050, floor: 1530 } as const
/** Depth of the sand bed: its surface is the floor the rings settle on. */
export const SAND = 40
/** Default match: seconds on the clock (the players may change it on the ready screen). */
export const LIMIT = 60
/** The two pump buttons (red frame): x of [left, right], and their height and radius. */
export const BUTTON = { x: [205, 795] as const, y: 1660, r: 72 } as const
/** Peg centres (red frame). */
export const PEGS: readonly [number, number] = [340, 660]
/** Peg height above the tank floor. */
export const PEG_H = 170
/** Half the width of a peg. */
export const PEG_R = 15
/** Pump nozzles on the tank floor: [left pump, right pump]. */
export const NOZZLES: readonly [number, number] = [380, 620]

/** A ring's outer radius (its half-width). */
export const RING_R = 34
/** Half the height of a ring seen side on, lying nearly flat: how close it gets to the surface and the sand. */
export const RING_HALF = 16
/** Height one landed ring adds to a peg's stack. */
export const RING_STEP = 18
/** Y of the sand surface, and of a ring's centre resting on it. */
export const SAND_Y = TANK.floor - SAND
export const REST_Y = SAND_Y - RING_HALF + 4
/** Y of a peg's tip: a ring sinking onto it here threads the peg. */
export const TIP = TANK.floor - PEG_H
/** A ring threads a peg whose centre is within this distance of the peg... */
export const CATCH = 24
/** ...while its centre is in this band just under the tip. */
const BAND = 30

/** Water: a ring sinks at SINK / DRAG (≈ 70 u/s) when nothing pushes it. */
const SINK = 112
const DRAG = 1.6
const XDRAG = 2.2
/** Bubble forces: lift (upward) and push (sideways), at a bubble's centre. */
const LIFT = 220
const PUSH = 200
/** Bubbles push rings this far away. */
const REACH = 130
/** Seconds between bubbles from one nozzle while its pump is held. */
const BUBBLE_EVERY = 0.085
/** Bubble rise speed (u/s), and the range of their sideways drift toward the middle (u/s). */
const RISE = 300
const LEAN: readonly [number, number] = [60, 120]
/** A pumping nozzle kicks a ring lying within JET of it up at KICK u/s. */
const JET = 46
const KICK = 230
/** Top speed (u/s) of a ring rolling down the sand into a nozzle well. */
const ROLL = 110
/**
 * A fresh press is a blast: a few strong bubbles on top of the stream, like
 * slapping the toy's button. Pumping in quick strokes moves more water than
 * holding, so how hard and fast a player works the pump matters.
 */
export const BLAST = 3
export const BLAST_F = 1.35

export interface Ring {
  id: number
  x: number
  y: number
  vx: number
  vy: number
}

/** A bubble rises at `v` and drifts sideways at `h`: the left pump leans right, the right one left. */
export interface Bubble {
  x: number
  y: number
  v: number
  h: number
  p: number
  r: number
  /** Strength: 1 for the stream, more for a blast. */
  f: number
}

export interface Tank {
  /** The match's course seed: both tanks get their rings at the same places. */
  seed: number
  /** Pumps held last step, so a fresh press can blast. */
  was: [boolean, boolean]
  /** Rings in the water. */
  rings: Ring[]
  /** Rings sitting on each peg. */
  pegs: [number, number]
  /** Ids of the rings on each peg, bottom first (their colour comes from the id). */
  stacks: [number[], number[]]
  /** Game time a ring last landed on each peg (drives the slide-down animation). */
  landAt: [number, number]
  /** Rings released so far (out of RINGS). */
  released: number
  /** Rings that sank to the sand (they roll back to a nozzle and stay in play). */
  missed: number
  /** Where the next ring drops in. Rolled ahead so the players can see it coming. */
  nextX: number
  /** Game time of the next release. */
  nextAt: number
  /** Game time each nozzle may puff its next bubble. */
  puffAt: [number, number]
  bubbles: Bubble[]
  nextId: number
}

/** Something that happened in a step, in red's frame, for juice and bots. */
export type TankEv =
  | { k: 'drop'; x: number; y: number }
  | { k: 'land'; peg: 0 | 1; x: number; y: number; n: number; v: number }
  | { k: 'miss'; x: number; y: number }

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v)

/** Y of the centre of the `i`-th ring (0 = bottom) on a peg's stack. */
export function seatY(i: number): number {
  return SAND_Y - RING_HALF * 0.6 - i * RING_STEP
}

/** Top of a peg's stack once `n` rings sit on it (smaller y is higher). */
export function stackTop(n: number): number {
  return SAND_Y - n * RING_STEP
}

/** The nozzle well a ring on the sand rolls into: the nearer one. */
export function wellOf(x: number): 0 | 1 {
  return Math.abs(x - NOZZLES[0]) <= Math.abs(x - NOZZLES[1]) ? 0 : 1
}

/** Where ring `i` (0-based) drops in: the same for both players. */
export function dropX(seed: number, i: number): number {
  return 320 + hash01(seed, i, 41) * 360
}

export function newTank(seed: number): Tank {
  return {
    seed,
    was: [false, false],
    rings: [],
    pegs: [0, 0],
    stacks: [[], []],
    landAt: [-9, -9],
    released: 0,
    missed: 0,
    nextX: dropX(seed, 0),
    nextAt: FIRST_DROP,
    puffAt: [0, 0],
    bubbles: [],
    nextId: 1,
  }
}

/** Rings landed on both pegs. */
export function landedOf(t: Tank): number {
  return t.pegs[0] + t.pegs[1]
}

/** Who has more landed rings: red (0), blue (1), or a tie. */
export function ringWinner(red: number, blue: number): Side | 'draw' {
  if (red === blue) return 'draw'
  return red > blue ? 0 : 1
}

/**
 * The match at the whistle: more rings landed wins; equal counts go to whoever
 * got there first (the earlier last landing); nothing landed or a dead heat is a draw.
 */
export function tankWinner(a: Tank, b: Tank): Side | 'draw' {
  const w = ringWinner(landedOf(a), landedOf(b))
  if (w !== 'draw' || landedOf(a) === 0) return w
  const ta = Math.max(a.landAt[0], a.landAt[1])
  const tb = Math.max(b.landAt[0], b.landAt[1])
  return ta === tb ? 'draw' : ta < tb ? 0 : 1
}

/** True when a ring lies on the sand. */
export const resting = (r: Ring): boolean => r.y >= REST_Y - 0.5

/** Advance one tank by `dt` seconds. Mutates `t` (plain data) and returns what happened. */
export function stepTank(
  t: Tank,
  dt: number,
  time: number,
  pump: readonly [boolean, boolean],
  rng: Rng,
): TankEv[] {
  const ev: TankEv[] = []

  // The dispenser lets the next ring go.
  if (t.released < RINGS && time >= t.nextAt) {
    t.rings.push({ id: t.nextId++, x: t.nextX, y: TANK.surface + RING_HALF, vx: 0, vy: 0 })
    ev.push({ k: 'drop', x: t.nextX, y: TANK.surface })
    t.released++
    t.nextAt = time + DROP_EVERY
    t.nextX = dropX(t.seed, t.released)
  }

  // Pumps puff bubbles up from their nozzles; a fresh press blasts.
  for (const side of [0, 1] as const) {
    const fresh = pump[side] && !t.was[side]
    t.was[side] = pump[side]
    if (fresh) {
      for (let k = 0; k < BLAST; k++) {
        t.bubbles.push({
          x: NOZZLES[side] + rng.range(-16, 16),
          y: TANK.floor - k * 14,
          v: RISE * rng.range(1.15, 1.4),
          h: (side === 0 ? 1 : -1) * rng.range(LEAN[0], LEAN[1]),
          p: rng.range(0, Math.PI * 2),
          r: rng.range(14, 20),
          f: BLAST_F,
        })
      }
      for (const r of t.rings) {
        if (resting(r) && Math.abs(r.x - NOZZLES[side]) < JET)
          r.vy = Math.min(r.vy, -KICK * BLAST_F)
      }
    }
    if (!pump[side] || time < t.puffAt[side]) continue
    t.puffAt[side] = time + BUBBLE_EVERY
    t.bubbles.push({
      // Bubbles start down in the nozzle, under the sand, so they catch a ring lying on it.
      x: NOZZLES[side] + rng.range(-12, 12),
      y: TANK.floor,
      v: RISE * rng.range(0.85, 1.2),
      h: (side === 0 ? 1 : -1) * rng.range(LEAN[0], LEAN[1]),
      p: rng.range(0, Math.PI * 2),
      r: rng.range(9, 16),
      f: 1,
    })
    // The jet pops a ring lying in the well straight up off the sand.
    for (const r of t.rings) {
      if (resting(r) && Math.abs(r.x - NOZZLES[side]) < JET) r.vy = Math.min(r.vy, -KICK)
    }
  }
  for (const b of t.bubbles) {
    b.p += dt * 3
    b.y -= b.v * dt
    b.x = clamp(b.x + (b.h + Math.sin(b.p) * 25) * dt, TANK.x0 + 20, TANK.x1 - 20)
  }
  t.bubbles = t.bubbles.filter((b) => b.y > TANK.surface - 10)

  for (const r of t.rings) {
    // Bubbles reaching a ring lift it (when they are at or below it) and push it sideways.
    for (const b of t.bubbles) {
      const dx = r.x - b.x
      const dy = b.y - r.y
      // Only bubbles still below the ring push it: once they pass it, the push stops.
      if (dy < -RING_R * 0.3 || dy > REACH) continue
      const d = Math.hypot(dx, dy)
      if (d >= REACH) continue
      const f = (1 - d / REACH) * b.f
      r.vy -= LIFT * f * dt
      r.vx += PUSH * Math.sign(b.h) * f * dt
    }
    r.vy += (SINK - DRAG * r.vy) * dt
    r.vx -= r.vx * XDRAG * dt
    r.vx = clamp(r.vx, -320, 320)
    r.vy = clamp(r.vy, -600, 200)
    r.x += r.vx * dt
    r.y += r.vy * dt

    const lo = TANK.x0 + RING_R
    const hi = TANK.x1 - RING_R
    if (r.x < lo) {
      r.x = lo
      r.vx = Math.abs(r.vx) * 0.4
    } else if (r.x > hi) {
      r.x = hi
      r.vx = -Math.abs(r.vx) * 0.4
    }
    const surf = TANK.surface + RING_HALF
    if (r.y < surf) {
      r.y = surf
      if (r.vy < 0) r.vy = 0
    }
    // The sand: a ring that reaches it settles and rolls down into the nearer nozzle well.
    if (r.y >= REST_Y) {
      if (r.vy > 25) {
        t.missed++
        ev.push({ k: 'miss', x: r.x, y: SAND_Y })
      }
      r.y = REST_Y
      if (r.vy > 0) r.vy = 0
      const want = clamp((NOZZLES[wellOf(r.x)] - r.x) * 3, -ROLL, ROLL)
      r.vx += (want - r.vx) * Math.min(1, 5 * dt)
    }
  }

  // Rings on the sand do not lie on top of each other: they queue beside the well.
  for (let i = 0; i < t.rings.length; i++) {
    const a = t.rings[i]!
    if (!resting(a)) continue
    for (let j = i + 1; j < t.rings.length; j++) {
      const b = t.rings[j]!
      if (!resting(b)) continue
      const dx = b.x - a.x
      const gap = RING_R * 1.7 - Math.abs(dx)
      if (gap <= 0) continue
      const s = dx === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dx)
      a.x -= (s * gap) / 2
      b.x += (s * gap) / 2
    }
  }

  const keep: Ring[] = []
  for (const r of t.rings) {
    let gone = false
    for (const p of [0, 1] as const) {
      const peg = PEGS[p]
      if (r.y + 10 < TIP) continue
      const dx = r.x - peg
      const ad = Math.abs(dx)
      if (ad <= CATCH && r.y <= TIP + BAND) {
        // Sinking over the tip: it threads the peg and slides down. Rising, it passes by.
        if (r.vy < 0) continue
        t.pegs[p]++
        t.stacks[p].push(r.id)
        t.landAt[p] = time
        ev.push({ k: 'land', peg: p, x: peg, y: TIP, n: landedOf(t), v: r.vy })
        gone = true
        break
      }
      // On the sand a ring rolls past the foot of a peg; in the water it bumps the rod.
      if (resting(r)) continue
      if (ad < RING_R + PEG_R) {
        const side = dx < 0 ? -1 : 1
        r.x = peg + side * (RING_R + PEG_R)
        r.vx = side * 60
      }
    }
    if (!gone) keep.push(r)
  }
  t.rings = keep
  return ev
}
