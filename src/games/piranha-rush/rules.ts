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
/**
 * A stroke: flick the stick from rest to full in a blink and the swimmer
 * surges (speed × (1 + DASH_BOOST), fading over DASH_TIME). Holding the stick
 * down does not repeat it: let it come back and flick again, after DASH_COOL.
 */
export const DASH_BOOST = 0.9
export const DASH_TIME = 0.45
export const DASH_COOL = 1.3
/** Rest-to-full within this long counts as a flick (s). */
export const FLICK = 0.16

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
  /** Stick magnitude last step, when it was last near rest, and the last stroke (world time). */
  mag: number
  lowAt: number
  dashAt: number
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
  /** World time the school joins the river (later schools make the end of a match busier). */
  from?: number
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
  | { k: 'dash'; side: Side; x: number; y: number }

/**
 * Schools for a match: a few lanes through the river, each on its own rhythm.
 * Two quicker schools join at 40% and 70% of the match (`total` seconds), so
 * the water gets busier as the clock runs down.
 */
export function schoolsFor(rng: Rng, total = 60): School[] {
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
  for (const [k, at] of [
    [0.25, 0.4],
    [0.75, 0.7],
  ] as const) {
    const speed = rng.range(270, 340)
    const sweep = (W + 2 * SWEEP_PAD) / speed
    const pause = rng.range(1.4, 2.4)
    const from = total * at
    const cycle = 2 * (sweep + pause)
    out.push({
      y: RIVER_TOP + 80 + k * (RIVER_BOT - RIVER_TOP - 160) + rng.range(-15, 15),
      wiggle: rng.range(10, 30),
      speed,
      // Enter from off the table at `from`, never mid-river.
      offset: (((-from % cycle) + cycle) % cycle) + 1e-3,
      pause,
      from,
    })
  }
  return out
}

export function newSwimmer(side: Side): Swimmer {
  const h = HOME[side] as { x: number; y: number }
  return {
    side,
    x: h.x,
    y: h.y,
    phase: 0,
    stunT: -1,
    crossings: 0,
    bites: 0,
    mag: 0,
    lowAt: 0,
    dashAt: -9,
  }
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
    if (sc.from !== undefined && t < sc.from) continue
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

/** Speed multiplier from the swimmer's last stroke at time t. */
export function surge(s: Swimmer, t: number): number {
  return 1 + DASH_BOOST * Math.max(0, 1 - (t - s.dashAt) / DASH_TIME)
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
      const m = d ? Math.min(1, Math.hypot(d.x, d.y)) : 0
      // A flick from rest to full is a stroke.
      if (m >= 0.9 && s.mag < 0.9 && w.t - s.lowAt <= FLICK && w.t - s.dashAt >= DASH_COOL) {
        s.dashAt = w.t
        ev.push({ k: 'dash', side, x: s.x, y: s.y })
      }
      if (m < 0.3) s.lowAt = w.t
      s.mag = m
      if (d && m > 0.06) {
        const k = Math.hypot(d.x, d.y) || 1
        const v = SPEED * m * surge(s, w.t)
        s.x += (d.x / k) * v * dt
        s.y += (d.y / k) * v * dt
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
          s.mag = 0
          s.dashAt = -9
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
