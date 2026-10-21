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

/** Apply this step's taps and integrate. */
export function pull(r: Rope, redTaps: number, blueTaps: number, dt: number, factor = 1): void {
  r.vel += (redTaps - blueTaps) * IMPULSE * factor
  r.vel *= Math.exp(-DAMP * dt)
  r.pos += r.vel * dt
}

/** The round winner once the knot reaches a line, else null. */
export function ropeWinner(r: Rope): Side | null {
  if (r.pos >= 1) return 0
  if (r.pos <= -1) return 1
  return null
}

/** Round wins to take the match by default (best of three). */
export const TARGET = 2
