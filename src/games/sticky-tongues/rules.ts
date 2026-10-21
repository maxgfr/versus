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
  /** Id of the fly on the tip, -1 when none. */
  fly: number
}

export interface Frog {
  tongue: Tongue
  /** The last tap, kept for QUEUE_TIME so a tap during a retract still fires. */
  queue: { x: number; y: number; t: number } | null
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

function heading(f: Fly, rng: Rng): void {
  const a = rng.range(0, Math.PI * 2)
  const sp = f.golden ? GOLD_SPEED : FLY_SPEED
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
export function stepFlies(w: World, dt: number, rng: Rng): void {
  for (const f of w.flies) {
    if (f.held >= 0) continue
    f.turn -= dt
    if (f.turn <= 0) heading(f, rng)
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

/** Fire a tongue at (tx, ty). Returns false when the tongue is still busy or the aim is too short. */
export function fire(f: Frog, side: Side, tx: number, ty: number, now: number): boolean {
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
  t.fly = -1
  f.shotAt = now
  return true
}

/** Catch the first free fly the tip touches. The tongue turns around with it. */
function touch(w: World, side: Side, f: Frog, now: number, out: FieldEvent[]): void {
  const t = f.tongue
  const tip = tipOf(side, t)
  for (const fly of w.flies) {
    if (fly.held >= 0) continue
    if (Math.hypot(fly.x - tip.x, fly.y - tip.y) > FLY_R + TIP_R) continue
    fly.held = side
    t.fly = fly.id
    t.phase = 'back'
    f.score += fly.golden ? POINTS.golden : POINTS.plain
    f.caught++
    f.catchAt = now
    out.push({ kind: 'catch', side, x: fly.x, y: fly.y, golden: fly.golden })
    return
  }
}

function stepTongue(w: World, side: Side, dt: number, now: number, out: FieldEvent[]): void {
  const f = w.frogs[side]
  const t = f.tongue
  if (t.phase === 'idle') return
  if (t.phase === 'out') {
    t.len = Math.min(t.reach, t.len + OUT_SPEED * dt)
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
  if (t.fly < 0) touch(w, side, f, now, out)
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
export function stepWorld(w: World, dt: number, rng: Rng, now: number): FieldEvent[] {
  const out: FieldEvent[] = []
  stepFlies(w, dt, rng)
  for (const side of [0, 1] as Side[]) {
    const f = w.frogs[side]
    if (f.queue && now - f.queue.t > QUEUE_TIME) f.queue = null
    const q = f.queue
    if (q && f.tongue.phase === 'idle' && fire(f, side, q.x, q.y, now)) {
      f.queue = null
      const m = mouth(side)
      out.push({ kind: 'shot', side, x: m.x, y: m.y })
    }
    stepTongue(w, side, dt, now, out)
  }
  if (w.flies.length < FLY_COUNT) {
    w.spawn -= dt
    if (w.spawn <= 0) {
      spawnFly(w, rng)
      w.spawn = rng.range(0.5, 1.0)
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
