import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  attackDir,
  BALL_R,
  ballPath,
  GRAV,
  HOP_V,
  hopX,
  kickVelocity,
  LEAD_STEPS,
  onOwnHalf,
  STAND_Y,
} from './rules.ts'

/** What the computer can see of the game when it decides whether to hop. */
export interface BotView {
  side: Side
  ball: { x: number; y: number }
  /** Ball velocity per step (0 when unknown). */
  bv?: { x: number; y: number }
  me: { x: number; y: number }
  /** May this player hop now (on the grass, or perched still)? */
  standing?: boolean
  /** Seconds left before this player may hop again. */
  cool: number
  time: number
}

/** Per-side memory of the computer: when it may react to the chance it is watching. */
export interface BotMind {
  /** Game time the reaction fires; -1 while there is nothing to react to. */
  armed: number
}

export const newMind = (): BotMind => ({ armed: -1 })

/** A hop the computer wants: where to aim and how long to hold for power (0..1). */
export interface Plan {
  kind: 'kick' | 'move'
  aimX: number
  charge: number
}

interface Tune {
  /** Reaction time range, seconds. */
  react: [number, number]
  /** How much of the ball's motion it reads (0 = sees it frozen where it is, 1 = exact). */
  foresight: number
  /** Least forward speed (per step, toward the attacked goal) a kick must give; -99 = any. */
  forward: number
  /** Chance a reaction is fumbled and has to be taken again. */
  whiff: number
  /** Range of the wind-up it holds for. */
  charge: [number, number]
  /** Gap to the ball's resting spot beyond which it hops over to it. */
  approach: number
  /** Kicks only in reach of its own half (easy / normal keep their shape). */
  pressing: boolean
  /** Aim offsets it tries, in units along the attack direction. */
  aims: readonly number[]
}

const TUNE: Record<Difficulty, Tune> = {
  easy: {
    react: [0.5, 0.95],
    foresight: 0.2,
    forward: -99,
    whiff: 0.35,
    charge: [0.05, 0.45],
    approach: 330,
    pressing: false,
    aims: [0],
  },
  normal: {
    react: [0.16, 0.3],
    foresight: 0.9,
    forward: 2,
    whiff: 0.05,
    charge: [0.3, 0.8],
    approach: 260,
    pressing: true,
    aims: [0, -45, 45],
  },
  hard: {
    react: [0.08, 0.18],
    foresight: 1,
    forward: 6,
    whiff: 0,
    charge: [0.75, 1],
    approach: 200,
    pressing: true,
    aims: [0, -45, 45, -90],
  },
}

/** Contact distance between the ball's centre and the player's spine (torso to head). */
const TOUCH = BALL_R + 36

/** Steps of flight read ahead: a whole hop, from take-off to landing. */
const HORIZON = 96

const path: number[] = []

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l = dx * dx + dy * dy
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l))
  const qx = ax + dx * t - px
  const qy = ay + dy * t - py
  return qx * qx + qy * qy
}

/**
 * Fly a hop aimed at `aimX` against the predicted ball path (`n` steps in
 * `path`). Returns the first step the two meet and where, or null.
 */
export function hopMeets(
  me: { x: number; y: number },
  aimX: number,
  pts: readonly number[],
  n: number,
): { step: number; x: number; y: number; bx: number; by: number } | null {
  let x = me.x
  let y = me.y
  let vx = hopX(me.x, aimX)
  let vy = -HOP_V
  for (let i = 0; i < n; i++) {
    vx *= 0.99
    vy = vy * 0.99 + GRAV
    x += vx
    y = Math.min(STAND_Y, y + vy)
    const bx = pts[i * 2] as number
    const by = pts[i * 2 + 1] as number
    // Spine: from the bottom of the torso to the head's centre.
    if (segDist2(bx, by, x, y + 40, x, y - 70) < TOUCH * TOUCH) return { step: i, x, y, bx, by }
    if (y >= STAND_Y && vy > 0) break
  }
  return null
}

/**
 * The best hop available right now, reading the ball's flight ahead with the
 * real hop and kick rules. A kick that meets the ball and sends it forward
 * comes first; otherwise, if the ball is coming to rest on our side out of
 * reach, a hop over to it (landing goal-side of it). Null = stay put.
 */
export function chance(v: BotView, d: Difficulty): Plan | null {
  const t = TUNE[d]
  const bv = v.bv ?? { x: 0, y: 0 }
  const dir = attackDir(v.side)
  ballPath(v.ball.x, v.ball.y, bv.x * t.foresight, bv.y * t.foresight, HORIZON, path)
  const lead = LEAD_STEPS - 1
  const leadX = path[lead * 2] as number
  let best: { step: number; aimX: number } | null = null
  for (const off of t.aims) {
    const aimX = leadX + off * dir
    const hit = hopMeets(v.me, aimX, path, HORIZON)
    if (!hit) continue
    if (!t.pressing && !onOwnHalf(v.side, hit.bx - dir * 120)) continue
    const kick = kickVelocity({ x: hit.x, y: hit.y }, { x: hit.bx, y: hit.by }, v.side)
    if (kick.x * dir < t.forward) continue
    if (!best || hit.step < best.step) best = { step: hit.step, aimX }
  }
  if (best) return { kind: 'kick', aimX: best.aimX, charge: 0 }
  // Nothing to strike: is the ball settling on our side, out of reach?
  const end = path[(HORIZON - 1) * 2] as number
  const coming = bv.x * dir < -4
  if ((onOwnHalf(v.side, end) || coming) && Math.abs(end - v.me.x) > t.approach) {
    // Land a little behind it, between the ball and our own goal.
    return { kind: 'move', aimX: end - dir * 90, charge: 0 }
  }
  return null
}

/**
 * Should this computer player hop now, and how? It watches for a chance (see
 * `chance`) and takes it after a difficulty-dependent reaction time if it is
 * still there; easy players sometimes fumble and look again. Returns the plan
 * with the wind-up to hold, or null.
 */
export function botHop(v: BotView, d: Difficulty, rng: Rng, mind: BotMind): Plan | null {
  if (v.cool > 0 || v.standing === false) {
    mind.armed = -1
    return null
  }
  const plan = chance(v, d)
  if (!plan) {
    mind.armed = -1
    return null
  }
  const t = TUNE[d]
  if (mind.armed < 0) mind.armed = v.time + rng.range(t.react[0], t.react[1])
  if (v.time < mind.armed) return null
  if (rng.chance(t.whiff)) {
    mind.armed = v.time + rng.range(0.4, 0.8)
    return null
  }
  mind.armed = -1
  plan.charge = plan.kind === 'kick' ? rng.range(t.charge[0], t.charge[1]) : 0
  return plan
}
