import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { collideDynamic, type Disc, integrate } from '../../engines/puck/index.ts'

/**
 * Spin War: spinning tops in a round bowl. Drag in your half and your top
 * steers toward the finger. The bowl is concave (a gentle pull to the centre),
 * tops knock each other back in proportion to their spin, and spin drains over
 * time and on every hit. A top that leaves the bowl, or runs out of spin, is
 * out; a side with no tops left loses the round. Best of N rounds. Pure: no DOM,
 * no Math.random.
 */

export const BOWL = { x: W / 2, y: MID, r: 440 }
export const TOP_R = 58
const DRAG = 0.55
/** Concave bowl: acceleration toward the centre, per unit of distance. */
const BOWL_K = 0.6
const STEER_SPEED = 900
const STEER_GAIN = 5
const STEER_RATE = 7
const SPIN_DECAY = 0.04
const SPIN_HIT = 0.05
/** Seconds a round can run; at the limit the side with more spin wins it. */
export const ROUND_LIMIT = 50
/** Steering speed, exported so a stick can map full deflection to full speed. */
export const STEER_REACH = 180
/** Seconds the result banner shows between rounds. */
export const OVER_TIME = 2
const E = 0.75
const SUB = 3
/** A contact slower than this is a nudge, not a clash. */
const CLASH_MIN = 120
/** Clash knockback: a base shove plus a share of the closing speed, scaled by the rival's spin. */
const KNOCK_BASE = 200
const KNOCK_SPEED = 0.42
/** Seconds a top reels (cannot steer) after a clash. */
const RECOIL = 0.32
/** Dash: a flick of the stick hurls the top; cooldown, launch speed range, spin it costs. */
export const DASH_CD = 1
export const DASH_V0 = 650
export const DASH_V1 = 1500
const DASH_SPIN = 0.04
/** The bowl's rim closes in as a round drags on: from BOWL.r to SHRINK of it between these times. */
export const SHRINK = 0.74
export const SHRINK_START = 18
export const SHRINK_END = 42

/** Radius of the bowl's live area at round time `t` (tops beyond it fall out). */
export function rimAt(t: number): number {
  const k = Math.max(0, Math.min(1, (t - SHRINK_START) / (SHRINK_END - SHRINK_START)))
  return BOWL.r * (1 - (1 - SHRINK) * k * k * (3 - 2 * k))
}

export interface Top extends Disc {
  side: Side
  /** Teams: which lane (left 0 / right 1) steers this top. */
  lane: 0 | 1
  /** 0..1, drains over time and on hits. 0 = stopped = out. */
  spin: number
  /** Out of the round: left the bowl or stopped. */
  out: boolean
  /** Visual rotation (cosmetic, but deterministic from the seeded start). */
  ang: number
  /** Seconds left reeling from a clash: no steering, so the tops fly apart. */
  recoil: number
  /** Seconds before this top can dash again. */
  dash: number
}

export interface World {
  tops: Top[]
  /** Round time in seconds. */
  t: number
  round: number
  wins: [number, number]
  target: number
  phase: 'play' | 'over'
  /** Seconds left on the result banner. */
  timer: number
  /** Result of the round just decided: a side, 'draw', or null while playing. */
  result: Side | 'draw' | null
  teams: boolean
}

export type Event =
  | { kind: 'hit'; x: number; y: number; speed: number }
  | { kind: 'out'; side: Side; x: number; y: number; reason: 'bowl' | 'stopped' }
  | { kind: 'round'; winner: Side | 'draw' }
  | { kind: 'dash'; side: Side; x: number; y: number; power: number }

/**
 * Where each top is steered this step (world), or null to coast. Indices match
 * `w.tops`. `dash` (0..1) asks for a dash toward the target, as hard as given.
 */
export type Targets = ({ x: number; y: number; dash?: number } | null)[]

function startTops(teams: boolean, rng: Rng): Top[] {
  const xs = teams ? [W * 0.33, W * 0.67] : [W / 2]
  const tops: Top[] = []
  for (const side of [0, 1] as Side[]) {
    xs.forEach((x, lane) => {
      tops.push({
        x,
        y: side === 0 ? MID + 420 : MID - 420,
        vx: 0,
        vy: 0,
        r: TOP_R,
        side,
        lane: (teams ? lane : 0) as 0 | 1,
        // Launch spin varies a little, so two equal tops never stop on the same frame.
        spin: rng.range(0.85, 1),
        out: false,
        ang: 0,
        recoil: 0,
        dash: 0,
      })
    })
  }
  return tops
}

export function newWorld(teams: boolean, target: number, rng: Rng): World {
  return {
    tops: startTops(teams, rng),
    t: 0,
    round: 1,
    wins: [0, 0],
    target,
    phase: 'play',
    timer: 0,
    result: null,
    teams,
  }
}

/** Reset the tops for the next round. */
export function startRound(w: World, rng: Rng): void {
  w.tops = startTops(w.teams, rng)
  w.round++
  w.t = 0
  w.phase = 'play'
  w.result = null
  w.timer = 0
}

/** The side that has won the match, once someone reaches the target. */
export function matchWinner(w: World): Side | null {
  if (w.wins[0] >= w.target) return 0
  if (w.wins[1] >= w.target) return 1
  return null
}

const alive = (w: World, side: Side): number =>
  w.tops.filter((t) => t.side === side && !t.out).length

/** Advance one step. `targets[i]` steers `w.tops[i]` (null = just coast). */
export function step(w: World, dt: number, targets: Targets, rng: Rng): Event[] {
  const events: Event[] = []
  if (w.phase === 'over') {
    w.timer -= dt
    for (const t of w.tops) moveTop(t, null, dt, true)
    if (w.timer <= 0 && matchWinner(w) === null) startRound(w, rng)
    return events
  }
  w.t += dt
  // Dashes: a flick hurls a ready top toward its target, at a little spin.
  w.tops.forEach((t, i) => {
    t.dash = Math.max(0, (t.dash ?? 0) - dt)
    const g = targets[i]
    const p = g?.dash ?? 0
    if (t.out || !g || p <= 0 || t.dash > 0 || t.recoil > 0) return
    const dx = g.x - t.x
    const dy = g.y - t.y
    const d = Math.hypot(dx, dy)
    if (d < 1) return
    const power = Math.min(1, p)
    const v = DASH_V0 + (DASH_V1 - DASH_V0) * power
    t.vx = (dx / d) * v
    t.vy = (dy / d) * v
    t.spin = Math.max(0.01, t.spin - DASH_SPIN * power)
    t.dash = DASH_CD
    events.push({ kind: 'dash', side: t.side, x: t.x, y: t.y, power })
  })
  const h = dt / SUB
  for (let s = 0; s < SUB; s++) {
    w.tops.forEach((t, i) => {
      if (t.out) return
      moveTop(t, t.recoil > 0 ? null : (targets[i] ?? null), h, false)
    })
    for (let i = 0; i < w.tops.length; i++) {
      for (let j = i + 1; j < w.tops.length; j++) {
        const a = w.tops[i]
        const b = w.tops[j]
        if (!a || !b || a.out || b.out) continue
        const ma = 1 + a.spin
        const mb = 1 + b.spin
        const c = collideDynamic(a, b, ma, mb, E)
        if (c && c.speed > CLASH_MIN) {
          events.push({ kind: 'hit', x: c.x, y: c.y, speed: c.speed })
          // Spin-based knockback: the faster-spinning top throws the other one further.
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.hypot(dx, dy) || 1
          const push = KNOCK_BASE + c.speed * KNOCK_SPEED
          const ka = push * (0.4 + b.spin) * (mb / (ma + mb))
          const kb = push * (0.4 + a.spin) * (ma / (ma + mb))
          a.vx -= (dx / d) * ka
          a.vy -= (dy / d) * ka
          b.vx += (dx / d) * kb
          b.vy += (dy / d) * kb
          a.recoil = RECOIL
          b.recoil = RECOIL
          // The lighter (less spun-up) top loses more spin in a knock.
          const k = SPIN_HIT * Math.min(1, c.speed / 1200) * 2
          a.spin = Math.max(0, a.spin - k * (mb / (ma + mb)))
          b.spin = Math.max(0, b.spin - k * (ma / (ma + mb)))
        }
      }
    }
  }
  for (const t of w.tops) {
    if (t.out) continue
    t.recoil = Math.max(0, t.recoil - dt)
    t.spin = Math.max(0, t.spin - SPIN_DECAY * dt)
    if (Math.hypot(t.x - BOWL.x, t.y - BOWL.y) > rimAt(w.t) + TOP_R * 0.5) {
      t.out = true
      events.push({ kind: 'out', side: t.side, x: t.x, y: t.y, reason: 'bowl' })
    } else if (t.spin <= 0) {
      t.out = true
      events.push({ kind: 'out', side: t.side, x: t.x, y: t.y, reason: 'stopped' })
    }
  }

  // Round decided?
  const redOut = alive(w, 0) === 0
  const blueOut = alive(w, 1) === 0
  let result: Side | 'draw' | null = null
  if (redOut && blueOut) result = 'draw'
  else if (redOut) result = 1
  else if (blueOut) result = 0
  else if (w.t >= ROUND_LIMIT) {
    const red = sumSpin(w, 0)
    const blue = sumSpin(w, 1)
    result = red === blue ? 'draw' : red > blue ? 0 : 1
  }
  if (result !== null) {
    if (result !== 'draw') w.wins[result]++
    w.result = result
    w.phase = 'over'
    w.timer = OVER_TIME
    events.push({ kind: 'round', winner: result })
  }
  return events
}

const sumSpin = (w: World, side: Side): number =>
  w.tops.reduce((s, t) => s + (t.side === side && !t.out ? t.spin : 0), 0)

/** Steer toward the target, bowl pull, drag, then move. */
function moveTop(t: Top, target: { x: number; y: number } | null, dt: number, idle: boolean): void {
  if (!idle && target) {
    const dx = target.x - t.x
    const dy = target.y - t.y
    const d = Math.hypot(dx, dy)
    const want = Math.min(STEER_SPEED, d * STEER_GAIN)
    const wx = d > 1e-6 ? (dx / d) * want : 0
    const wy = d > 1e-6 ? (dy / d) * want : 0
    const k = Math.min(1, STEER_RATE * dt)
    t.vx += (wx - t.vx) * k
    t.vy += (wy - t.vy) * k
  }
  if (!idle) {
    t.vx -= BOWL_K * (t.x - BOWL.x) * dt
    t.vy -= BOWL_K * (t.y - BOWL.y) * dt
  }
  integrate(t, dt, DRAG)
  t.ang += (4 + t.spin * 18) * dt
}
