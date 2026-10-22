import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { BALL_R, type Cmd, nearestDisc, PLAYER_R, RINK, step, type World } from './rules.ts'

interface Tuning {
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Error on the flick direction, in radians. */
  noise: number
  /** Flick power (the plain, non-searching aim). */
  power: number
  /** Chance of not bothering to drop a defender back. */
  lazy: number
  /**
   * Look-ahead: how many directions either side of the plain aim the bot tries
   * by playing each flick forward with the real rules (0 = no search), and the
   * powers it tries for each.
   */
  fan: number
  powers: readonly number[]
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.55, noise: 0.32, power: 0.6, lazy: 0.75, fan: 0, powers: [] },
  normal: { react: 0.24, noise: 0.08, power: 0.8, lazy: 0.35, fan: 2, powers: [0.75, 1] },
  hard: { react: 0.14, noise: 0.02, power: 0.95, lazy: 0.1, fan: 4, powers: [0.6, 0.85, 1] },
}

/** Per-bot memory carried between steps (not part of the synced state). */
export interface BotMemory {
  wait: number
}

export const newMemory = (): BotMemory => ({ wait: 0 })

export interface Plan {
  /** Index into `w.players` of the disc to flick. */
  index: number
  dx: number
  dy: number
  power: number
}

/** Distance a flick at full power slides before the grass stops it. */
const SLIDE = 860
/** How far ahead (s) the bot plays each candidate flick. */
const HORIZON = 0.8
/** Angle between two tried directions (radians). */
const FAN_STEP = 0.22

/**
 * A guard flick: when the ball is in our half, the disc that is not chasing it
 * slides back to a spot in front of our goal (if it strayed far from it).
 */
function guardPlan(
  w: World,
  side: Side,
  indices: readonly number[],
  attacker: number,
  d: Difficulty,
  rng: Rng,
): Plan | null {
  const own = side === 0 ? RINK.y1 : RINK.y0
  const inOurHalf = side === 0 ? w.ball.y > MID : w.ball.y < MID
  if (!inOurHalf || rng.next() < TUNING[d].lazy) return null
  const k = indices.find((j) => j !== attacker && (w.cool[j] ?? 0) <= 0)
  if (k === undefined) return null
  const p = w.players[k]
  if (!p) return null
  const gx = W / 2 + (w.ball.x - W / 2) * 0.3
  const gy = own + (side === 0 ? -1 : 1) * 250
  const dx = gx - p.x
  const dy = gy - p.y
  const dist = Math.hypot(dx, dy)
  if (dist < 170) return null
  return { index: k, dx: dx / dist, dy: dy / dist, power: Math.min(0.75, dist / SLIDE) }
}

/** A copy of the world the bot can play forward without touching the real one. */
function clone(w: World): World {
  return {
    ...w,
    ball: { ...w.ball },
    players: w.players.map((p) => ({ ...p })),
    cool: w.cool.slice(),
    score: [w.score[0], w.score[1]],
    aims: [null, null, null, null],
  }
}

/**
 * How good a position is for `side`: a goal decides it; otherwise the ball's
 * progress toward the rival goal (and how fast it is heading there), with a
 * penalty for a ball loose in front of our own goal.
 */
export function judge(w: World, side: Side, before: [number, number]): number {
  const mine = w.score[side] - before[side]
  const theirs = w.score[side === 0 ? 1 : 0] - before[side === 0 ? 1 : 0]
  if (mine > 0) return 10000
  if (theirs > 0) return -10000
  const b = w.ball
  const fwd = side === 0 ? -1 : 1
  const len = RINK.y1 - RINK.y0
  // 0 at our goal line, 1 at theirs.
  const progress = side === 0 ? (RINK.y1 - b.y) / len : (b.y - RINK.y0) / len
  const central = 1 - Math.min(1, Math.abs(b.x - W / 2) / (W / 2))
  const heading = (b.vy * fwd) / 1500
  let v = progress * 100 + heading * 25 + central * progress * 20
  // Danger: the ball close to our own mouth, worse when it is heading in.
  const ownY = side === 0 ? RINK.y1 : RINK.y0
  const near = 1 - Math.min(1, Math.abs(b.y - ownY) / 420)
  v -= near * (1 - Math.min(1, Math.abs(b.x - W / 2) / RINK.goal)) * 60
  return v
}

/** Play a flick (or none) forward for `HORIZON` seconds and judge the result. */
function tryFlick(w: World, side: Side, plan: Plan | null): number {
  const sim = clone(w)
  const before: [number, number] = [w.score[0], w.score[1]]
  const dt = 1 / 60
  const none: Cmd = { flicks: [] }
  const first: Cmd = plan ? { flicks: [plan] } : none
  for (let t = 0; t < HORIZON; t += dt) {
    step(sim, dt, t === 0 ? first : none)
    if (sim.phase !== 'play') break
  }
  return judge(sim, side, before)
}

/** The plain aim: straight at the spot just behind the ball, on its line to the rival goal. */
function plainAim(w: World, side: Side, i: number): { dx: number; dy: number } | null {
  const p = w.players[i]
  if (!p) return null
  const goalY = side === 0 ? RINK.y0 : RINK.y1
  // Lead a moving ball a little: where it will be as the disc arrives.
  const lead = Math.min(0.35, Math.hypot(w.ball.x - p.x, w.ball.y - p.y) / 2200)
  const bx = w.ball.x + w.ball.vx * lead
  const by = w.ball.y + w.ball.vy * lead
  const gx = W / 2 - bx
  const gy = goalY - by
  const gm = Math.hypot(gx, gy) || 1
  const reach = (PLAYER_R + BALL_R) * 0.8
  const cx = bx - (gx / gm) * reach
  const cy = by - (gy / gm) * reach
  const dx = cx - p.x
  const dy = cy - p.y
  const m = Math.hypot(dx, dy) || 1
  return { dx: dx / m, dy: dy / m }
}

const turn = (dx: number, dy: number, a: number) => {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { dx: dx * c - dy * s, dy: dx * s + dy * c }
}

/**
 * The bot flicks the disc nearest the ball toward the spot behind it on its
 * line to the rival goal. Normal and hard bots look ahead: they fan out
 * directions and powers around that aim (for both ready discs), play each one
 * forward with the real rules and keep the best, and hold their flick when
 * nothing beats leaving things as they are. Decisions come every `react`
 * seconds; returns null when no disc is ready or holding is best.
 */
export function decide(
  w: World,
  side: Side,
  indices: readonly number[],
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Plan | null {
  const tune = TUNING[d]
  // The reaction lag counts from kick-off, not through the goal pause.
  if (w.phase !== 'play') {
    mem.wait = tune.react * 2
    return null
  }
  mem.wait -= dt
  if (mem.wait > 0) return null
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const ready = indices.filter((i) => (w.cool[i] ?? 0) <= 0)
  const i = nearestDisc(w, w.ball.x, w.ball.y, ready)
  if (i === null) return null
  // The other disc drops back in front of our goal while the ball is in our half.
  const guard = guardPlan(w, side, indices, i, d, rng)
  if (guard) return guard
  const jitter = (a: { dx: number; dy: number }) =>
    turn(a.dx, a.dy, (rng.next() * 2 - 1) * tune.noise)
  if (tune.fan === 0) {
    const a = plainAim(w, side, i)
    if (!a) return null
    const j = jitter(a)
    return {
      index: i,
      dx: j.dx,
      dy: j.dy,
      power: Math.max(0.1, Math.min(1, tune.power + (rng.next() - 0.5) * 0.1)),
    }
  }
  // Look-ahead search over both ready discs.
  let best: Plan | null = null
  let bestV = tryFlick(w, side, null) + 4
  for (const k of ready) {
    const a = plainAim(w, side, k)
    if (!a) continue
    for (let f = -tune.fan; f <= tune.fan; f++) {
      const dir = turn(a.dx, a.dy, f * FAN_STEP)
      for (const power of tune.powers) {
        const plan = { index: k, dx: dir.dx, dy: dir.dy, power }
        const v = tryFlick(w, side, plan)
        if (v > bestV) {
          bestV = v
          best = plan
        }
      }
    }
  }
  if (!best) return null
  const j = jitter(best)
  return { ...best, dx: j.dx, dy: j.dy }
}
