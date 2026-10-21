import type { Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Light Fingers. Everything is in the shared table: one gem
 * pile in the middle, a guard asleep on top of it, and a bag for each thief.
 *
 * Positions are given in the thief's own frame (red's view: the pile's front
 * edge is at y > MID), so the same zone test serves both players.
 */

/** Match length, seconds. */
export const LIMIT = 40
/** Gems dragged per second while a finger is on your part of the pile. */
export const DRAG_RATE = 4
/** Warning before the guard wakes: eyes flicker, "hmm?". */
export const STIR = 1
/** How long the guard stays awake. */
export const AWAKE = 1.6
export const PILE_START = 300
/** World midline (local frame centre of the table). */
const MID = 900

/** Where a thief's finger counts as "on the pile" (in that thief's frame). */
export const ZONE = { x0: 130, x1: 870, y0: MID + 60, y1: MID + 460 }

export type GuardPhase = 'sleep' | 'stir' | 'awake'

export interface Guard {
  phase: GuardPhase
  /** Seconds left in the current phase. */
  left: number
  /** Times the guard has woken; later naps are shorter. */
  wakes: number
}

export interface Thief {
  /** Banked gems. */
  bag: number
  /** Gems dragged during this hold; only safe once banked by a release. */
  stash: number
  /** Fraction of a gem toward the next one. */
  acc: number
  holding: boolean
  /** Game time of the last bank, for the bag's bounce. */
  bankedAt: number
  /** Gems in the last bank, for the flight into the bag. */
  lastBank: number
  /** Game time the finger last went down or up, for the reach tween. */
  heldAt: number
  /** Game time the guard last caught this thief (-10 = never). */
  caughtAt: number
  /** Gems lost in that catch. */
  lost: number
}

export interface Table {
  /** Gems still on the table. */
  pile: number
  guard: Guard
  thieves: [Thief, Thief]
}

export type Ev =
  | { k: 'grab'; side: Side }
  | { k: 'drag'; side: Side }
  | { k: 'bank'; side: Side; n: number }
  | { k: 'caught'; side: Side; n: number }
  | { k: 'stir' }
  | { k: 'wake' }
  | { k: 'sleep' }

const thief = (): Thief => ({
  bag: 0,
  stash: 0,
  acc: 0,
  holding: false,
  bankedAt: -10,
  lastBank: 0,
  heldAt: -10,
  caughtAt: -10,
  lost: 0,
})

/** Length of a nap. Naps shorten as the guard wakes more often. */
export function napLength(wakes: number, rng: Rng): number {
  const lo = Math.max(1.4, 3 - wakes * 0.2)
  const hi = Math.max(2.2, 4.6 - wakes * 0.3)
  return rng.range(lo, hi)
}

export function tableNew(rng: Rng): Table {
  return {
    pile: PILE_START,
    guard: { phase: 'sleep', left: rng.range(2, 3.4), wakes: 0 },
    thieves: [thief(), thief()],
  }
}

/** Is a point (already in the thief's frame) on the pile? */
export function inZone(x: number, y: number): boolean {
  return x >= ZONE.x0 && x <= ZONE.x1 && y >= ZONE.y0 && y <= ZONE.y1
}

/** Advance the guard. Returns the transition this step, if any. */
export function guardStep(g: Guard, dt: number, rng: Rng): 'stir' | 'wake' | 'sleep' | null {
  g.left -= dt
  if (g.left > 0) return null
  if (g.phase === 'sleep') {
    g.phase = 'stir'
    g.left = STIR
    return 'stir'
  }
  if (g.phase === 'stir') {
    g.phase = 'awake'
    g.left = AWAKE
    g.wakes++
    return 'wake'
  }
  g.phase = 'sleep'
  g.left = napLength(g.wakes, rng)
  return 'sleep'
}

/** What a thief sees on the table: banked plus what is still in hand. */
export function shownGems(t: Table, side: Side): number {
  return t.thieves[side].bag + t.thieves[side].stash
}

/**
 * One fixed step of the table. `holds` says which thieves have a finger on
 * their part of the pile. Returns the events the game turns into juice.
 */
export function tableStep(
  t: Table,
  dt: number,
  time: number,
  holds: [boolean, boolean],
  rng: Rng,
): Ev[] {
  const out: Ev[] = []
  const tr = guardStep(t.guard, dt, rng)
  if (tr === 'stir') out.push({ k: 'stir' })
  if (tr === 'sleep') out.push({ k: 'sleep' })
  if (tr === 'wake') {
    out.push({ k: 'wake' })
    // Anyone still holding when the guard opens his eyes loses the stash.
    for (const side of [0, 1] as Side[]) {
      const th = t.thieves[side]
      if (holds[side] && th.stash > 0) {
        out.push({ k: 'caught', side, n: th.stash })
        th.caughtAt = time
        th.lost = th.stash
        t.pile += th.stash
        th.stash = 0
        th.acc = 0
      }
    }
  }
  const awake = t.guard.phase === 'awake'
  for (const side of [0, 1] as Side[]) {
    const th = t.thieves[side]
    const h = holds[side]
    if (h && !th.holding) out.push({ k: 'grab', side })
    if (!h && th.holding && th.stash > 0) {
      out.push({ k: 'bank', side, n: th.stash })
      th.bag += th.stash
      th.lastBank = th.stash
      th.stash = 0
      th.acc = 0
      th.bankedAt = time
    }
    if (h !== th.holding) th.heldAt = time
    th.holding = h
    if (h && !awake && t.pile > 0) {
      th.acc += DRAG_RATE * dt
      // The epsilon keeps 60 steps of 4 gems/s from losing a gem to rounding.
      while (th.acc >= 1 - 1e-9 && t.pile > 0) {
        th.acc -= 1
        t.pile--
        th.stash++
        out.push({ k: 'drag', side })
      }
      if (t.pile === 0) th.acc = 0
    }
  }
  return out
}

/** Bank every stash (the match ended with fingers still on the pile). */
export function bankAll(t: Table, time: number): Ev[] {
  const out: Ev[] = []
  for (const side of [0, 1] as Side[]) {
    const th = t.thieves[side]
    th.holding = false
    if (th.stash <= 0) continue
    out.push({ k: 'bank', side, n: th.stash })
    th.bag += th.stash
    th.lastBank = th.stash
    th.stash = 0
    th.acc = 0
    th.bankedAt = time
    th.heldAt = time
  }
  return out
}

/** Most gems banked wins; equal bags draw. Call after `bankAll`. */
export function winnerOf(t: Table): Side | 'draw' {
  const a = t.thieves[0].bag
  const b = t.thieves[1].bag
  if (a === b) return 'draw'
  return a > b ? 0 : 1
}
