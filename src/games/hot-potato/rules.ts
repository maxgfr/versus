import { other, type Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID } from '../../core/stage.ts'

/**
 * Pure hot-potato rules. The potato lives in a lane down the middle. Whoever
 * holds it throws it back by tapping, which sends it toward the other half at
 * a speed that grows with every throw. A hidden seeded timer blows it up: the
 * holder at that moment loses the round.
 */

/** Round wins needed to take the match: best of 5. */
export const TARGET = 3
/** The lane ends (catch points): red holds at LIMIT_R, blue at LIMIT_B. */
export const LIMIT_R = 1500
export const LIMIT_B = 300
/** Seconds after the potato enters your half before you may throw it. A short catch delay. */
export const CATCH = 0.25
/** Flight speed (world units / s): starts at SPEED0, gains SPEED_STEP per throw, capped. */
export const SPEED0 = 900
export const SPEED_STEP = 130
export const SPEED_MAX = 1900
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
  /** Throws so far this round. */
  throws: number
  /** Whose half the potato is in. */
  holder: Side
  /** Game time it entered the holder's half. */
  enteredAt: number
}

/** A round's potato, served by `server` (held at their catch point). */
export function potatoNew(server: Side, now: number): Potato {
  return {
    y: server === 0 ? LIMIT_R : LIMIT_B,
    dir: server === 0 ? -1 : 1,
    held: true,
    throws: 0,
    holder: server,
    enteredAt: now,
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
    p.y += p.dir * speedOf(p.throws) * dt
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

/**
 * May `side` throw now? The potato must be in their half and coming at them
 * (or resting at their catch point), and the catch delay must be over. Once
 * thrown it is on its way out, so a second tap does nothing.
 */
export function canThrow(p: Potato, side: Side, now: number): boolean {
  const toward = p.dir === (side === 0 ? 1 : -1)
  return holderOf(p.y) === side && (p.held || toward) && now - p.enteredAt >= CATCH
}

/** Throw it back toward the other half. Only callable when `canThrow` is true. */
export function throwPotato(p: Potato, side: Side): void {
  p.dir = side === 0 ? -1 : 1
  p.held = false
  p.throws++
}

/** The hidden timer for a round, in seconds from its start. */
export function boomDelay(rng: Rng): number {
  return rng.range(BOOM_MIN, BOOM_MAX)
}

/** Who loses when the potato explodes: the holder, the half it is in. */
export const loserAt = (p: Potato): Side => holderOf(p.y)

export const winnerAt = (p: Potato): Side => other(loserAt(p))
