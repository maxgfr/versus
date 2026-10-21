import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { BALL_R, nearestDisc, PLAYER_R, RINK, type World } from './rules.ts'

interface Tuning {
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Error on the flick direction, in radians. */
  noise: number
  /** Flick power. */
  power: number
  /** Chance of not bothering to drop a defender back. */
  lazy: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.5, noise: 0.35, power: 0.6, lazy: 0.75 },
  normal: { react: 0.28, noise: 0.14, power: 0.8, lazy: 0.45 },
  hard: { react: 0.12, noise: 0.03, power: 0.95, lazy: 0.2 },
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

/**
 * The bot flicks the disc nearest the ball, aiming to hit the ball along the
 * line from the ball to the rival goal (from behind the ball). Decisions come
 * every `react` seconds; returns null when no disc is ready.
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
  const p = w.players[i]
  if (!p) return null
  // The other disc drops back in front of our goal while the ball is in our half.
  const guard = guardPlan(w, side, indices, i, d, rng)
  if (guard) return guard
  // Attack the rival goal: the contact point sits just behind the ball, toward it.
  const goalY = side === 0 ? RINK.y0 : RINK.y1
  const gx = W / 2 - w.ball.x
  const gy = goalY - w.ball.y
  const gm = Math.hypot(gx, gy) || 1
  const reach = (PLAYER_R + BALL_R) * 0.8
  const cx = w.ball.x - (gx / gm) * reach
  const cy = w.ball.y - (gy / gm) * reach
  let dx = cx - p.x
  let dy = cy - p.y
  const m = Math.hypot(dx, dy) || 1
  dx /= m
  dy /= m
  const a = (rng.next() * 2 - 1) * tune.noise
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const rx = dx * ca - dy * sa
  const ry = dx * sa + dy * ca
  return {
    index: i,
    dx: rx,
    dy: ry,
    power: Math.max(0.1, Math.min(1, tune.power + (rng.next() - 0.5) * 0.1)),
  }
}
