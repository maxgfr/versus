import { type Difficulty, other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  attackDir,
  BALL_R,
  ballPath,
  capped,
  CENTRE_X,
  CHARGE_TIME,
  closingSpeed,
  GRAV,
  HOP_V,
  hopX,
  kickOutcome,
  kickPower,
  kickVelocity,
  LEAD_STEPS,
  onOwnHalf,
  PITCH,
  STAND_Y,
} from './rules.ts'

/**
 * The computer player. It sees what a human sees: where the ball is, how it is
 * moving and how heated the match is. It plays by the same rules (hop, wind-up,
 * cooldown) and only differs in how quickly it reacts, how well it reads the
 * ball's flight and how carefully it picks its kick.
 */

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
  /** The match's heat 0..1 (kicks fly faster), shown to everyone by the ball's glow. */
  heat?: number
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
  /** Range of the wind-up it holds for when it does not plan the kick through. */
  charge: [number, number]
  /** Gap to the ball's resting spot beyond which it hops over to it. */
  approach: number
  /** Kicks anywhere it can reach (false: only around its own half). */
  pressing: boolean
  /** Aim offsets it tries, in units along the attack direction. */
  aims: readonly number[]
  /**
   * Wind-ups it weighs, following each kick's flight to see where it ends up
   * (in the net, off the bar, deep in the rival's half). Empty: no planning,
   * the first forward-ish touch will do.
   */
  plan: readonly number[]
  /** Drift from its guard spot (between the ball and its own goal) before it hops back; 0 = never. */
  guard: number
}

const TUNE: Record<Difficulty, Tune> = {
  // Welcoming: slow to react, misreads moving balls, fumbles, pokes the ball anywhere.
  easy: {
    react: [0.5, 0.95],
    foresight: 0.2,
    forward: -99,
    whiff: 0.35,
    charge: [0.05, 0.45],
    approach: 330,
    pressing: false,
    aims: [0],
    plan: [],
    guard: 0,
  },
  // A real challenge: quick, reads the flight, picks the kick that goes furthest.
  normal: {
    react: [0.13, 0.24],
    foresight: 1,
    forward: 0,
    whiff: 0.04,
    charge: [0.4, 0.8],
    approach: 240,
    pressing: true,
    aims: [0, -45, 45, -90],
    plan: [0.8, 0.4],
    guard: 280,
  },
  // Tough: fast reactions, never fumbles, searches aims and wind-ups for the kick that scores.
  hard: {
    react: [0.06, 0.12],
    foresight: 1,
    forward: 2,
    whiff: 0,
    charge: [0.8, 1],
    approach: 180,
    pressing: true,
    aims: [0, -30, 30, -60, 60, -100, 100],
    plan: [1, 0.65, 0.3],
    guard: 170,
  },
}

/** Contact distance between the ball's centre and the player's spine (torso to head). */
const TOUCH = BALL_R + 36

/** Steps of flight read ahead: a whole hop, from take-off to landing. */
const HORIZON = 96
/** Steps a kicked ball is followed to see where it ends up. */
const FOLLOW = 110

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

export interface Meet {
  step: number
  /** The hopper's torso centre and velocity at contact. */
  x: number
  y: number
  vx: number
  vy: number
  /** The ball's centre at contact. */
  bx: number
  by: number
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
): Meet | null {
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
    if (segDist2(bx, by, x, y + 40, x, y - 70) < TOUCH * TOUCH)
      return { step: i, x, y, vx, vy, bx, by }
    if (y >= STAND_Y && vy > 0) break
  }
  return null
}

/**
 * How good a kick is for `side`, following the ball after it: a goal is worth
 * the most (sooner is better), an own goal is ruled out, otherwise the deeper
 * into the rival's half the better.
 */
export function kickValue(
  side: Side,
  bx: number,
  by: number,
  vx: number,
  vy: number,
): { value: number; scores: boolean } {
  const out = kickOutcome(bx, by, vx, vy, FOLLOW)
  if (out.scorer === side) return { value: 1000 - out.step, scores: true }
  if (out.scorer === other(side)) return { value: -2000, scores: false }
  const deep = (out.x - CENTRE_X) * attackDir(side)
  return { value: deep - (out.bar ? 60 : 0), scores: false }
}

/** Where to wait when there is nothing to strike: between the ball and our own goal mouth. */
export function guardSpot(side: Side, ballX: number): number {
  const mouth = side === 0 ? PITCH.left + PITCH.goalD + 60 : PITCH.right - PITCH.goalD - 60
  return mouth + (ballX - mouth) * 0.45
}

/**
 * The best hop available right now, reading the ball's flight ahead with the
 * real hop and kick rules. A kick that meets the ball comes first (on normal
 * and hard, the one whose flight ends best, wind-up included); otherwise a hop
 * over to a ball settling out of reach on our side, or back to the guard spot.
 * Null = stay put.
 */
export function chance(v: BotView, d: Difficulty): Plan | null {
  const t = TUNE[d]
  const bv = v.bv ?? { x: 0, y: 0 }
  const heat = v.heat ?? 0
  const dir = attackDir(v.side)
  const fvx = bv.x * t.foresight
  const fvy = bv.y * t.foresight
  ballPath(v.ball.x, v.ball.y, fvx, fvy, HORIZON, path)
  const leadX = path[(LEAD_STEPS - 1) * 2] as number
  let best: Plan | null = null
  let bestValue = -Infinity
  for (const off of t.aims) {
    const aimX = leadX + off * dir
    const hit = hopMeets(v.me, aimX, path, HORIZON)
    if (!hit) continue
    if (!t.pressing && !onOwnHalf(v.side, hit.bx - dir * 120)) continue
    const from = { x: hit.x, y: hit.y }
    const at = { x: hit.bx, y: hit.by }
    if (t.plan.length === 0) {
      const kick = kickVelocity(from, at, v.side, 0.5, heat)
      if (kick.x * dir < t.forward) continue
      if (-hit.step > bestValue) {
        bestValue = -hit.step
        best = { kind: 'kick', aimX, charge: 0 }
      }
      continue
    }
    // The ball's own velocity at contact, from the predicted path.
    const i = hit.step
    const pbx = i > 0 ? hit.bx - (path[(i - 1) * 2] as number) : fvx
    const pby = i > 0 ? hit.by - (path[(i - 1) * 2 + 1] as number) : fvy
    const closing = closingSpeed(from, { x: hit.vx, y: hit.vy }, at, { x: pbx, y: pby })
    for (const want of t.plan) {
      // The wind-up only grows until the contact.
      const held = Math.min(want, ((i + 1) / 60) * (1 / CHARGE_TIME))
      const kick = capped(kickVelocity(from, at, v.side, kickPower(held, closing), heat))
      if (kick.x * dir < t.forward) continue
      const value = kickValue(v.side, hit.bx, hit.by, kick.x, kick.y).value - i * 3
      if (value > bestValue) {
        bestValue = value
        best = { kind: 'kick', aimX, charge: want }
      }
    }
  }
  // Never play a kick that ends in our own net or back on our own goal line.
  if (best && bestValue > -400) return best
  // Nothing to strike: is the ball settling on our side, out of reach?
  const end = path[(HORIZON - 1) * 2] as number
  const coming = bv.x * dir < -4
  if ((onOwnHalf(v.side, end) || coming) && Math.abs(end - v.me.x) > t.approach) {
    // Land a little behind it, between the ball and our own goal.
    return { kind: 'move', aimX: end - dir * 90, charge: 0 }
  }
  // The ball is up the other end: drop back to guard our goal.
  if (t.guard > 0) {
    const gx = guardSpot(v.side, end)
    if (Math.abs(gx - v.me.x) > t.guard) return { kind: 'move', aimX: gx, charge: 0 }
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
  if (plan.kind === 'move') plan.charge = 0
  else if (t.plan.length === 0) plan.charge = rng.range(t.charge[0], t.charge[1])
  return plan
}
