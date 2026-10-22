import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import {
  BALL_R,
  type Board,
  brickRect,
  type Cmd,
  ENGLISH,
  PADDLE_SPEED,
  PADDLE_H,
  PADDLE_HALF,
  PADDLE_Y,
  predictX,
} from './rules.ts'

interface Tuning {
  /** Seconds between aim updates: the bot tracks the ball with this lag. */
  react: number
  /** Aim error in world units. */
  noise: number
  /** Top paddle speed the bot can manage (world units / s). */
  speed: number
  /** Seconds stuck to the paddle before the bot launches. */
  launch: number
  /** 0..1 how much it angles its hits toward the bricks still standing. */
  steer: number
  /** Whether it swings through the ball at contact (english + drive) instead of waiting under it. */
  swing: boolean
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.3, noise: 75, speed: 900, launch: 1.1, steer: 0, swing: false },
  normal: { react: 0.1, noise: 22, speed: 1900, launch: 0.5, steer: 0.65, swing: false },
  hard: { react: 0.04, noise: 8, speed: 2900, launch: 0.25, steer: 1, swing: true },
}

/** Per-bot memory carried between steps (not synced). */
export interface BotMemory {
  aim: number
  timer: number
  /** Direction of the planned swing through the ball (+1 right, -1 left). */
  dir: number
}

export const newMemory = (): BotMemory => ({ aim: W / 2, timer: 0, dir: 1 })

/** Seconds before contact a swinging bot starts its sweep, and the sweep's speed. */
const SWING_T = 0.07
const SWING_V = 3400

/**
 * Where on the paddle to take a ball landing at `landing` so it flies back at
 * the lowest standing brick (the one it can reach first). Returns the paddle
 * offset, -1..1 (the rules' angle is about offset × 1.05).
 */
export function steerOffset(b: Board, landing: number): number {
  let target: { x: number; y: number } | null = null
  for (const br of b.bricks) {
    const rc = brickRect(br.c, br.r)
    const y = rc.y + rc.h
    if (
      !target ||
      y > target.y + 1 ||
      (Math.abs(y - target.y) <= 1 && Math.abs(rc.x - landing) < Math.abs(target.x - landing))
    )
      target = { x: rc.x + rc.w / 2, y }
  }
  if (!target) return 0
  const up = PADDLE_Y - PADDLE_H / 2 - target.y
  const a = Math.atan2(target.x - landing, Math.max(60, up))
  return Math.max(-0.75, Math.min(0.75, a / 1.05))
}

/**
 * The paddle command for one board. Works in the board's own frame, so the
 * same code plays red's or blue's board. It predicts where the ball comes down
 * (wall bounces included) and, on harder levels, takes it off-centre so the
 * rebound heads for the bricks.
 */
export function decide(b: Board, d: Difficulty, rng: Rng, mem: BotMemory, dt: number): Cmd {
  const t = TUNING[d]
  mem.timer -= dt
  if (mem.timer <= 0) {
    mem.timer = t.react * (0.7 + rng.next() * 0.6)
    const ball = b.ball
    const landing = predictX(ball.x, ball.y, ball.vx, ball.vy, PADDLE_Y - PADDLE_H / 2)
    if (landing === null) mem.aim = ball.x
    else {
      let off = steerOffset(b, landing) * t.steer
      if (t.swing) {
        // Swing the way the ball should go: the english adds angle that way, so
        // take it a little less off-centre.
        mem.dir = off < 0 ? -1 : 1
        const k = Math.min(1, SWING_V / PADDLE_SPEED)
        off = Math.max(-0.8, Math.min(0.8, off - (mem.dir * k * ENGLISH) / 1.05))
      }
      mem.aim = landing - off * PADDLE_HALF + (rng.next() - 0.5) * 2 * t.noise
    }
  }
  const step = t.speed * dt
  const ball = b.ball
  const top = PADDLE_Y - PADDLE_H / 2 - BALL_R
  const ttc = !ball.stuck && ball.vy > 0 ? (top - ball.y) / ball.vy : Infinity
  let goal = mem.aim
  let cap = step
  if (t.swing && ttc < 0.5) {
    // Line up just behind the contact point, then sweep through it at swing speed.
    const v = SWING_V * dt
    const back = mem.aim - mem.dir * SWING_V * SWING_T
    if (ttc > SWING_T) goal = back
    else if (Math.abs(b.px + mem.dir * SWING_V * ttc - mem.aim) < PADDLE_HALF * 0.5) {
      goal = b.px + mem.dir * v
      cap = v
    }
  }
  const x = b.px + Math.max(-cap, Math.min(cap, goal - b.px))
  return { x, launch: b.ball.stuck && b.serveT >= t.launch }
}
