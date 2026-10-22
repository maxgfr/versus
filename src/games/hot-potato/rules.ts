import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID } from '../../core/stage.ts'

/**
 * Pure hot-potato rules. The potato lives in a lane down the middle. Whoever
 * holds it throws it back by tapping, which sends it toward the other half at
 * a speed that grows with every throw; flicking the finger toward the rival
 * right after the tap (the follow-through) throws it harder still. A hidden
 * seeded timer blows it up: the holder at that moment loses the round.
 *
 * Grabbing too soon burns your fingers: a tap while the potato is coming at
 * you (or sitting in your mitt) but before the catch delay is over is a
 * fumble, and you cannot throw for FUMBLE seconds. Mashing never pays.
 *
 * The match ramps up: each throw makes the potato hotter and faster, and a
 * round played at match point (or a decider) starts with a warm potato.
 */

/** Round wins needed to take the match: best of 5. */
export const TARGET = 3
/** The lane ends (catch points): red holds at LIMIT_R, blue at LIMIT_B. */
export const LIMIT_R = 1500
export const LIMIT_B = 300
/** Seconds after the potato enters your half before you may throw it. A short catch delay. */
export const CATCH = 0.25
/** Seconds a fumbled grab locks your throw out. */
export const FUMBLE = 0.3
/** Flight speed (world units / s): starts at SPEED0, gains SPEED_STEP per throw, capped. */
export const SPEED0 = 900
export const SPEED_STEP = 130
export const SPEED_MAX = 1900
/** Seconds after a throw during which a flick still adds speed. */
export const FOLLOW = 0.15
/** A full-force flick throws this much faster than a plain tap (0.7 = +70 %). */
export const BOOST = 0.7
/** The hidden timer: seconds after the round starts before the potato explodes. */
export const BOOM_MIN = 4
export const BOOM_MAX = 10
/** Throws until the potato is at full heat. */
export const HEAT_THROWS = 6

export interface Potato {
  /** World y of the potato. */
  y: number
  /** Direction of travel: +1 toward red (down), -1 toward blue (up). */
  dir: 1 | -1
  /** Stuck at a catch point, waiting for its holder. */
  held: boolean
  /** Throws so far this round, plus the warmth it started with (drives heat and speed). */
  throws: number
  /** Whose half the potato is in. */
  holder: Side
  /** Game time it entered the holder's half. */
  enteredAt: number
  /** Current flight speed (world units / s). */
  v: number
  /** 0..1 flick force behind the last throw (0 = a plain tap). */
  power: number
  /** Game time of the last throw, -1 before the first. */
  thrownAt: number
  /** Who threw it last (the server before the first throw). */
  by: Side
}

/**
 * How warm a round's potato starts, in throws' worth of heat and speed: the
 * match ramps up as the score gets close. Match point adds 2, a decider (both
 * on match point) 3.
 */
export function warmth(wins: readonly [number, number], target: number): number {
  const mp = target - 1
  const a = wins[0] >= mp
  const b = wins[1] >= mp
  return a && b ? 3 : a || b ? 2 : 0
}

/** A round's potato, served by `server` (held at their catch point), starting `warm` throws hot. */
export function potatoNew(server: Side, now: number, warm = 0): Potato {
  return {
    y: server === 0 ? LIMIT_R : LIMIT_B,
    dir: server === 0 ? -1 : 1,
    held: true,
    throws: warm,
    holder: server,
    enteredAt: now,
    v: 0,
    power: 0,
    thrownAt: -1,
    by: server,
  }
}

/** Which half a world y is in. */
export const holderOf = (y: number): Side => (y > MID ? 0 : 1)

export const speedOf = (throws: number): number => Math.min(SPEED_MAX, SPEED0 + SPEED_STEP * throws)

/** 0..1 how hot the potato is. */
export const heatOf = (throws: number): number => Math.min(1, throws / HEAT_THROWS)

/** Move the potato, and note when it crosses into a half. */
export function potatoStep(p: Potato, dt: number, now: number): void {
  if (!p.held) {
    p.y += p.dir * (p.v || speedOf(p.throws)) * dt
    if (p.dir === 1 && p.y >= LIMIT_R) {
      p.y = LIMIT_R
      p.held = true
    } else if (p.dir === -1 && p.y <= LIMIT_B) {
      p.y = LIMIT_B
      p.held = true
    }
  }
  const h = holderOf(p.y)
  if (h !== p.holder) {
    p.holder = h
    p.enteredAt = now
  }
}

/** Is the potato `side`'s problem: in their half and coming at them (or resting in their mitt)? */
export function incoming(p: Potato, side: Side): boolean {
  const toward = p.dir === (side === 0 ? 1 : -1)
  return holderOf(p.y) === side && (p.held || toward)
}

/**
 * May `side` throw now? The potato must be theirs (see `incoming`), the catch
 * delay must be over and their fingers must not be burnt (`lock`: game time a
 * fumble locks them out until). Once thrown it is on its way out, so a second
 * tap does nothing.
 */
export function canThrow(p: Potato, side: Side, now: number, lock = -Infinity): boolean {
  return incoming(p, side) && now - p.enteredAt >= CATCH && now >= lock
}

export type TapResult = 'throw' | 'fumble' | 'none'

/**
 * What a tap by `side` does now: throws when allowed, fumbles when the potato
 * is theirs but not ready (too soon, or fingers still burnt; each fumble
 * renews the lock), and does nothing while the potato is the rival's problem.
 */
export function tapResult(p: Potato, side: Side, now: number, lock = -Infinity): TapResult {
  if (!incoming(p, side)) return 'none'
  return canThrow(p, side, now, lock) ? 'throw' : 'fumble'
}

/** Throw it back toward the other half at the plain-tap speed. Only callable when `canThrow` is true. */
export function throwPotato(p: Potato, side: Side, now = 0): void {
  p.dir = side === 0 ? -1 : 1
  p.held = false
  p.throws++
  p.v = speedOf(p.throws)
  p.power = 0
  p.thrownAt = now
  p.by = side
}

/**
 * The follow-through: a flick of `force` (0..1) by the thrower within FOLLOW
 * seconds of the throw speeds the potato up. Only ever adds speed. Returns
 * true when it did.
 */
export function followThrough(p: Potato, side: Side, force: number, now: number): boolean {
  if (p.held || p.by !== side || p.thrownAt < 0 || now - p.thrownAt > FOLLOW) return false
  const f = Math.max(0, Math.min(1, force))
  if (f <= p.power) return false
  p.power = f
  p.v = speedOf(p.throws) * (1 + BOOST * f)
  return true
}

/** The hidden timer for a round, in seconds from its start. */
export function boomDelay(rng: Rng): number {
  return rng.range(BOOM_MIN, BOOM_MAX)
}

/** Who loses when the potato explodes: the holder, the half it is in. */
export const loserAt = (p: Potato): Side => holderOf(p.y)

export const winnerAt = (p: Potato): Side => other(loserAt(p))
