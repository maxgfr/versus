import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BLOB_R, inZone, type World, ZONE_R } from './rules.ts'

interface Tuning {
  /** Seconds between re-aiming (the bot tracks with this lag). */
  react: number
  /** Aim error (world units). */
  err: number
  /** Seconds before a telegraphed hop it starts heading for the next spot (0 = never). */
  early: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.5, err: 90, early: 0 },
  normal: { react: 0.16, err: 30, early: 0.6 },
  hard: { react: 0.07, err: 8, early: 1.3 },
}

/** Per-bot memory carried between steps (not synced). */
export interface BotMemory {
  wait: number
  aim: { x: number; y: number } | null
}

export const newMemory = (): BotMemory => ({ wait: 0, aim: null })

/**
 * Where the blob of `side` should steer. Alone in the zone it holds the middle;
 * when the rival holds it, it lines up on the zone side of the rival and shoves
 * it out; with nobody in the zone it rushes there. Works for either side.
 */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): { x: number; y: number } {
  const tune = TUNING[d]
  mem.wait -= dt
  if (mem.wait <= 0 || !mem.aim) {
    mem.wait = tune.react * (0.7 + rng.next() * 0.6)
    mem.aim = aimFor(w, side, rng, tune)
  }
  return mem.aim ?? { x: w.zone.x, y: w.zone.y }
}

function aimFor(w: World, side: Side, rng: Rng, tune: Tuning): { x: number; y: number } {
  const me = w.blobs[side]
  const foe = w.blobs[side === 0 ? 1 : 0]
  const noise = (): number => (rng.next() - 0.5) * 2 * tune.err
  // The next spot is telegraphed: a sharp player is already on its way when the crown hops.
  // (Never while it holds the crown alone: those are free seconds.)
  const holding = inZone(me, w.zone) && !inZone(foe, w.zone)
  const z = w.next && w.zone.t < tune.early && !holding ? { x: w.next.x, y: w.next.y } : w.zone
  const inMe = inZone(me, z)
  const inFoe = inZone(foe, z)
  if (inMe && !inFoe) {
    // Hold the middle of the crown, drifting a little.
    const a = w.t * 0.6 + side * Math.PI
    return { x: z.x + Math.cos(a) * 50 + noise(), y: z.y + Math.sin(a) * 50 + noise() }
  }
  if (inFoe) {
    // Shove the rival out: get on the crown's side of it, then drive outward.
    const ox = foe.x - z.x
    const oy = foe.y - z.y
    const od = Math.hypot(ox, oy) || 1
    const ux = ox / od
    const uy = oy / od
    const onZoneSide = (me.x - foe.x) * ux + (me.y - foe.y) * uy < 0
    if (!onZoneSide) {
      // Circle round to the crown side of the rival.
      return { x: foe.x - ux * BLOB_R * 2.4 + noise(), y: foe.y - uy * BLOB_R * 2.4 + noise() }
    }
    // Drive through the rival, outward from the crown.
    return { x: foe.x + ux * BLOB_R * 3 + noise(), y: foe.y + uy * BLOB_R * 3 + noise() }
  }
  // Nobody holds the crown: rush to it, stopping just inside the rim.
  const dz = Math.hypot(me.x - z.x, me.y - z.y) || 1
  const k = Math.max(0, 1 - (ZONE_R * 0.5) / dz)
  return { x: me.x + (z.x - me.x) * k + noise(), y: me.y + (z.y - me.y) * k + noise() }
}
