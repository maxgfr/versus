import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { type Board, type Cmd, PADDLE_Y, predictX } from './rules.ts'

interface Tuning {
  /** Seconds between aim updates: the bot tracks the ball with this lag. */
  react: number
  /** Aim error in world units. */
  noise: number
  /** Top paddle speed the bot can manage (world units / s). */
  speed: number
  /** Seconds stuck to the paddle before the bot launches. */
  launch: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.28, noise: 70, speed: 900, launch: 1.1 },
  normal: { react: 0.14, noise: 28, speed: 1500, launch: 0.6 },
  hard: { react: 0.06, noise: 30, speed: 2300, launch: 0.3 },
}

/** Per-bot memory carried between steps (not synced). */
export interface BotMemory {
  aim: number
  timer: number
}

export const newMemory = (): BotMemory => ({ aim: W / 2, timer: 0 })

/**
 * The paddle command for one board. Works in the board's own frame, so the
 * same code plays red's or blue's board.
 */
export function decide(b: Board, d: Difficulty, rng: Rng, mem: BotMemory, dt: number): Cmd {
  const t = TUNING[d]
  mem.timer -= dt
  if (mem.timer <= 0) {
    mem.timer = t.react * (0.7 + rng.next() * 0.6)
    const ball = b.ball
    const landing = predictX(ball.x, ball.y, ball.vx, ball.vy, PADDLE_Y)
    mem.aim = landing !== null ? landing + (rng.next() - 0.5) * 2 * t.noise : ball.x
  }
  const step = t.speed * dt
  const x = b.px + Math.max(-step, Math.min(step, mem.aim - b.px))
  return { x, launch: b.ball.stuck && b.serveT >= t.launch }
}
