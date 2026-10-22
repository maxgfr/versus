import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import {
  BAND_X0,
  BAND_X1,
  BAND_Y,
  type Cmd,
  DRAG,
  gapAt,
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
  /** Shots it weighs before choosing (0 = any puck, any lane, blind). */
  looks: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { cadence: 2.4, noise: 90, power: 0.2, windup: 0.7, looks: 0 },
  normal: { cadence: 1.15, noise: 26, power: 0.07, windup: 0.45, looks: 10 },
  hard: { cadence: 0.7, noise: 8, power: 0.025, windup: 0.32, looks: 40 },
}

/** Distance from point p to segment a-b. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy || 1
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k))
}

/**
 * How open the flight from release spot (x, y) through the gap at tx is for
 * `side` (red frame): 0 when a puck sits in the way, else 1 minus a penalty
 * for pucks waiting just past the gap that would stop it short.
 */
export function laneScore(
  t: Table,
  side: Side,
  idx: number,
  x: number,
  y: number,
  tx: number,
): number {
  const ex = tx + ((tx - x) / (y - MID || 1)) * 420
  const ey = MID - 420
  let score = 1
  t.pucks.forEach((p, i) => {
    if (i === idx || p.held) return
    const l = local(side, p.x, p.y)
    const d = segDist(l.x, l.y, x, y, tx, MID)
    if (d < p.r * 2 - 4) score = 0
    else if (segDist(l.x, l.y, tx, MID, ex, ey) < p.r * 2 - 4) score -= 0.4
  })
  return Math.max(0, score)
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
    const mine: number[] = []
    t.pucks.forEach((p, i) => {
      if (p.half === side && !p.held) mine.push(i)
    })
    // Exponential drag: a shot at speed v covers about v / DRAG. Aim a little past the wall.
    const dist = BAND_Y - MID + 420
    const needed = (dist * DRAG) / SHOT_V
    const pull = Math.min(1, Math.max(0.35, needed)) * MAX_PULL
    const half = gapAt(t) / 2 - PUCK_R * 0.8
    let idx = rng.pick(mine) ?? -1
    let tx = W / 2 + (rng.next() - 0.5) * half
    if (tune.looks > 0) {
      // Weigh shots: an open lane through the gap first, then a short drag to the band.
      let best = -Infinity
      for (let i = 0; i < tune.looks; i++) {
        const j = rng.pick(mine) ?? -1
        const p = t.pucks[j]
        if (!p) continue
        const lx = W / 2 + (rng.next() * 2 - 1) * half
        const end = planRelease(lx, pull)
        const s = local(side, p.x, p.y)
        const v =
          laneScore(t, side, j, end.x, end.y, lx) * 1000 -
          Math.hypot(end.x - s.x, end.y - s.y) * 0.3 -
          Math.abs(lx - W / 2) * 0.4
        if (v > best) {
          best = v
          idx = j
          tx = lx
        }
      }
    }
    const p = t.pucks[idx]
    if (!p) return {}
    const s = local(side, p.x, p.y)
    tx += (rng.next() - 0.5) * 2 * tune.noise
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
