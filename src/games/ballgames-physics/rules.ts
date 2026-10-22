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
/** Ball speed given by a connecting kick, per step: a soft poke to a full-power strike. */
export const KICK_MIN = 14
export const KICK_MAX = 30
/** Speed of an average kick (half power). */
export const KICK_SPEED = (KICK_MIN + KICK_MAX) / 2
/**
 * Hard cap on the ball's speed per step. Under the crossbar's thickness plus the
 * ball's diameter, so no step can carry the ball through any static wall.
 */
export const MAX_BALL = 34
/** Seconds of holding the finger down after a hop to wind the leg up fully. */
export const CHARGE_TIME = 0.4
/** Gravity in world units per step² (matter: 1 × 0.0012 × (1000/60)²). */
export const GRAV = 0.0012 * (1000 / 60) ** 2
/** The ball's air drag per step, as in sim.ts. */
export const BALL_AIR = 0.008
/** The ball's bounce off the grass and the walls, as in sim.ts. */
export const BALL_BOUNCE = 0.65
/**
 * Steps a player must sit still (off the grass, on the ball, the rival or a
 * crossbar) before it counts as standing and may hop again.
 */
export const REST_STEPS = 6
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
 * May a player hop? On the grass, or perched still on something (a crossbar,
 * the ball, the rival's head) for a few steps: otherwise a player who lands on
 * top of the goal would be stuck there for the rest of the match.
 */
export function canHop(bodyY: number, restSteps: number): boolean {
  return grounded(bodyY) || restSteps >= REST_STEPS
}

/** Count of consecutive still steps off the grass (`vy` per step). */
export function restCount(prev: number, bodyY: number, vy: number): number {
  if (grounded(bodyY)) return 0
  return Math.abs(vy) < 0.25 ? prev + 1 : 0
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
 * How hard the kicker runs into the ball, per step: the kicker's velocity minus
 * the ball's, along the line from the kicker to the ball. Negative = parting.
 */
export function closingSpeed(
  from: { x: number; y: number },
  fromV: { x: number; y: number },
  ball: { x: number; y: number },
  ballV: { x: number; y: number },
): number {
  const dx = ball.x - from.x
  const dy = ball.y - from.y
  const m = Math.hypot(dx, dy)
  if (m === 0) return 0
  return ((fromV.x - ballV.x) * dx + (fromV.y - ballV.y) * dy) / m
}

/**
 * Kick power 0..1: the wind-up (how long the finger was held, 0..1) and the
 * momentum of the hop into the ball both count. A quick tap on a soft hop is a
 * poke; a held press while flying into the ball is a rocket.
 */
export function kickPower(charge: number, closing: number): number {
  const c = Math.max(0, Math.min(1, charge))
  const m = Math.max(0, Math.min(1, closing / 18))
  return Math.max(0, Math.min(1, 0.2 + c * 0.5 + m * 0.4))
}

/**
 * Ball speed per step for a kick of `power` 0..1, made livelier by the match's
 * `heat` 0..1 (see `rampHeat`), never past the speed cap.
 */
export const kickSpeed = (power: number, heat = 0): number =>
  Math.min(
    MAX_BALL,
    (KICK_MIN + (KICK_MAX - KICK_MIN) * Math.max(0, Math.min(1, power))) *
      (1 + HEAT_KICK * Math.max(0, Math.min(1, heat))),
  )

/**
 * Velocity a connecting kick gives the ball. It is aimed from the kicker
 * toward the ball, biased toward the goal the kicker attacks and up a little;
 * its speed grows with `power` and the match's `heat`.
 */
export function kickVelocity(
  from: { x: number; y: number },
  ball: { x: number; y: number },
  side: Side,
  power = 0.5,
  heat = 0,
): { x: number; y: number } {
  const dx = ball.x - from.x + attackDir(side) * 160
  const dy = ball.y - from.y - 110
  const m = Math.hypot(dx, dy) || 1
  const v = kickSpeed(power, heat)
  return { x: (dx / m) * v, y: (dy / m) * v }
}

/** At full heat kicks fly this much faster… */
export const HEAT_KICK = 0.22
/** …and players are back on their feet this much sooner. */
export const HEAT_COOL = 0.35

/**
 * How heated the match is, 0..1, the same for both players. A point heats up
 * the longer it lasts (from 5 s in, full at 30 s), and the closing stages add
 * pressure: a level score from 1–1 on, and more again at match point.
 */
export function rampHeat(pointT: number, score: readonly [number, number], goal: number): number {
  const time = Math.max(0, Math.min(1, (pointT - 5) / 25))
  const lead = Math.max(score[0], score[1])
  let pressure = 0
  if (goal > 1 && lead >= goal - 1) pressure = 0.4
  else if (score[0] === score[1] && lead >= 1) pressure = 0.15
  return Math.min(1, pressure + time * (1 - pressure))
}

/** Seconds before a player may hop again, shorter as the match heats up. */
export const cooldownFor = (heat: number): number =>
  COOLDOWN * (1 - HEAT_COOL * Math.max(0, Math.min(1, heat)))

/** Scale a velocity down to at most `max` per step. */
export function capped(v: { x: number; y: number }, max = MAX_BALL): { x: number; y: number } {
  const m = Math.hypot(v.x, v.y)
  return m <= max ? v : { x: (v.x / m) * max, y: (v.y / m) * max }
}

/** A body has somehow left the pitch box (squeezed through a wall): put it back. */
export function escaped(x: number, y: number): boolean {
  return (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < PITCH.left - 20 ||
    x > PITCH.right + 20 ||
    y < PITCH.ceil - 60 ||
    y > PITCH.ground + 40
  )
}

/**
 * Where the ball will be over the next steps: plain flight with gravity and
 * drag, bouncing off the grass, the ceiling and the back walls (crossbars and
 * players ignored). Writes `n` points into `out` as x0, y0, x1, y1… and
 * returns it. Bots read the future here; humans' hops lead the ball with it.
 */
export function ballPath(
  x: number,
  y: number,
  vx: number,
  vy: number,
  n: number,
  out: number[] = [],
): number[] {
  out.length = n * 2
  const lo = PITCH.left + BALL_R
  const hi = PITCH.right - BALL_R
  const top = PITCH.ceil + BALL_R
  const floor = PITCH.ground - BALL_R
  for (let i = 0; i < n; i++) {
    vx *= 1 - BALL_AIR
    vy = vy * (1 - BALL_AIR) + GRAV
    x += vx
    y += vy
    if (y > floor) {
      y = floor
      vy = vy > 0 ? -vy * BALL_BOUNCE : vy
      if (Math.abs(vy) < 1) vy = 0
    }
    if (y < top) {
      y = top
      vy = Math.abs(vy) * BALL_BOUNCE
    }
    if (x < lo) {
      x = lo
      vx = Math.abs(vx) * BALL_BOUNCE
    }
    if (x > hi) {
      x = hi
      vx = -Math.abs(vx) * BALL_BOUNCE
    }
    out[i * 2] = x
    out[i * 2 + 1] = y
  }
  return out
}

/**
 * Where a ball sent from (x, y) at (vx, vy) ends up within `n` steps: into a
 * goal (and which side scores, and when), off a crossbar, or just where it is
 * after `n` steps. Players are ignored. Bots weigh their kicks with it.
 */
export function kickOutcome(
  x: number,
  y: number,
  vx: number,
  vy: number,
  n: number,
): { scorer: Side | null; step: number; x: number; bar: boolean } {
  const pts = ballPath(x, y, vx, vy, n, outcomePath)
  for (let i = 0; i < n; i++) {
    const px = pts[i * 2] as number
    const py = pts[i * 2 + 1] as number
    const scorer = goalBy(px, py)
    if (scorer !== null) return { scorer, step: i, x: px, bar: false }
    // Over the goal box but not under the bar: the crossbar stops it.
    const inBox = px < PITCH.left + PITCH.goalD || px > PITCH.right - PITCH.goalD
    if (inBox && py > GOAL_TOP - BALL_R - 12) return { scorer: null, step: i, x: px, bar: true }
  }
  return { scorer: null, step: n, x: pts[(n - 1) * 2] as number, bar: false }
}
const outcomePath: number[] = []

/** Steps a hop's aim leads the ball by: about when a hop meets it. */
export const LEAD_STEPS = 18

/** Where a hop should aim: the ball's x a moment from now. */
export function leadX(x: number, y: number, vx: number, vy: number, steps = LEAD_STEPS): number {
  if (steps <= 0) return x
  const p = ballPath(x, y, vx, vy, steps)
  return p[(steps - 1) * 2] ?? x
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
