import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Fruit Duel. Each player has a lane (their half of the table,
 * in that player's own frame: red's view, bottom half). Both lanes are fed by
 * the same seeded throw schedule, so the two halves get exactly the same
 * fruit, at the same moments, in the same places.
 */

/** Match length, seconds. */
export const LIMIT = 45
/** Gravity, world units per s². */
export const G = 1500
/** Where fruit leaves the table: just below the lane's edge. */
export const LAUNCH_Y = 1880
/** Slice reach around a fruit's centre, world units. */
export const REACH = 84
/** Points lost for slicing a bomb. */
export const BOMB_PENALTY = 5
/**
 * A blade must move to cut: a finger slower than this (world units / s) only
 * brushes the fruit. A resting finger can no longer wait for fruit to fly into it.
 */
export const MIN_CUT_SPEED = 420
/** Blade speed for the strongest cut (halves fly apart hardest, juice sprays widest). */
export const FAST_CUT = 3200
/** Swipe trail lifetime, seconds. */
export const TRAIL_LIFE = 0.2
/** Juice stains left on the board, newest last. */
export const MAX_SPLATS = 14
/** Seconds a stain takes to dry away. */
export const SPLAT_LIFE = 7
/** World midline: lanes span MID..H in their own frame. */
const MID = 900

export interface FruitKind {
  ch: string
  value: number
  /** Juice colour splashed out when cut. */
  juice: string
}

export const FRUITS: readonly FruitKind[] = [
  { ch: '🍎', value: 1, juice: '#ff4d4d' },
  { ch: '🍊', value: 1, juice: '#ff9f1c' },
  { ch: '🍋', value: 1, juice: '#ffe14d' },
  { ch: '🍑', value: 2, juice: '#ffb085' },
  { ch: '🍇', value: 2, juice: '#9d6bff' },
  { ch: '🍓', value: 2, juice: '#ff4f7b' },
  { ch: '🥝', value: 2, juice: '#8fd14f' },
  { ch: '🍍', value: 3, juice: '#ffd23f' },
  { ch: '🍉', value: 3, juice: '#ff5c7c' },
]

/** Kind -1 is a bomb. */
export const BOMB = -1

export interface Throw {
  /** Seconds from the start of the match. */
  t: number
  /** Launch x in lane coordinates. */
  x: number
  vx: number
  vy: number
  /** Index in FRUITS, or BOMB. */
  kind: number
}

export interface Fruit {
  id: number
  kind: number
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
}

/** The two halves of a cut fruit, each showing one side of the cut. */
export interface Half {
  kind: number
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  /** Direction of the cut (radians), in lane coordinates. */
  cut: number
  /** +1 or -1: which half of the fruit this is. */
  part: 1 | -1
  born: number
}

export interface Pt {
  x: number
  y: number
  t: number
  /** 1 when this point starts a new stroke (not joined to the one before). */
  b?: 1
}

/** A juice stain (or a scorch mark for a bomb) on the board, cosmetic. */
export interface Splat {
  x: number
  y: number
  kind: number
  rot: number
  born: number
}

export interface Lane {
  score: number
  /** Game time of the last cut, for the score's bump. */
  hitAt: number
  /** Value of that cut (negative for a bomb). */
  hitValue: number
  splats: Splat[]
  /** Next throw to launch. */
  next: number
  nid: number
  fruit: Fruit[]
  halves: Half[]
  trail: Pt[]
}

/** A finger's movement this step, in lane coordinates. */
export type Seg = [number, number, number, number]

export type Ev =
  | { k: 'launch'; x: number; y: number }
  | {
      k: 'slice'
      x: number
      y: number
      kind: number
      /** Points this slice was worth (negative for bombs). */
      value: number
      /** Combo points from the same swipe, paid once with the first fruit. */
      bonus: number
      /** How many things this one swipe cut. */
      cut: number
      /** 0..1 how fast the blade was moving. */
      force: number
    }

export const laneNew = (): Lane => ({
  score: 0,
  hitAt: -10,
  hitValue: 0,
  splats: [],
  next: 0,
  nid: 1,
  fruit: [],
  halves: [],
  trail: [],
})

/**
 * The shared throw schedule. Volleys of one to three throws, getting quicker
 * as the match goes on; bombs get a little more common late.
 */
export function schedule(seed: number, limit = LIMIT): Throw[] {
  const rng = new Rng(seed)
  const out: Throw[] = []
  let t = 1.2
  while (t < limit) {
    const k = t / limit
    // Busier as the clock runs down: more doubles and triples late in the match.
    const volley = rng.chance(0.06 + 0.16 * k) ? 3 : rng.chance(0.3 + 0.2 * k) ? 2 : 1
    for (let i = 0; i < volley; i++) {
      const bomb = rng.chance(0.13 + 0.06 * k)
      const kind = bomb ? BOMB : rng.int(0, FRUITS.length - 1)
      const apex = rng.range(MID + 170, MID + 560)
      const flight = Math.sqrt((2 * (LAUNCH_Y - apex)) / G)
      const x0 = rng.range(150, 850)
      const target = rng.range(120, 880)
      out.push({
        t: t + i * 0.04,
        x: x0,
        vx: (target - x0) / (2 * flight),
        vy: -G * flight,
        kind,
      })
    }
    t += rng.range(0.9, 1.45) * (1.12 - 0.3 * k)
  }
  return out
}

/** Launch every throw that is due. */
export function launchDue(l: Lane, sched: readonly Throw[], time: number): Ev[] {
  const out: Ev[] = []
  while (l.next < sched.length && (sched[l.next] as Throw).t <= time) {
    const th = sched[l.next] as Throw
    l.next++
    l.fruit.push({
      id: l.nid++,
      kind: th.kind,
      x: th.x,
      y: LAUNCH_Y,
      vx: th.vx,
      vy: th.vy,
      rot: 0,
      vr: (th.vx >= 0 ? 1 : -1) * 2.2,
    })
    out.push({ k: 'launch', x: th.x, y: LAUNCH_Y })
  }
  return out
}

/** Distance squared from a point to a segment. */
export function distSq(px: number, py: number, s: Seg): number {
  const [ax, ay, bx, by] = s
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + dx * t - px
  const qy = ay + dy * t - py
  return qx * qx + qy * qy
}

/** Would a swipe along `s` pass close to any bomb in the lane? */
export function crossesBomb(l: Lane, s: Seg, margin = 1): boolean {
  const r = REACH * margin
  return l.fruit.some((f) => f.kind === BOMB && distSq(f.x, f.y, s) <= r * r)
}

/** Move fruit and halves for one step; drop what has fallen away or faded. */
export function integrate(l: Lane, dt: number, time: number): void {
  for (const f of l.fruit) {
    f.vy += G * dt
    f.x += f.vx * dt
    f.y += f.vy * dt
    f.rot += f.vr * dt
  }
  l.fruit = l.fruit.filter((f) => f.y < LAUNCH_Y + 160)
  for (const h of l.halves) {
    h.vy += G * dt
    h.x += h.vx * dt
    h.y += h.vy * dt
    h.rot += h.vr * dt
  }
  l.halves = l.halves.filter((h) => time - h.born < 1.1 && h.y < LAUNCH_Y + 200)
  l.trail = l.trail.filter((p) => time - p.t < TRAIL_LIFE)
  if (l.splats.length && time - (l.splats[0] as Splat).born > SPLAT_LIFE) l.splats.shift()
}

function stain(l: Lane, f: Fruit, cut: number, time: number): void {
  l.splats.push({ x: f.x, y: f.y, kind: f.kind, rot: cut, born: time })
  if (l.splats.length > MAX_SPLATS) l.splats.shift()
}

/**
 * Cut everything the finger paths pass through. Bombs cost points and explode.
 * Fruit adds its value; a swipe that cuts several fruit also earns one bonus
 * point per fruit beyond the first.
 */
/** How fast a blade segment moved over `dt`, as 0..1 of a full-speed cut (below the minimum: 0). */
export function cutForce(s: Seg, dt: number): number {
  const v = Math.hypot(s[2] - s[0], s[3] - s[1]) / Math.max(dt, 1e-6)
  if (v < MIN_CUT_SPEED) return 0
  return Math.min(1, Math.max(0.05, (v - MIN_CUT_SPEED) / (FAST_CUT - MIN_CUT_SPEED)))
}

export function slice(l: Lane, paths: readonly Seg[], time: number, dt = 1 / 60): Ev[] {
  const out: Ev[] = []
  if (paths.length === 0) return out
  const hit: { f: Fruit; seg: Seg; force: number }[] = []
  for (const f of l.fruit) {
    const seg = paths.find((s) => distSq(f.x, f.y, s) <= REACH * REACH && cutForce(s, dt) > 0)
    if (seg) hit.push({ f, seg, force: cutForce(seg, dt) })
  }
  if (hit.length === 0) return out
  const hitIds = new Set(hit.map((h) => h.f.id))
  l.fruit = l.fruit.filter((f) => !hitIds.has(f.id))
  const fruitCut = hit.filter((h) => h.f.kind !== BOMB).length
  const bonus = Math.max(0, fruitCut - 1)
  l.score += bonus
  let bonusLeft = bonus
  for (const { f, seg, force } of hit) {
    const cut = Math.atan2(seg[3] - seg[1], seg[2] - seg[0])
    stain(l, f, cut, time)
    l.hitAt = time
    if (f.kind === BOMB) {
      l.hitValue = -BOMB_PENALTY
      l.score -= BOMB_PENALTY
      out.push({
        k: 'slice',
        x: f.x,
        y: f.y,
        kind: BOMB,
        value: -BOMB_PENALTY,
        bonus: 0,
        cut: hit.length,
        force,
      })
      continue
    }
    const value = (FRUITS[f.kind] as FruitKind).value
    l.score += value
    l.hitValue = value
    // The combo bonus is shown once, on the first fruit of the swipe.
    const extra = bonusLeft
    bonusLeft = 0
    out.push({
      k: 'slice',
      x: f.x,
      y: f.y,
      kind: f.kind,
      value,
      bonus: extra,
      cut: hit.length,
      force,
    })
    // The two halves fly apart across the cut, harder for a faster blade, and
    // carried a little along the swipe.
    const px = -Math.sin(cut)
    const py = Math.cos(cut)
    const spin = f.id % 2 === 0 ? 1 : -1
    const apart = 220 + 260 * force
    const carry = 160 * force
    for (const part of [1, -1] as const) {
      l.halves.push({
        kind: f.kind,
        x: f.x,
        y: f.y,
        vx: f.vx + px * part * apart + Math.cos(cut) * carry,
        vy: f.vy + py * part * apart - 120 + Math.sin(cut) * carry,
        rot: f.rot,
        vr: spin * (4 + 5 * force) * part,
        cut,
        part,
        born: time,
      })
    }
  }
  return out
}

/** One lane step: launches, motion, cuts and the cursor trail. */
export function laneStep(
  l: Lane,
  dt: number,
  time: number,
  sched: readonly Throw[],
  paths: readonly Seg[],
): Ev[] {
  const out = launchDue(l, sched, time)
  integrate(l, dt, time)
  out.push(...slice(l, paths, time, dt))
  // The blade trail follows the first finger; a fresh stroke is not joined to the last one.
  const seg = paths[0]
  if (seg) {
    const prev = l.trail[l.trail.length - 1]
    if (!prev || Math.hypot(prev.x - seg[0], prev.y - seg[1]) > 1)
      l.trail.push({ x: seg[0], y: seg[1], t: time, b: 1 })
    if (seg[2] !== seg[0] || seg[3] !== seg[1]) l.trail.push({ x: seg[2], y: seg[3], t: time })
  }
  return out
}

/** Winner by score; equal scores draw. */
export function winnerOf(scores: [number, number]): Side | 'draw' {
  if (scores[0] === scores[1]) return 'draw'
  return scores[0] > scores[1] ? 0 : 1
}
