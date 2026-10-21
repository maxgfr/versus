import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { H, W } from '../../core/stage.ts'

/**
 * Stampede: herds of big animals thunder across the whole arena, from the
 * edges, in waves. Each wave is announced by warning arrows at the edge it will
 * enter from, a beat before the first animal arrives. Each player's blob dodges
 * with a joystick; a hit costs a heart. Three hearts each; the last one standing
 * takes the round. Pure logic: no DOM, no canvas, no Math.random.
 */

export const BLOB_R = 36
export const SPEED = 330
/** Hit distance between a blob and an animal (both radii). */
export const HIT_D = 86
/** Spacing between animals of one herd, and the distance off the table they start from. */
export const GAP = 124
export const EXIT_PAD = 140
/** Seconds of warning arrows before a herd enters. */
export const WARN = 1.3
/** Seconds of blinking invulnerability after a hit. */
export const INVULN = 1.2
export const LIVES = 3
/** Blobs keep this far from the side edges (clear of the pause button at the left). */
export const EDGE_PAD = 110

export interface Herd {
  id: number
  /** 0 = runs along x (in from the left or right), 1 = runs along y (from the top or bottom). */
  axis: 0 | 1
  /** The lane: y for an x-running herd, x for a y-running one. */
  lane: number
  dir: 1 | -1
  /** World time the leading animal enters (the warning shows until then). */
  t0: number
  v: number
  n: number
  /** Index into the animal emoji list. */
  kind: number
}

export interface Driver {
  x: number
  y: number
  lives: number
  invT: number
  hitT: number
  out: boolean
}

export interface World {
  /** World seconds since the round began. */
  rt: number
  /** When the next wave is announced. */
  nextWaveT: number
  waves: number
  herds: Herd[]
  drivers: [Driver, Driver]
  nextId: number
  /** World time before which the blobs' next bump makes no sound. */
  bumpT: number
}

export type Ev =
  | { k: 'hit'; side: Side; x: number; y: number }
  | { k: 'out'; side: Side; x: number; y: number }
  | { k: 'warn'; axis: 0 | 1; lane: number; dir: 1 | -1 }
  | { k: 'enter'; axis: 0 | 1; lane: number; dir: 1 | -1 }
  | { k: 'dust'; x: number; y: number }
  | { k: 'bump'; x: number; y: number }

/** The start position of a side's blob: red at the bottom, blue at the top. */
export const START: readonly { x: number; y: number }[] = [
  { x: 500, y: 1400 },
  { x: 500, y: 400 },
]

export function newDriver(side: Side): Driver {
  const s = START[side] as { x: number; y: number }
  return { x: s.x, y: s.y, lives: LIVES, invT: -1, hitT: -9, out: false }
}

export function newWorld(): World {
  return {
    rt: 0,
    nextWaveT: 1.4,
    waves: 0,
    herds: [],
    drivers: [newDriver(0), newDriver(1)],
    nextId: 1,
    bumpT: 0,
  }
}

/** Herd speed (units/s) at round time rt: ramps up and caps. */
export function herdSpeed(rt: number): number {
  return Math.min(600, 340 + 6 * rt)
}

/** Animals per herd at round time rt: grows over time. */
export function herdSize(rt: number): number {
  return Math.min(6, 2 + Math.floor(rt / 8))
}

/** Seconds between waves at round time rt (before jitter). */
export function waveGap(rt: number): number {
  return Math.max(0.7, 1.7 - 0.02 * rt)
}

/** Along-the-axis coordinate of animal i of a herd at time t. */
export function along(h: Herd, i: number, t: number): number {
  const start = h.dir > 0 ? -EXIT_PAD : (h.axis === 0 ? W : H) + EXIT_PAD
  return start + h.dir * (h.v * (t - h.t0) - i * GAP)
}

/** World position of animal i. */
export function animalAt(h: Herd, i: number, t: number): { x: number; y: number } {
  const a = along(h, i, t)
  return h.axis === 0 ? { x: a, y: h.lane } : { x: h.lane, y: a }
}

/** Has every animal of this herd run off the far side? */
export function herdGone(h: Herd, t: number): boolean {
  const last = along(h, h.n - 1, t)
  const extent = h.axis === 0 ? W : H
  return h.dir > 0 ? last > extent + EXIT_PAD : last < -EXIT_PAD
}

/** Announce one wave: one herd from a random edge, sometimes a second from the far side. */
function announce(w: World, rng: Rng, ev: Ev[]): void {
  const count = w.rt > 14 && rng.chance(0.3) ? 2 : 1
  for (let k = 0; k < count; k++) {
    const axis = rng.chance(0.5) ? 0 : 1
    const dir = rng.sign()
    const lane = axis === 0 ? rng.range(230, H - 230) : rng.range(120, W - 120)
    const h: Herd = {
      id: w.nextId++,
      axis,
      lane,
      dir,
      t0: w.rt + WARN + k * 0.35,
      v: herdSpeed(w.rt) * rng.range(0.92, 1.08),
      n: herdSize(w.rt),
      kind: rng.int(0, 2),
    }
    w.herds.push(h)
    ev.push({ k: 'warn', axis, lane, dir })
  }
  w.waves++
}

/**
 * Advance the round one step. `drives[side]` is the joystick vector (|v| ≤ 1)
 * or null. Events are appended to `ev`.
 */
export function stepWorld(
  w: World,
  dt: number,
  drives: readonly [{ x: number; y: number } | null, { x: number; y: number } | null],
  rng: Rng,
  ev: Ev[],
  /** False once the match is decided: herds keep running but no longer hit anyone. */
  collide = true,
): void {
  const prev = w.rt
  w.rt += dt
  if (w.rt >= w.nextWaveT) {
    announce(w, rng, ev)
    w.nextWaveT = w.rt + waveGap(w.rt) * rng.range(0.85, 1.15)
  }

  for (const side of [0, 1] as Side[]) {
    const d = w.drivers[side]
    if (d.out) continue
    const drive = drives[side]
    if (drive) {
      const m = Math.min(1, Math.hypot(drive.x, drive.y))
      if (m > 0.06) {
        const k = Math.hypot(drive.x, drive.y) || 1
        d.x += (drive.x / k) * SPEED * m * dt
        d.y += (drive.y / k) * SPEED * m * dt
      }
    }
    d.x = Math.max(EDGE_PAD, Math.min(W - EDGE_PAD, d.x))
    d.y = Math.max(40, Math.min(H - 40, d.y))
  }

  // The two blobs bump instead of overlapping.
  const [a, b] = w.drivers
  if (!a.out && !b.out) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy)
    if (dist < 2 * BLOB_R) {
      const nx = dist > 0 ? dx / dist : 0
      const ny = dist > 0 ? dy / dist : 1
      const push = (2 * BLOB_R - dist) / 2
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
      for (const d of [a, b]) {
        d.x = Math.max(EDGE_PAD, Math.min(W - EDGE_PAD, d.x))
        d.y = Math.max(40, Math.min(H - 40, d.y))
      }
      if (w.rt >= w.bumpT) {
        w.bumpT = w.rt + 0.6
        ev.push({ k: 'bump', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      }
    }
  }

  for (const h of w.herds) {
    if (prev < h.t0 && w.rt >= h.t0) ev.push({ k: 'enter', axis: h.axis, lane: h.lane, dir: h.dir })
    if (w.rt < h.t0) continue
    if (Math.floor(prev * 4) !== Math.floor(w.rt * 4)) {
      const lead = animalAt(h, 0, w.rt)
      ev.push({ k: 'dust', x: lead.x, y: lead.y })
    }
  }

  for (const side of [0, 1] as Side[]) {
    const d = w.drivers[side]
    if (!collide || d.out || w.rt < d.invT) continue
    hitLoop: for (const h of w.herds) {
      if (w.rt < h.t0) continue
      for (let i = 0; i < h.n; i++) {
        const p = animalAt(h, i, w.rt)
        if (Math.hypot(p.x - d.x, p.y - d.y) < HIT_D) {
          d.lives--
          d.invT = w.rt + INVULN
          d.hitT = w.rt
          ev.push({ k: 'hit', side, x: d.x, y: d.y })
          if (d.lives <= 0) {
            d.out = true
            ev.push({ k: 'out', side, x: d.x, y: d.y })
          }
          break hitLoop
        }
      }
    }
  }

  w.herds = w.herds.filter((h) => !herdGone(h, w.rt))
}

/** The round is decided once someone is out: the other one wins, both out is a draw. */
export function roundOver(w: World): Side | 'draw' | null {
  const [a, b] = w.drivers
  if (!a.out && !b.out) return null
  if (a.out && b.out) return 'draw'
  return a.out ? 1 : 0
}
