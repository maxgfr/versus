import type { Side } from '../../core/game.ts'
import { frame } from '../../core/frame.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'

/**
 * Pure rules for Sticky Tongues. Coordinates are world units. Red's layout is
 * written as red sees it (bottom half); blue's is placed with `frame`.
 */

/** Seconds per game. */
export const GAME_TIME = 40
/** Fly body radius and tongue tip radius. */
export const FLY_R = 30
export const TIP_R = 18
/**
 * Tongue length. A tap sets the direction only: every flick stretches to full
 * length (so a frog can reach over the midline and snatch the other's flies),
 * and a miss costs the whole round trip.
 */
export const REACH = 700
/** Taps closer than this to the mouth are ignored (a stub of a tongue is no shot). */
export const MIN_REACH = 120
export const OUT_SPEED = 2300
/** A flick from the frog sends the tongue faster the harder it is: up to this. */
export const FLICK_MAX = 3300
/** Flick finger speed (units/s) that gives the fastest tongue. */
export const FLICK_FULL = 3200
export const BACK_SPEED = 1700
/** Pause at full stretch before retracting. */
export const HOLD = 0.06
/** A tap this old (s) still fires once the tongue is home. */
export const QUEUE_TIME = 0.45
/** Flies kept on the field. */
export const FLY_COUNT = 7
/** The band the flies buzz in; shared by both frogs. */
export const FIELD = { x0: 150, x1: 850, y0: 660, y1: 1140 }
/** Mouth and pad, in red's layout (blue's is the mirror image). */
export const MOUTH_Y = 1500
export const PAD_Y = 1560
export const GOLDEN_CHANCE = 0.14
export const FLY_SPEED = 170
export const GOLD_SPEED = 260
/** The last FRENZY seconds: more flies, faster, and more of them golden. */
export const FRENZY = 10
export const FRENZY_GOLD = 0.32
export const FRENZY_SPEED = 1.25
export const FRENZY_EXTRA = 2
/** Points for a plain and a golden fly. */
export const POINTS = { plain: 1, golden: 3 } as const

export interface Vec {
  x: number
  y: number
}

export interface Fly {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  golden: boolean
  /** Seconds until the fly picks a new heading. */
  turn: number
  /** Side whose tongue holds it, or -1 while free. */
  held: number
}

export type TonguePhase = 'idle' | 'out' | 'hold' | 'back'

export interface Tongue {
  phase: TonguePhase
  /** Current length from the mouth. */
  len: number
  /** Length this shot is flying to (always REACH: the tap only aims). */
  reach: number
  /** Unit direction of the shot. */
  dx: number
  dy: number
  /** Seconds left to hold at full stretch. */
  hold: number
  /** Out speed of this shot (a hard flick is faster). */
  speed: number
  /** Id of the fly on the tip, -1 when none. */
  fly: number
}

export interface Frog {
  tongue: Tongue
  /** The last tap, kept for QUEUE_TIME so a tap during a retract still fires. */
  queue: { x: number; y: number; t: number; speed?: number } | null
  score: number
  /** Flies caught (plain and golden). */
  caught: number
  /** Game time of the last shot (-1 never). */
  shotAt: number
  /** Game time of the last fly eaten (-1 never). */
  eatAt: number
  /** Game time of the last catch (-1 never): the score pops then. */
  catchAt: number
}

export interface World {
  flies: Fly[]
  nextId: number
  /** Countdown to the next spawn while the field is short. */
  spawn: number
  frogs: [Frog, Frog]
}

export type FieldEvent =
  | { kind: 'shot'; side: Side; x: number; y: number }
  | { kind: 'catch'; side: Side; x: number; y: number; golden: boolean }
  | { kind: 'eat'; side: Side; x: number; y: number; golden: boolean }
  | { kind: 'miss'; side: Side; x: number; y: number }

/** Where a side's tongue leaves its frog. */
export const mouth = (side: Side): Vec => frame(side, W / 2, MOUTH_Y)

/** Centre of a side's lily pad. */
export const padAt = (side: Side): Vec => frame(side, W / 2, PAD_Y)

export const tongueNew = (): Tongue => ({
  phase: 'idle',
  len: 0,
  reach: 0,
  dx: 0,
  dy: -1,
  hold: 0,
  speed: OUT_SPEED,
  fly: -1,
})

export const frogNew = (): Frog => ({
  tongue: tongueNew(),
  queue: null,
  score: 0,
  caught: 0,
  shotAt: -1,
  eatAt: -1,
  catchAt: -1,
})

/** The tongue tip in world coordinates. */
export function tipOf(side: Side, t: Tongue): Vec {
  const m = mouth(side)
  return { x: m.x + t.dx * t.len, y: m.y + t.dy * t.len }
}

function heading(f: Fly, rng: Rng, frenzy = false): void {
  const a = rng.range(0, Math.PI * 2)
  const sp = (f.golden ? GOLD_SPEED : FLY_SPEED) * (frenzy ? FRENZY_SPEED : 1)
  f.vx = Math.cos(a) * sp
  f.vy = Math.sin(a) * sp
  f.turn = rng.range(0.5, 1.3)
}

/** Put a new fly somewhere in the band. */
export function spawnFly(w: World, rng: Rng, golden = rng.chance(GOLDEN_CHANCE)): Fly {
  const f: Fly = {
    id: w.nextId++,
    x: rng.range(FIELD.x0, FIELD.x1),
    y: rng.range(FIELD.y0, FIELD.y1),
    vx: 0,
    vy: 0,
    golden,
    turn: 0,
    held: -1,
  }
  heading(f, rng)
  w.flies.push(f)
  return f
}

export function worldNew(rng: Rng): World {
  const w: World = { flies: [], nextId: 1, spawn: 0, frogs: [frogNew(), frogNew()] }
  for (let i = 0; i < FLY_COUNT; i++) spawnFly(w, rng)
  return w
}

/** Buzz the free flies around: new headings now and then, bounce off the band's edges. */
export function stepFlies(w: World, dt: number, rng: Rng, frenzy = false): void {
  for (const f of w.flies) {
    if (f.held >= 0) continue
    f.turn -= dt
    if (f.turn <= 0) heading(f, rng, frenzy)
    f.x += f.vx * dt
    f.y += f.vy * dt
    if (f.x < FIELD.x0) {
      f.x = FIELD.x0
      f.vx = Math.abs(f.vx)
    } else if (f.x > FIELD.x1) {
      f.x = FIELD.x1
      f.vx = -Math.abs(f.vx)
    }
    if (f.y < FIELD.y0) {
      f.y = FIELD.y0
      f.vy = Math.abs(f.vy)
    } else if (f.y > FIELD.y1) {
      f.y = FIELD.y1
      f.vy = -Math.abs(f.vy)
    }
  }
}

/** Tongue out speed for a flick whose finger moved at `v` units/s. */
export function flickSpeed(v: number): number {
  const k = Math.max(0, Math.min(1, v / FLICK_FULL))
  return OUT_SPEED * 0.85 + (FLICK_MAX - OUT_SPEED * 0.85) * k
}

/** Fire a tongue at (tx, ty). Returns false when the tongue is still busy or the aim is too short. */
export function fire(
  f: Frog,
  side: Side,
  tx: number,
  ty: number,
  now: number,
  speed = OUT_SPEED,
): boolean {
  const t = f.tongue
  if (t.phase !== 'idle') return false
  const m = mouth(side)
  const dx = tx - m.x
  const dy = ty - m.y
  const d = Math.hypot(dx, dy)
  if (d < MIN_REACH) return false
  t.phase = 'out'
  t.len = 0
  t.reach = REACH
  t.dx = dx / d
  t.dy = dy / d
  t.hold = 0
  t.speed = speed
  t.fly = -1
  f.shotAt = now
  return true
}

/** Hook `fly` on a side's tongue: it turns around with it. */
function hook(w: World, side: Side, fly: Fly, now: number, out: FieldEvent[]): void {
  const f = w.frogs[side]
  const t = f.tongue
  fly.held = side
  t.fly = fly.id
  t.phase = 'back'
  f.score += fly.golden ? POINTS.golden : POINTS.plain
  f.caught++
  f.catchAt = now
  out.push({ kind: 'catch', side, x: fly.x, y: fly.y, golden: fly.golden })
}

/**
 * Tips that touch free flies catch them. When both tongues reach the same fly
 * on the same step, the tip nearer to it wins (not whoever is checked first).
 */
function touches(w: World, now: number, out: FieldEvent[]): void {
  const tips: (Vec | null)[] = ([0, 1] as Side[]).map((side) => {
    const t = w.frogs[side].tongue
    return t.phase !== 'idle' && t.fly < 0 ? tipOf(side, t) : null
  })
  if (!tips[0] && !tips[1]) return
  const reach = FLY_R + TIP_R
  // Each tongue takes the nearest fly it touches.
  const best: [Fly | null, Fly | null] = [null, null]
  const bestD: [number, number] = [Infinity, Infinity]
  for (const fly of w.flies) {
    if (fly.held >= 0) continue
    for (const side of [0, 1] as Side[]) {
      const tip = tips[side]
      if (!tip) continue
      const d = Math.hypot(fly.x - tip.x, fly.y - tip.y)
      if (d <= reach && d < bestD[side]) {
        bestD[side] = d
        best[side] = fly
      }
    }
  }
  const [a, b] = best
  if (a && a === b) {
    // Both on the same fly: the nearer tip has it; a dead heat is settled by the fly, not by side.
    const win: Side = bestD[1] < bestD[0] ? 1 : bestD[0] < bestD[1] ? 0 : ((a.id % 2) as Side)
    hook(w, win, a, now, out)
    return
  }
  if (a) hook(w, 0, a, now, out)
  if (b) hook(w, 1, b, now, out)
}

/** Move a tongue along its shot (out, hold, back), carrying what it holds. */
function moveTongue(w: World, side: Side, dt: number): void {
  const t = w.frogs[side].tongue
  if (t.phase === 'idle') return
  if (t.phase === 'out') {
    t.len = Math.min(t.reach, t.len + t.speed * dt)
    if (t.len >= t.reach) {
      t.phase = 'hold'
      t.hold = HOLD
    }
  } else if (t.phase === 'hold') {
    t.hold -= dt
    if (t.hold <= 0) t.phase = 'back'
  } else {
    t.len -= BACK_SPEED * dt
  }
}

/** Keep a held fly on the tip; swallow (or come home empty) when the tongue is back. */
function settle(w: World, side: Side, now: number, out: FieldEvent[]): void {
  const f = w.frogs[side]
  const t = f.tongue
  if (t.phase === 'idle') return
  const held = t.fly >= 0 ? w.flies.find((x) => x.id === t.fly) : undefined
  if (held) {
    const tip = tipOf(side, t)
    held.x = tip.x
    held.y = tip.y
  }
  if (t.phase === 'back' && t.len <= 0) {
    const m = mouth(side)
    if (held) {
      w.flies = w.flies.filter((x) => x.id !== held.id)
      f.eatAt = now
      out.push({ kind: 'eat', side, x: m.x, y: m.y, golden: held.golden })
    } else {
      out.push({ kind: 'miss', side, x: m.x, y: m.y })
    }
    t.phase = 'idle'
    t.len = 0
    t.fly = -1
  }
}

/** One fixed step of the whole field: taps queued by players and bots fire, tongues move, flies respawn. */
export function stepWorld(
  w: World,
  dt: number,
  rng: Rng,
  now: number,
  /** The last seconds of the match: more, faster and more golden flies. */
  frenzy = false,
): FieldEvent[] {
  const out: FieldEvent[] = []
  stepFlies(w, dt, rng, frenzy)
  for (const side of [0, 1] as Side[]) {
    const f = w.frogs[side]
    if (f.queue && now - f.queue.t > QUEUE_TIME) f.queue = null
    const q = f.queue
    if (q && f.tongue.phase === 'idle' && fire(f, side, q.x, q.y, now, q.speed)) {
      f.queue = null
      const m = mouth(side)
      out.push({ kind: 'shot', side, x: m.x, y: m.y })
    }
    moveTongue(w, side, dt)
  }
  touches(w, now, out)
  for (const side of [0, 1] as Side[]) settle(w, side, now, out)
  if (w.flies.length < FLY_COUNT + (frenzy ? FRENZY_EXTRA : 0)) {
    w.spawn -= dt
    if (w.spawn <= 0) {
      spawnFly(w, rng, rng.chance(frenzy ? FRENZY_GOLD : GOLDEN_CHANCE))
      w.spawn = frenzy ? rng.range(0.25, 0.5) : rng.range(0.5, 1.0)
    }
  }
  return out
}

/** After the buzzer: tongues reel home (whatever they hold is swallowed), no new shots. */
export function reelIn(w: World, dt: number): void {
  for (const side of [0, 1] as Side[]) {
    const t = w.frogs[side].tongue
    if (t.phase === 'idle') continue
    t.phase = 'back'
    t.len = Math.max(0, t.len - BACK_SPEED * dt)
    const held = t.fly >= 0 ? w.flies.find((x) => x.id === t.fly) : undefined
    if (held) {
      const tip = tipOf(side, t)
      held.x = tip.x
      held.y = tip.y
    }
    if (t.len <= 0) {
      if (held) w.flies = w.flies.filter((x) => x.id !== held.id)
      t.phase = 'idle'
      t.fly = -1
    }
  }
}

/** Scores red first. */
export const scoresOf = (w: World): [number, number] => [w.frogs[0].score, w.frogs[1].score]

/** The winner by points, or 'draw' on a tie. */
export function winnerOf(w: World): Side | 'draw' {
  const [a, b] = scoresOf(w)
  if (a === b) return 'draw'
  return a > b ? 0 : 1
}

/** Seconds left on the clock of a match lasting `total` seconds. */
export const timeLeft = (now: number, total = GAME_TIME): number => Math.max(0, total - now)
