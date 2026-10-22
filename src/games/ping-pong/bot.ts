import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { BALL_R, BAT_R, REST_Y, type Target, type World, bandOf, predictCross } from './rules.ts'

interface Tuning {
  /** Bat top speed (units/s). */
  speed: number
  /** Seconds between decisions: slower bots react late. */
  react: number
  /** Error on the intercept point (world units). */
  noise: number
  /** Chance that a return is deliberately mistimed. */
  miss: number
  /** Extra miss chance per stroke of the rally: long rallies wear the bot down. */
  fatigue: number
  /** Chance per approach to step in and drive the bat through the ball (a smash). */
  smash: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { speed: 1150, react: 0.26, noise: 90, miss: 0.14, fatigue: 0.02, smash: 0 },
  normal: { speed: 2100, react: 0.1, noise: 26, miss: 0.035, fatigue: 0.009, smash: 0.3 },
  hard: { speed: 2800, react: 0.04, noise: 6, miss: 0.008, fatigue: 0.004, smash: 0.5 },
}

/** Per-bot memory carried between steps (not part of the synced state). */
export interface BotMemory {
  /** Seconds until the next decision. */
  wait: number
  /** Last decided bat target, held between decisions. */
  target: Target
  /** Seconds before serving, once the bot is the server. */
  serveIn: number
  /** Whether a serve countdown is running for the current serve. */
  armed: boolean
  /** Whether the ball is coming toward this side (tracked per approach). */
  incoming: boolean
  /** Rolled once per approach: this return is mistimed. */
  mistimed: boolean
  /** Which way a mistimed bat ends up beside the ball. */
  missDir: number
  /** Rolled once per approach: step in and smash this one. */
  smashing: boolean
}

export const newMemory = (): BotMemory => ({
  wait: 0,
  target: null,
  serveIn: 0,
  armed: false,
  incoming: false,
  mistimed: false,
  missDir: 1,
  smashing: false,
})

export interface Decision {
  target: Target
  serve: boolean
}

/**
 * The bot's bat goes where the ball will cross its line, offset so the return
 * leaves toward the side the human is not covering. Decisions come every
 * `react` seconds, so a slow bot is always a little late.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Decision {
  const tune = TUNING[d]
  const rest = { x: W / 2, y: REST_Y[side] }
  if (w.phase === 'serve' && w.server === side) {
    if (!mem.armed) {
      mem.armed = true
      mem.serveIn = tune.react * (2 + rng.next())
    }
    mem.serveIn -= dt
    return { target: null, serve: mem.serveIn <= 0 }
  }
  mem.armed = false
  mem.wait -= dt
  if (mem.wait > 0 && mem.target) return { target: mem.target, serve: false }
  mem.wait = tune.react * (0.7 + rng.next() * 0.6)
  const toward = w.phase === 'play' && (side === 0 ? w.ball.vy > 0 : w.ball.vy < 0)
  if (toward && !mem.incoming) {
    mem.mistimed = rng.next() < tune.miss + w.rally * tune.fatigue
    mem.missDir = rng.chance(0.5) ? -1 : 1
    mem.smashing = !mem.mistimed && rng.next() < tune.smash
  }
  mem.incoming = toward
  if (w.phase !== 'play' || !toward) {
    mem.target = w.phase === 'play' ? { x: W / 2 + (w.ball.x - W / 2) * 0.4, y: rest.y } : rest
    return { target: mem.target, serve: false }
  }
  // A smash waits at the back of the band, then lunges at the net as the ball arrives.
  const band = bandOf(side)
  const back = side === 0 ? band.y1 - 20 : band.y0 + 20
  const front = side === 0 ? band.y0 + 30 : band.y1 - 30
  const gap = Math.abs(w.ball.y - REST_Y[side])
  const lunge = mem.smashing && gap < 320
  const y = mem.smashing ? (lunge ? front : back) : rest.y
  const px = predictCross(w, y) ?? w.ball.x
  const rival = w.bats[other(side)]
  // Aim the return away from the rival's side of the table.
  const want = -Math.max(-1, Math.min(1, (rival.x - W / 2) / 320)) * 0.6
  const reach = BAT_R + BALL_R
  let x: number
  if (mem.mistimed) {
    // Mistimed: the bat ends up just beside the ball.
    x = px + mem.missDir * reach * 1.7
  } else {
    const aim = Math.max(-1, Math.min(1, want + (rng.next() - 0.5) * 0.6))
    x = px + (rng.next() - 0.5) * 2 * tune.noise - aim * reach
  }
  x = Math.max(band.x0, Math.min(band.x1, x))
  mem.target = { x, y }
  return { target: mem.target, serve: false }
}
