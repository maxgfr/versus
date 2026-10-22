import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, MID, W } from '../../core/stage.ts'
import { collideDynamic, collideKinematic, type Disc, integrate } from '../../engines/puck/index.ts'

/**
 * Happy Hippos: a round pond in the middle, a hippo on each shore. Marbles roll
 * around the pond; a tap makes your hippo lunge its head toward the tap, and
 * whatever marbles drift into its mouth get chomped. Everything is in world
 * coordinates (red's hippo at the bottom shore, blue's at the top). Pure: no
 * DOM, no Math.random.
 */

export const POND = { x: W / 2, y: MID, r: 470 }
export const MARBLE_R = 34
export const HEAD_R = 92
/** The mouth: a circle at the front of the head that chomps. */
export const MOUTH_R = 74
/** How far along the head's radius the mouth sits. */
export const MOUTH_AT = 0.72
/** Hippo base distance from the table edge. */
export const BASE_Y = 1650
/** Head centre resting distance in front of the base. */
export const REST_DIST = 74
export const REACH = 330
export const MIN_REACH = 150
export const LUNGE_OUT = 0.12
export const HOLD = 0.08
export const BACK = 0.3
const COOL = 0.22
/** Seconds between marbles released into the pond: brisk at first, quicker as the match goes on. */
export const SPAWN_EVERY = 1.1
export const SPAWN_FAST = 0.65
/** After the last marble is released, the match ends after this long even if some are left. */
export const END_GRACE = 10
/**
 * Once every marble is out, the pond tilts toward the shores (units/s², growing
 * over a few seconds): stragglers circling the far sides, out of both hippos'
 * reach, slide back where they can be eaten instead of stalling the ending.
 */
export const TILT = 240
export const TILT_RAMP = 4
const DRAG = 0.42
/** The pond is a low dome: marbles drift out toward the rim, where the hippos can reach them (negative = outward). */
const BOWL = -0.35
const SUB = 3

export type Phase = 'rest' | 'out' | 'hold' | 'back'

export interface Hippo {
  /** Base on its shore (world). */
  bx: number
  by: number
  /** Direction its head points: -1 for red (up the table), +1 for blue. */
  fy: -1 | 1
  phase: Phase
  /** Seconds into the current phase. */
  t: number
  /** Lunge direction (unit) and reach. */
  dx: number
  dy: number
  reach: number
  /** Seconds until the head may lunge again. */
  cool: number
  eaten: number
  /** Ids of the marbles eaten, in order (their colours fill the hippo's tray). */
  ate: number[]
}

export interface Marble extends Disc {
  id: number
}

export interface World {
  hippos: [Hippo, Hippo]
  marbles: Marble[]
  /** Marbles put into the pond so far, out of `target`. */
  released: number
  target: number
  /** Seconds until the next release. */
  spawnT: number
  /** Game time of the last release. */
  lastSpawn: number
  t: number
  nextId: number
}

export type Event =
  | { kind: 'lunge'; side: Side; x: number; y: number }
  | { kind: 'eat'; side: Side; x: number; y: number; id: number }
  | { kind: 'bump'; x: number; y: number; speed: number }
  | { kind: 'wall'; x: number; y: number; speed: number }
  | { kind: 'spawn'; x: number; y: number; id: number }

/** What a side asks for this step: a lunge toward a world point, or nothing. */
export interface Cmd {
  tap: { x: number; y: number } | null
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
type P = { x: number; y: number }
const lerp2 = (a: P, b: P, k: number): P => ({
  x: a.x + (b.x - a.x) * clamp(k, 0, 1),
  y: a.y + (b.y - a.y) * clamp(k, 0, 1),
})

function newHippo(bx: number, by: number, fy: -1 | 1): Hippo {
  return {
    bx,
    by,
    fy,
    phase: 'rest',
    t: 0,
    dx: 0,
    dy: fy,
    reach: REACH,
    cool: 0,
    eaten: 0,
    ate: [],
  }
}

export function newWorld(target: number): World {
  return {
    hippos: [newHippo(W / 2, BASE_Y, -1), newHippo(W / 2, H - BASE_Y, 1)],
    marbles: [],
    released: 0,
    target,
    spawnT: 0.6,
    lastSpawn: 0,
    t: 0,
    nextId: 1,
  }
}

/** Where the head centre is right now. */
export function headAt(h: Hippo): P {
  const rest = { x: h.bx, y: h.by + h.fy * REST_DIST }
  const target = { x: h.bx + h.dx * h.reach, y: h.by + h.dy * h.reach }
  if (h.phase === 'out') {
    const k = h.t / LUNGE_OUT
    return lerp2(rest, target, 1 - (1 - k) * (1 - k))
  }
  if (h.phase === 'hold') return target
  if (h.phase === 'back') return lerp2(target, rest, h.t / BACK)
  return rest
}

/** The chomping point: the front of the head. */
export function mouthOf(h: Hippo): P {
  const head = headAt(h)
  return { x: head.x + h.dx * HEAD_R * MOUTH_AT, y: head.y + h.dy * HEAD_R * MOUTH_AT }
}

/** Start a lunge toward a world point, if the head is at rest and cooled down. */
export function lunge(w: World, side: Side, tx: number, ty: number, events: Event[]): boolean {
  const h = w.hippos[side]
  if (h.phase !== 'rest' || h.cool > 0) return false
  let dx = tx - h.bx
  let dy = ty - h.by
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  // Lunges go forward, toward the pond. A tap back toward the edge does nothing.
  if (dy * h.fy < 0.15) return false
  h.dx = dx
  h.dy = dy
  // Reach so the mouth (not the head's centre) lands on the tapped point.
  h.reach = clamp(len - HEAD_R * MOUTH_AT, MIN_REACH, REACH)
  h.phase = 'out'
  h.t = 0
  events.push({ kind: 'lunge', side, x: h.bx + dx * h.reach, y: h.by + dy * h.reach })
  return true
}

function stepHippo(h: Hippo, dt: number): void {
  h.cool = Math.max(0, h.cool - dt)
  if (h.phase === 'rest') return
  h.t += dt
  const span = h.phase === 'out' ? LUNGE_OUT : h.phase === 'hold' ? HOLD : BACK
  if (h.t >= span) {
    h.t -= span
    if (h.phase === 'out') h.phase = 'hold'
    else if (h.phase === 'hold') h.phase = 'back'
    else {
      h.phase = 'rest'
      h.t = 0
      h.cool = COOL
    }
  }
}

/** Keep a marble inside the pond's round wall. */
function collidePond(p: Disc, events: Event[]): void {
  const dx = p.x - POND.x
  const dy = p.y - POND.y
  const d = Math.hypot(dx, dy)
  const lim = POND.r - p.r
  if (d <= lim || d === 0) return
  const nx = dx / d
  const ny = dy / d
  p.x = POND.x + nx * lim
  p.y = POND.y + ny * lim
  const vn = p.vx * nx + p.vy * ny
  if (vn > 0) {
    p.vx -= 1.75 * vn * nx
    p.vy -= 1.75 * vn * ny
    if (vn > 60) events.push({ kind: 'wall', x: p.x, y: p.y, speed: vn })
  }
}

/** Advance one step. `cmds[side]` holds that side's lunge request, if any. */
export function step(w: World, dt: number, cmds: [Cmd, Cmd], rng: Rng): Event[] {
  const events: Event[] = []
  w.t += dt
  for (const side of [0, 1] as Side[]) {
    const tap = cmds[side]?.tap
    if (tap) lunge(w, side, tap.x, tap.y, events)
  }

  // Head motion this step: from where it was to where it is now.
  const starts = w.hippos.map((h) => headAt(h))
  for (const h of w.hippos) stepHippo(h, dt)
  const ends = w.hippos.map((h) => headAt(h))
  const vel = w.hippos.map((_, i) => {
    const a = starts[i] ?? { x: 0, y: 0 }
    const b = ends[i] ?? { x: 0, y: 0 }
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }
  })

  // Release marbles over time.
  if (w.released < w.target) {
    w.spawnT -= dt
    if (w.spawnT <= 0) {
      const a = rng.range(0, Math.PI * 2)
      const sp = rng.range(260, 420)
      const id = w.nextId++
      w.marbles.push({
        id,
        x: POND.x + rng.range(-40, 40),
        y: POND.y + rng.range(-40, 40),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: MARBLE_R,
      })
      w.released++
      w.lastSpawn = w.t
      w.spawnT = spawnGap(w)
      events.push({ kind: 'spawn', x: POND.x, y: POND.y, id })
    }
  }

  const tilt = w.released >= w.target ? TILT * clamp((w.t - w.lastSpawn) / TILT_RAMP, 0, 1) : 0
  const h = dt / SUB
  for (let s = 0; s < SUB; s++) {
    const frac = (s + 1) / SUB
    const heads = w.hippos.map((_hp, i) => {
      const a = starts[i] ?? { x: 0, y: 0 }
      const b = ends[i] ?? { x: 0, y: 0 }
      const v = vel[i] ?? { vx: 0, vy: 0 }
      return {
        x: a.x + (b.x - a.x) * frac,
        y: a.y + (b.y - a.y) * frac,
        vx: v.vx,
        vy: v.vy,
        r: HEAD_R,
      }
    })
    for (const m of w.marbles) {
      integrate(m, h, DRAG)
      m.vx -= BOWL * (m.x - POND.x) * h
      m.vy -= BOWL * (m.y - POND.y) * h
      if (tilt > 0) m.vy += (m.y < POND.y ? -1 : 1) * tilt * h
      collidePond(m, events)
    }
    for (let i = 0; i < w.marbles.length; i++) {
      for (let j = i + 1; j < w.marbles.length; j++) {
        const a = w.marbles[i]
        const b = w.marbles[j]
        if (!a || !b) continue
        const c = collideDynamic(a, b, 1, 1, 0.82)
        if (c && c.speed > 80) events.push({ kind: 'bump', x: c.x, y: c.y, speed: c.speed })
      }
    }
    // The jaws close before the head shoves: a marble the open mouth reaches is
    // eaten, not batted away by the lunging head.
    for (const side of [0, 1] as Side[]) {
      const hp = w.hippos[side]
      if (hp.phase !== 'out' && hp.phase !== 'hold') continue
      const head = heads[side]
      if (!head) continue
      eatAt(w, side, head.x + hp.dx * HEAD_R * MOUTH_AT, head.y + hp.dy * HEAD_R * MOUTH_AT, events)
    }
    for (const m of w.marbles) {
      for (const head of heads) {
        const c = collideKinematic(m, head, 0.9)
        if (c && c.speed > 80) events.push({ kind: 'bump', x: c.x, y: c.y, speed: c.speed })
      }
      collidePond(m, events)
    }
  }

  // Chomps: a marble in a hippo's mouth while it lunges is eaten.
  for (const side of [0, 1] as Side[]) {
    const hp = w.hippos[side]
    if (hp.phase !== 'out' && hp.phase !== 'hold') continue
    const mouth = mouthOf(hp)
    eatAt(w, side, mouth.x, mouth.y, events)
  }

  // A marble that has nearly stopped gets a nudge, so the pond never goes dead.
  for (const m of w.marbles) {
    if (m.vx * m.vx + m.vy * m.vy < 60 * 60) {
      const a = rng.range(0, Math.PI * 2)
      m.vx += Math.cos(a) * 90
      m.vy += Math.sin(a) * 90
    }
  }
  return events
}

/** Eat every marble within reach of an open mouth at (x, y). */
function eatAt(w: World, side: Side, x: number, y: number, events: Event[]): void {
  const hp = w.hippos[side]
  w.marbles = w.marbles.filter((m) => {
    if (Math.hypot(m.x - x, m.y - y) > MOUTH_R + m.r) return true
    hp.eaten++
    hp.ate.push(m.id)
    events.push({ kind: 'eat', side, x: m.x, y: m.y, id: m.id })
    return false
  })
}

/** Seconds until the next release: the gap shrinks as more marbles have gone in. */
export function spawnGap(w: World): number {
  const k = w.target > 1 ? clamp(w.released / (w.target - 1), 0, 1) : 1
  return SPAWN_EVERY + (SPAWN_FAST - SPAWN_EVERY) * k
}

/** The side that ate more, once the match is over; null while it is not. */
export function winner(w: World): Side | 'draw' | null {
  const done = w.released >= w.target && (w.marbles.length === 0 || w.t - w.lastSpawn >= END_GRACE)
  if (!done) return null
  const [a, b] = w.hippos
  if (a.eaten === b.eaten) return 'draw'
  return a.eaten > b.eaten ? 0 : 1
}
