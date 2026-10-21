import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { attackDir, grounded, onOwnHalf, PITCH } from './rules.ts'

/** What the computer can see of the game when it decides whether to hop. */
export interface BotView {
  side: Side
  ball: { x: number; y: number }
  me: { x: number; y: number }
  /** Seconds left before this player may hop again. */
  cool: number
  time: number
}

/** Per-side memory of the computer: when it may react to the ball it is watching. */
export interface BotMind {
  /** Game time the reaction fires; -1 while the ball is not in range. */
  armed: number
}

export const newMind = (): BotMind => ({ armed: -1 })

/** Horizontal reach: how far the ball may be from the player for a hop to meet it. */
const REACH: Record<Difficulty, number> = { easy: 190, normal: 240, hard: 270 }
/** Reaction time range in seconds, per difficulty. */
const REACT: Record<Difficulty, [number, number]> = {
  easy: [0.45, 0.9],
  normal: [0.22, 0.45],
  hard: [0.1, 0.22],
}

/** Is the ball in range for a hop from this player right now? */
function inWindow(v: BotView, d: Difficulty): boolean {
  if (v.cool > 0 || !grounded(v.me.y)) return false
  if (!onOwnHalf(v.side, v.ball.x)) return false
  const dx = v.ball.x - v.me.x
  if (Math.abs(dx) > REACH[d]) return false
  if (v.ball.y < PITCH.ground - 330) return false
  if (d === 'hard') {
    // Only the ball in front of us: a hop meets it there, not behind.
    const ahead = dx * attackDir(v.side)
    if (ahead < -60 || ahead > 260) return false
  }
  return true
}

/**
 * Should this computer player hop now? It hops when the ball is near, on its
 * own half of the pitch, and it stands on the grass. It reacts after a short,
 * difficulty-dependent delay; easy players sometimes let a ball go by.
 */
export function botHop(v: BotView, d: Difficulty, rng: Rng, mind: BotMind): boolean {
  if (!inWindow(v, d)) {
    mind.armed = -1
    return false
  }
  if (mind.armed < 0) {
    const [lo, hi] = REACT[d]
    mind.armed = v.time + rng.range(lo, hi)
  }
  if (v.time < mind.armed) return false
  // The reaction fires. Easy players sometimes whiff and look again a moment later.
  if (d === 'easy' && rng.chance(0.3)) {
    mind.armed = v.time + rng.range(0.4, 0.8)
    return false
  }
  mind.armed = -1
  return true
}
