import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BLOB_R, inZone, type World, ZONE_R } from './rules.ts'

interface Tuning {
  /** Seconds between re-aiming (the bot tracks with this lag). */
  react: number
  /** Aim error (world units). */
  err: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.5, err: 90 },
  normal: { react: 0.25, err: 40 },
  hard: { react: 0.2, err: 12 },
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
    mem.aim = aimFor(w, side, rng, tune.err)
  }
  return mem.aim ?? { x: w.zone.x, y: w.zone.y }
}

function aimFor(w: World, side: Side, rng: Rng, err: number): { x: number; y: number } {
  const me = w.blobs[side]
  const foe = w.blobs[side === 0 ? 1 : 0]
  const z = w.zone
  const noise = (): number => (rng.next() - 0.5) * 2 * err
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
    return { x: foe.x + ux * BLOB_R * 0.8 + noise(), y: foe.y + uy * BLOB_R * 0.8 + noise() }
  }
  // Nobody holds the crown: rush to it, stopping just inside the rim.
  const dz = Math.hypot(me.x - z.x, me.y - z.y) || 1
  const k = Math.max(0, 1 - (ZONE_R * 0.5) / dz)
  return { x: me.x + (z.x - me.x) * k + noise(), y: me.y + (z.y - me.y) * k + noise() }
}
