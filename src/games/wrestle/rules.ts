import type { Side } from '../../core/game.ts'
import { W } from '../../core/stage.ts'

/**
 * Pure rules for Wrestle: the ring, the wrestlers' numbers, and who has lost
 * the round. Physics lives in sim.ts; nothing here touches matter.
 *
 * The ring is the middle band of the stage. Red (side 0) starts on the left,
 * blue (side 1) on the right. A wrestler whose head touches the mat loses.
 */

/** Ring geometry, world units. */
export const RING = {
  /** Inside faces of the two side posts (the ropes run between them). */
  left: 60,
  right: W - 60,
  /** The mat's surface: where heads must not touch. */
  mat: 1130,
  /** Top of the painted band: the ropes never go above this. */
  top: 630,
  /** Bottom of the apron (the band is centred on the stage). */
  bottom: 1290,
} as const

/** Scale of a ragdoll wrestler: about 200 world units tall. */
export const SCALE = 1.1
/** Torso centre when a wrestler stands with its legs on the mat (the ragdoll is about 115 × scale below its centre). */
export const STAND_Y = RING.mat - 115 * SCALE
/** Head radius at this scale (ragdoll uses 30 × scale). */
export const HEAD_R = 30 * SCALE
/** Where each wrestler starts a round, red on the left. */
export const HOME_X: readonly [number, number] = [330, 670]

/**
 * Wrestlers tire as a round drags on: their upright reflex fades to this
 * share by the end of the round clock, so long rounds tip over into a fall.
 */
export const TIRED = 0.45
/** Upright reflex strength `roundT` seconds into a round (1 fresh, TIRED at the clock). */
export function stamina(roundT: number): number {
  return 1 - (1 - TIRED) * Math.min(1, Math.max(0, roundT / ROUND_TIME))
}

/** A flick right after a jump adds up to this much speed (per step) in the flick's direction. */
export const FLICK_V = 3.4
/** The flick must come within this many seconds of the jump, and travel this far. */
export const FLICK_WINDOW = 0.25
export const FLICK_MIN = 60
/** Finger speed (units/s) for a full-strength flick. */
export const FLICK_FULL = 2600

/**
 * Extra velocity (per step) for a flick moving (dx, dy) in `dur` seconds, in
 * the flicker's own view: sideways becomes a push that way, upward extra
 * height. Downward flicks only steer sideways.
 */
export function flickBoost(dx: number, dy: number, dur: number): { vx: number; vy: number } {
  const d = Math.hypot(dx, dy)
  if (d < FLICK_MIN) return { vx: 0, vy: 0 }
  const k = Math.min(1, d / Math.max(dur, 1 / 60) / FLICK_FULL)
  return { vx: (dx / d) * FLICK_V * k, vy: Math.min(0, dy / d) * FLICK_V * k }
}

/** Upward speed of a jump, per step. */
export const JUMP_V = 12.5
/** Sideways speed of a lunge toward the rival, per step. */
export const LUNGE_VX = 4.2
/** Smaller push for a lunge made in the air. */
export const AIR_LUNGE_VX = 1.8
/** Seconds before the same wrestler may jump or lunge again. */
export const COOLDOWN = 0.6
/** Seconds the banner and the fall play before the next round. */
export const ROUND_PAUSE = 1.8
/** Seconds a round may last; if nobody falls, the one lower down loses. */
export const ROUND_TIME = 30

/** Standing on the springy legs: the torso sits at (or a little under) its rest height. */
export function grounded(torsoY: number): boolean {
  return torsoY >= STAND_Y - 10
}

/**
 * The mat is a wrestler's loss when their head reaches it. The neck spring
 * holds a head that lies on the mat a little above the surface, so the margin
 * is generous; a head that is up on its shoulders is still in the fight.
 */
export function headDown(headY: number): boolean {
  return headY >= RING.mat - HEAD_R - 16
}

/** Who lost a round: `null` while it goes on. Both heads down at once is a replay. */
export function roundLoser(headY: readonly [number, number]): Side | 'both' | null {
  const d0 = headDown(headY[0])
  const d1 = headDown(headY[1])
  if (d0 && d1) return 'both'
  if (d0) return 0
  if (d1) return 1
  return null
}

/**
 * The round after `ROUND_TIME` with nobody down: the wrestler whose head is
 * lower loses. Level heads go to whoever is pushed closer to their own rope.
 */
export function timeoutLoser(
  headY: readonly [number, number],
  torsoX: readonly [number, number],
): Side {
  const diff = headY[0] - headY[1]
  if (Math.abs(diff) >= 12) return diff > 0 ? 0 : 1
  const room0 = torsoX[0] - RING.left
  const room1 = RING.right - torsoX[1]
  return room0 <= room1 ? 0 : 1
}

/** Which way a wrestler lunges: toward the rival, or the way they face when level. */
export function lungeDir(side: Side, meX: number, rivalX: number): 1 | -1 {
  if (rivalX > meX + 1) return 1
  if (rivalX < meX - 1) return -1
  return side === 0 ? 1 : -1
}

/** Match: first to `goal` round wins. */
export function matchOver(wins: readonly [number, number], goal: number): Side | null {
  if (wins[0] >= goal) return 0
  if (wins[1] >= goal) return 1
  return null
}

/** Is the rival close enough to be worth a lunge? */
export function inReach(meX: number, rivalX: number, reach: number): boolean {
  return Math.abs(rivalX - meX) <= reach
}
