import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'

/**
 * Piranha Rush: a river crosses the middle of the table. Each swimmer starts
 * on its own bank, swims to the far bank and back for one crossing. Piranha
 * schools sweep across the water in patterns; a bite sends the swimmer back to
 * its bank and stuns them. Pure logic: no DOM, no canvas, no Math.random.
 */

export const RIVER_TOP = 700
export const RIVER_BOT = 1100
/** Where each side starts: red on the bottom bank, blue on the top bank. */
export const HOME: readonly { x: number; y: number }[] = [
  { x: 500, y: 1450 },
  { x: 500, y: 350 },
]
export const SPEED = 240
/** Swimmers keep this far from the side edges (clear of the pause button at the left). */
export const EDGE_PAD = 120
export const STUN = 1
/** Distance at which a piranha bites a swimmer (both radii together). */
export const BITE_R = 66
/** Piranhas per school, and the spacing between them along the school. */
export const FISH = 3
export const FISH_GAP = 64
/** How far off the table a school sweeps before turning back (hidden). */
const SWEEP_PAD = 140

export interface Swimmer {
  side: Side
  x: number
  y: number
  /** 0 = heading for the far bank, 1 = has touched it and heads home. */
  phase: 0 | 1
  /** The world time until which the swimmer is stunned after a bite (-1 = not). */
  stunT: number
  crossings: number
  bites: number
}

/** A school of piranhas that sweeps left and right across the river in a pattern. */
export interface School {
  /** Lane (centre y) it swims in, and how far it wiggles off the lane. */
  y: number
  wiggle: number
  /** Swim speed (units/s), time offset (s) into its cycle, and how long it waits off-table at each end. */
  speed: number
  offset: number
  pause: number
}

export interface World {
  /** World seconds. */
  t: number
  schools: School[]
  swim: [Swimmer, Swimmer]
}

export type Ev =
  | { k: 'far'; side: Side; x: number; y: number }
  | { k: 'cross'; side: Side; x: number; y: number }
  | { k: 'bite'; side: Side; x: number; y: number }

/** Schools for a match: a few lanes through the river, each on its own rhythm. */
export function schoolsFor(rng: Rng): School[] {
  const n = 3
  const out: School[] = []
  for (let i = 0; i < n; i++) {
    const speed = rng.range(190, 290)
    const sweep = (W + 2 * SWEEP_PAD) / speed
    out.push({
      y: RIVER_TOP + 80 + i * ((RIVER_BOT - RIVER_TOP - 160) / (n - 1)) + rng.range(-20, 20),
      wiggle: rng.range(10, 40),
      speed,
      offset: rng.range(0, 2 * (sweep + 2)),
      pause: rng.range(1.2, 2.6),
    })
  }
  return out
}

export function newSwimmer(side: Side): Swimmer {
  const h = HOME[side] as { x: number; y: number }
  return { side, x: h.x, y: h.y, phase: 0, stunT: -1, crossings: 0, bites: 0 }
}

export function newWorld(schools: School[]): World {
  return { t: 0, schools, swim: [newSwimmer(0), newSwimmer(1)] }
}

/** Where a school's leader is at time t, or null while it waits off the table. */
export function leaderAt(sc: School, t: number): { x: number; y: number; dir: 1 | -1 } | null {
  const sweep = (W + 2 * SWEEP_PAD) / sc.speed
  const cycle = 2 * (sweep + sc.pause)
  const tau = (((t + sc.offset) % cycle) + cycle) % cycle
  const y = sc.y + sc.wiggle * Math.sin(t * 1.3 + sc.offset)
  if (tau < sweep) return { x: -SWEEP_PAD + sc.speed * tau, y, dir: 1 }
  if (tau < sweep + sc.pause) return null
  if (tau < 2 * sweep + sc.pause)
    return { x: W + SWEEP_PAD - sc.speed * (tau - sweep - sc.pause), y, dir: -1 }
  return null
}

/** Every visible piranha's position at time t (the school's leader and followers). */
export function fishAt(
  schools: readonly School[],
  t: number,
): { x: number; y: number; dir: 1 | -1 }[] {
  const out: { x: number; y: number; dir: 1 | -1 }[] = []
  for (const sc of schools) {
    const lead = leaderAt(sc, t)
    if (!lead) continue
    for (let i = 0; i < FISH; i++) {
      // Followers trail behind the leader, opposite to its heading.
      out.push({
        x: lead.x - lead.dir * FISH_GAP * i,
        y: lead.y + 8 * Math.sin(t * 6 + i),
        dir: lead.dir,
      })
    }
  }
  return out
}

/** Is a point in the river band? */
export function inRiver(y: number): boolean {
  return y > RIVER_TOP && y < RIVER_BOT
}

/** Did the swimmer just reach its far bank (y, for its side)? */
export function atFar(side: Side, y: number): boolean {
  return side === 0 ? y < RIVER_TOP : y > RIVER_BOT
}

/** Is the swimmer back on its own bank? */
export function atHome(side: Side, y: number): boolean {
  return side === 0 ? y > RIVER_BOT : y < RIVER_TOP
}

/** Advance the river one step. `drives[side]` is the joystick vector (|v| ≤ 1) or null. */
export function stepWorld(
  w: World,
  dt: number,
  drives: readonly [{ x: number; y: number } | null, { x: number; y: number } | null],
  ev: Ev[],
): void {
  w.t += dt
  for (const side of [0, 1] as Side[]) {
    const s = w.swim[side]
    const d = drives[side]
    if (s.stunT < 0 || w.t >= s.stunT) {
      s.stunT = -1
      if (d) {
        const m = Math.min(1, Math.hypot(d.x, d.y))
        if (m > 0.06) {
          const k = Math.hypot(d.x, d.y) || 1
          s.x += (d.x / k) * SPEED * m * dt
          s.y += (d.y / k) * SPEED * m * dt
        }
      }
      s.x = Math.max(EDGE_PAD, Math.min(W - EDGE_PAD, s.x))
      s.y = Math.max(40, Math.min(H - 40, s.y))
    }

    if (s.phase === 0 && atFar(side, s.y)) {
      s.phase = 1
      ev.push({ k: 'far', side, x: s.x, y: s.y })
    } else if (s.phase === 1 && atHome(side, s.y)) {
      s.phase = 0
      s.crossings++
      ev.push({ k: 'cross', side, x: s.x, y: s.y })
    }

    // Bites: only in the water. A bite sends the swimmer back to their bank.
    if (inRiver(s.y) && s.stunT < 0) {
      for (const f of fishAt(w.schools, w.t)) {
        if (Math.hypot(f.x - s.x, f.y - s.y) < BITE_R) {
          ev.push({ k: 'bite', side, x: s.x, y: s.y })
          s.bites++
          s.phase = 0
          const h = HOME[side] as { x: number; y: number }
          s.x = h.x
          s.y = h.y
          s.stunT = w.t + STUN
          break
        }
      }
    }
  }
}

/** Most crossings in the time wins; equal is a draw. */
export function winnerOf(w: World): Side | 'draw' {
  const [a, b] = w.swim
  if (a.crossings === b.crossings) return 'draw'
  return a.crossings > b.crossings ? 0 : 1
}
