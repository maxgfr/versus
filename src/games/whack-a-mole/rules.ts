import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure whack-a-mole rules. One seeded schedule of pops is shared by both
 * halves, so every player faces the same moles and bunnies. Moles score; a
 * bunny costs points. The most points after the clock runs out wins.
 */

/** Seconds on the clock. */
export const GAME_TIME = 40
/** Points for whacking a mole, and the (negative) points for a bunny. */
export const MOLE_POINTS = 1
export const BUNNY_POINTS = -2
/** Holes per half (3 by 3). */
export const HOLES = 9
/** Seconds a pop stays up, by kind. */
export const UP: Record<PopKind, [number, number]> = {
  mole: [0.9, 1.45],
  bunny: [0.85, 1.25],
}
/** A mole whacked within this many seconds of popping up is a quick whack: one point extra. */
export const QUICK = 0.5
export const QUICK_BONUS = 1
/** Taps further than this from a hole's centre miss it (world units). */
export const REACH = 130

/**
 * Against the computer its level also sets the pace: pops come thicker and
 * stay up for less time (hard), or the other way round (easy). Local 2P and
 * online play at 1.
 */
export const TEMPO: Record<Difficulty, number> = { easy: 0.85, normal: 1, hard: 1.25 }

/** The tempo of a match, fixed once at setup. */
export function tempoOf(d: Difficulty, bots: readonly boolean[]): number {
  return bots.some(Boolean) ? TEMPO[d] : 1
}

export type PopKind = 'mole' | 'bunny'

/** One scheduled pop: when it starts, which hole, what it is, how long it stays up. */
export interface Pop {
  at: number
  hole: number
  kind: PopKind
  dur: number
}

/** Hole centres in red's frame: 3 columns by 3 rows in the player's half. */
const COLS = [250, 500, 750]
const ROWS = [1130, 1350, 1570]

export function holeXY(i: number): { x: number; y: number } {
  return { x: COLS[i % 3] ?? 500, y: ROWS[Math.floor(i / 3)] ?? 1350 }
}

/** The hole a point (in red's frame) lands on, or -1. */
export function holeAt(x: number, y: number): number {
  let best = -1
  let bestD = REACH * REACH
  for (let i = 0; i < HOLES; i++) {
    const h = holeXY(i)
    const d = (h.x - x) ** 2 + (h.y - y) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * The shared schedule for the whole match. Each hole only pops again once its
 * last pop has gone down. Teams see faster pops, to keep two players busy.
 * The match ramps up: toward the buzzer pops come faster, stay up for less
 * time, and more of them are bunnies. `tempo` divides both the gap between
 * pops and how long each stays up.
 */
export function scheduleFor(rng: Rng, teams: boolean, len = GAME_TIME, tempo = 1): Pop[] {
  const pops: Pop[] = []
  const busyUntil: number[] = Array.from({ length: HOLES }, () => 0)
  let t = 0.8
  while (t < len + 1) {
    const heat = Math.min(1, t / len)
    let hole = rng.int(0, HOLES - 1)
    for (let tries = 0; (busyUntil[hole] ?? 0) > t && tries < 12; tries++) {
      hole = rng.int(0, HOLES - 1)
    }
    if ((busyUntil[hole] ?? 0) <= t) {
      const kind: PopKind = rng.chance(0.24 + 0.1 * heat) ? 'bunny' : 'mole'
      const [lo, hi] = UP[kind]
      const dur = (rng.range(lo, hi) * (1 - 0.25 * heat)) / tempo
      pops.push({ at: round(t), hole, kind, dur: round(dur) })
      busyUntil[hole] = t + dur + 0.2
    }
    t += (rng.range(0.34, 0.8) * (teams ? 0.7 : 1) * (1 - 0.35 * heat)) / tempo
  }
  return pops
}

/**
 * Points for a whack on a pop of this kind, `reaction` seconds after it
 * popped up: a quick whack on a mole is worth one more.
 */
export function pointsFor(kind: PopKind, reaction = Infinity): number {
  if (kind === 'bunny') return BUNNY_POINTS
  return MOLE_POINTS + (reaction <= QUICK ? QUICK_BONUS : 0)
}

/** Who won on points, or 'draw'. */
export function winnerOf(score: [number, number]): Side | 'draw' {
  if (score[0] === score[1]) return 'draw'
  return score[0] > score[1] ? 0 : 1
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
