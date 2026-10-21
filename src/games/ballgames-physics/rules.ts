import type { Side } from '../../core/game.ts'
import { W } from '../../core/stage.ts'

/**
 * Pure rules for Ballgames Physics: the side-view pitch, the goals, the hop and
 * kick numbers. Physics itself lives in sim.ts; nothing here touches matter.
 *
 * The pitch is the middle band of the stage. Red (side 0) defends the left goal
 * and attacks the right one; blue (side 1) is the other way round.
 */

/** The pitch, in world units. */
export const PITCH = {
  /** Underside of the ceiling: the ball never leaves the band upwards. */
  ceil: 645,
  /** Grass surface: where feet stand. */
  ground: 1115,
  /** Bottom edge of the painted band (the band is centred on the stage). */
  bottom: 1285,
  /**
   * Back of each goal. The pitch stops short of the stage edges so the left
   * goal never sits under the pause button.
   */
  left: 110,
  right: W - 110,
  /** Depth of each goal box, measured in from its side edge. */
  goalD: 104,
  /** Height of the crossbar above the grass. */
  goalH: 250,
} as const

/** Top of the goal mouth: the ball must be below this to count. */
export const GOAL_TOP = PITCH.ground - PITCH.goalH
export const CENTRE_X = W / 2
export const BALL_R = 34
/** Torso: a chamfered block. Its bottom sits on the grass. */
export const BODY = { w: 66, h: 110, r: 26 } as const
export const HEAD_R = 38
/** Head centre sits this far above the torso centre (its bottom joins the neck). */
export const HEAD_DROP = 70
/** Where each player stands at kick-off: red on the left, blue on the right. */
export const HOME_X: readonly [number, number] = [300, 700]
/** Upward speed of a hop, in matter units per step. Apex ≈ 260 world units. */
export const HOP_V = 15
/** Largest sideways speed a hop can carry a player toward the ball. */
export const HOP_MAX_X = 7
/** Ball speed given by a connecting kick, per step. */
export const KICK_SPEED = 22
/**
 * Seconds a hop stays a kick: the whole airtime, so the landing is where the
 * ball gets hit. The leg swings forward over it and the body leans to the ball.
 */
export const KICK_TIME = 1.25
/** Seconds before the same player may hop again. */
export const COOLDOWN = 0.5
/** Seconds the net and the celebration play before kick-off is reset. */
export const GOAL_PAUSE = 1.6
/** Seconds the ball may lie almost still before it is put back to the centre spot. */
export const STALL_TIME = 5

/** The grass is level: a body whose bottom sits there is standing. */
export const STAND_Y = PITCH.ground - BODY.h / 2

/** Which side an attacking kick from `side` heads toward: red right, blue left. */
export const attackDir = (side: Side): number => (side === 0 ? 1 : -1)

/**
 * Which side scored, if the ball is inside a goal mouth. A goal belongs to the
 * side that defends it: the left goal is red's, so blue scores into it.
 */
export function goalBy(x: number, y: number): Side | null {
  if (y < GOAL_TOP) return null
  if (x < PITCH.left + PITCH.goalD) return 1
  if (x > PITCH.right - PITCH.goalD) return 0
  return null
}

/** Feet on the grass (a little slack for the chamfer and jitter). */
export function grounded(bodyY: number): boolean {
  return bodyY >= STAND_Y - 6
}

/**
 * Sideways speed of a hop toward the ball. A hop lasts about 70 steps, so this
 * carries the player most of the way to the ball's x by the time it lands.
 */
export function hopX(bodyX: number, ballX: number): number {
  const v = (ballX - bodyX) * 0.0129
  return Math.max(-HOP_MAX_X, Math.min(HOP_MAX_X, v))
}

/** Body lean (radians, positive tips the top to the right) toward the ball. */
export function leanFor(bodyX: number, ballX: number): number {
  return Math.max(-1, Math.min(1, (ballX - bodyX) / 220)) * 0.5
}

/**
 * Velocity a connecting kick gives the ball. It is aimed from the kicker
 * toward the ball, biased toward the goal the kicker attacks and up a little.
 */
export function kickVelocity(
  from: { x: number; y: number },
  ball: { x: number; y: number },
  side: Side,
): { x: number; y: number } {
  const dx = ball.x - from.x + attackDir(side) * 160
  const dy = ball.y - from.y - 110
  const m = Math.hypot(dx, dy) || 1
  return { x: (dx / m) * KICK_SPEED, y: (dy / m) * KICK_SPEED }
}

/** Where the ball is put for a kick-off: the centre spot, a little dropped and jittered by `jitter`. */
export function kickoffBall(jitter: number): { x: number; y: number } {
  return { x: CENTRE_X + jitter, y: PITCH.ceil + 110 }
}

/** Score line: first to `goal` goals ends the match. */
export function matchOver(score: readonly [number, number], goal: number): Side | null {
  if (score[0] >= goal) return 0
  if (score[1] >= goal) return 1
  return null
}

/** True when `x` is on `side`'s half of the pitch (the bot plays only its own half). */
export function onOwnHalf(side: Side, x: number): boolean {
  return side === 0 ? x <= CENTRE_X + 40 : x >= CENTRE_X - 40
}
