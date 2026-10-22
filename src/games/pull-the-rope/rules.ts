import type { Side } from '../../core/game.ts'

/**
 * Pure tug-of-war physics. `pos` is the knot's place on the rope axis:
 * 0 = centre, +1 = on red's line (red wins), -1 = on blue's line (blue wins).
 */

export interface Rope {
  pos: number
  vel: number
}

/** Velocity added per tap; with DAMP this moves the knot IMPULSE / DAMP per tap. */
export const IMPULSE = 0.17
export const DAMP = 5
/** Long rounds get decisive: after this many seconds each tap pulls harder. */
export const OVERTIME = 14

export const ropeNew = (): Rope => ({ pos: 0, vel: 0 })

/** Pull strength multiplier for a round that has lasted `t` seconds. */
export function pullFactor(t: number, teams = false): number {
  const base = teams ? 0.6 : 1
  const over = Math.max(0, t - OVERTIME) * 0.25
  return base * (1 + over * over)
}

/**
 * Apply this step's pulls (in taps: a tap is 1, a hard haul a bit more) and
 * integrate. `lean` (red's tap rate minus blue's, taps/s) only counts in
 * overtime: the team that keeps the higher pace wins the slow grind, so an
 * even match can never deadlock.
 */
export function pull(
  r: Rope,
  red: number,
  blue: number,
  dt: number,
  factor = 1,
  lean = 0,
  roundT = 0,
): void {
  r.vel += (red - blue) * IMPULSE * factor
  if (roundT > OVERTIME) r.vel += lean * LEAN * (roundT - OVERTIME) * dt
  r.vel *= Math.exp(-DAMP * dt)
  r.pos += r.vel * dt
}

/** Overtime drift per (tap/s of pace advantage) per second of overtime. */
export const LEAN = 0.05
/** Most extra pull a single haul can add on release, in taps. */
export const HAUL = 0.8
/** A haul shorter than this is just a tap. */
export const HAUL_MIN = 40

/**
 * Extra pull, in taps, for a stroke released after dragging the finger `dist`
 * world units toward your own edge in `dur` seconds: long and fast strokes pull
 * hardest. Hand over hand, a hauler matches a fast tapper; one big yank beats a
 * single tap.
 */
export function haulPower(dist: number, dur: number): number {
  if (dist < HAUL_MIN) return 0
  const speed = dist / Math.max(dur, 1 / 60)
  return HAUL * Math.min(1, dist / 320) * Math.min(1, speed / 2000)
}

/** The round winner once the knot reaches a line, else null. */
export function ropeWinner(r: Rope): Side | null {
  if (r.pos >= 1) return 0
  if (r.pos <= -1) return 1
  return null
}

/** Round wins to take the match by default (best of three). */
export const TARGET = 2
