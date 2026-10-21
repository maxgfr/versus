import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import {
  BAND_X0,
  BAND_X1,
  BAND_Y,
  type Cmd,
  DRAG,
  GAP,
  local,
  MAX_PULL,
  owned,
  PUCK_R,
  SHOT_V,
  shotFrom,
  type Table,
} from './rules.ts'

interface Tuning {
  /** Seconds between shots, before the random spread. */
  cadence: number
  /** Lateral aim error at the gap (world units). */
  noise: number
  /** Relative power error. */
  power: number
  /** Seconds spent dragging the puck back onto the band and stretching it. */
  windup: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { cadence: 2.4, noise: 90, power: 0.2, windup: 0.7 },
  normal: { cadence: 1.5, noise: 36, power: 0.09, windup: 0.55 },
  hard: { cadence: 0.9, noise: 12, power: 0.03, windup: 0.4 },
}

/** The bot's plan for the shot it is winding up, in its own (red) frame. */
export interface Plan {
  /** Where the puck was grabbed. */
  sx: number
  sy: number
  /** Where it will be let go (behind the band). */
  ex: number
  ey: number
}

export interface BotMemory {
  cool: number
  wind: number
  plan: Plan | null
}

export const newMemory = (): BotMemory => ({ cool: 0.6, wind: 0, plan: null })

/**
 * Find the spot behind the band that fires toward (tx, MID) with the given
 * stretch: the shot angle only depends on where along the band the puck sits.
 */
export function planRelease(tx: number, pull: number): { x: number; y: number } {
  const y = BAND_Y - PUCK_R + pull
  let best = { x: W / 2, y }
  let err = Infinity
  const lo = BAND_X0 + PUCK_R * 0.6
  const hi = BAND_X1 - PUCK_R * 0.6
  for (let i = 0; i <= 80; i++) {
    const x = lo + ((hi - lo) * i) / 80
    const s = shotFrom(x, y)
    // Where this shot crosses the midline.
    const k = (MID - y) / (s.dy || -1e-6)
    const cx = x + s.dx * k
    const e = Math.abs(cx - tx)
    if (k > 0 && e < err) {
      err = e
      best = { x, y }
    }
  }
  return best
}

/**
 * One step of the computer's shooting: grab one of its pucks, drag it back
 * onto the band and stretch it over `windup` seconds toward a release spot
 * aimed at the gap (with error), then let go. Plays either side.
 */
export function decide(
  t: Table,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Cmd {
  const tune = TUNING[d]
  const aim = t.aims[side]
  if (!aim) {
    mem.plan = null
    mem.cool -= dt
    if (mem.cool > 0 || owned(t, side) === 0) return {}
    // Any of its own pucks, at random: a puck parked far away still gets its turn.
    const mine: number[] = []
    t.pucks.forEach((p, i) => {
      if (p.half === side && !p.held) mine.push(i)
    })
    const idx = rng.pick(mine) ?? -1
    const p = t.pucks[idx]
    if (!p) return {}
    const s = local(side, p.x, p.y)
    const tx = W / 2 + (rng.next() - 0.5) * 2 * tune.noise + (rng.next() - 0.5) * GAP * 0.3
    // Exponential drag: a shot at speed v covers about v / DRAG. Aim a little past the wall.
    const dist = BAND_Y - MID + 420
    const needed = (dist * DRAG) / SHOT_V
    const power = Math.min(1, Math.max(0.35, needed * (1 + (rng.next() - 0.5) * 2 * tune.power)))
    const end = planRelease(tx, power * MAX_PULL)
    mem.plan = { sx: s.x, sy: s.y, ex: end.x, ey: end.y }
    mem.wind = 0
    mem.cool = tune.cadence * (0.8 + rng.next() * 0.4)
    return { grab: { idx, ptr: -1 } }
  }
  const plan = mem.plan
  if (!plan) return { release: true }
  mem.wind += dt
  // Ease the puck from where it was grabbed to the release spot.
  const k = Math.min(1, mem.wind / tune.windup)
  const e = k * k * (3 - 2 * k)
  const f = local(side, plan.sx + (plan.ex - plan.sx) * e, plan.sy + (plan.ey - plan.sy) * e)
  if (mem.wind >= tune.windup + 0.12) return { finger: f, release: true }
  return { finger: f }
}
