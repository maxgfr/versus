import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { grounded, inReach } from './rules.ts'

/** What the computer can see when it decides whether to jump or lunge. */
export interface BotView {
  me: { x: number; y: number }
  rival: { x: number }
  /** Seconds left before this wrestler may jump or lunge again. */
  cool: number
  time: number
  /** Seconds left before the rival may move again (0 = ready). */
  rivalCool?: number
}

/** Per-wrestler memory: when a reaction that is already under way may fire. */
export interface BotMind {
  /** Game time the reaction fires; -1 while the rival is out of reach. */
  armed: number
  /** Game time a hard bot started waiting on a ready rival (-1 = not waiting). */
  bait: number
}

export const newMind = (): BotMind => ({ armed: -1, bait: -1 })

/**
 * How close the rival must be before the computer lunges. Wider than the gap
 * the wrestlers start with, so the two never stand still out of each other's reach.
 */
const REACH: Record<Difficulty, number> = { easy: 420, normal: 460, hard: 500 }
/** Reaction time range in seconds: a timing window after each landing. */
const REACT: Record<Difficulty, [number, number]> = {
  easy: [0.5, 0.9],
  normal: [0.18, 0.34],
  hard: [0.08, 0.2],
}
/** How long a hard bot waits for a ready rival to commit first, so it can counter. */
const BAIT = 0.35
/** Strength (0..1) of the flick a bot adds to its lunge, by difficulty. */
export const BOT_FLICK: Record<Difficulty, number> = { easy: 0, normal: 0.45, hard: 0.8 }

/** Standing on the mat, rival in reach and not still recovering from the last move. */
function inWindow(v: BotView, d: Difficulty): boolean {
  return grounded(v.me.y) && v.cool <= 0 && inReach(v.me.x, v.rival.x, REACH[d])
}

/**
 * Should this computer wrestler jump or lunge now? It waits a short, random
 * reaction time after the rival comes into reach, so its taps land on the
 * timing window after each landing. Easy players sometimes let a window go.
 */
export function botTap(v: BotView, d: Difficulty, rng: Rng, mind: BotMind): boolean {
  if (!inWindow(v, d)) {
    mind.armed = -1
    return false
  }
  if (mind.armed < 0) {
    const [lo, hi] = REACT[d]
    mind.armed = v.time + rng.range(lo, hi)
  }
  if (v.time < mind.armed) return false
  // Hard: against a rival who is ready too, wait a beat for them to commit,
  // then go while they are still recovering. Never waits forever.
  if (d === 'hard' && v.rivalCool !== undefined) {
    if (v.rivalCool <= 0) {
      if (mind.bait < 0) mind.bait = v.time
      if (v.time - mind.bait < BAIT) return false
    }
    mind.bait = -1
  }
  if (d === 'easy' && rng.chance(0.3)) {
    mind.armed = v.time + rng.range(0.4, 0.8)
    return false
  }
  mind.armed = -1
  return true
}
