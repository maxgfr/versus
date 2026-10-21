import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Cmd,
  type Hippo,
  HOLD,
  LUNGE_OUT,
  MARBLE_R,
  MOUTH_R,
  REACH,
  type World,
} from './rules.ts'

interface Tuning {
  /** Seconds between seeing a marble in reach and lunging at it. */
  react: number
  /** Aim error of the tap (world units). */
  err: number
  /** How much of the marble's motion during the lunge the bot allows for (0 = none). */
  lead: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 0.8, err: 150, lead: 0 },
  normal: { react: 0.35, err: 70, lead: 0.6 },
  hard: { react: 0.1, err: 10, lead: 1 },
}

/** Per-bot memory carried between steps (not synced). */
export interface BotMemory {
  wait: number
}

export const newMemory = (): BotMemory => ({ wait: 0.3 })

/** The marble the hippo should go for: in front, within reach, nearest its sweet spot. */
export function pickMarble(w: World, h: Hippo, lead = 0): { x: number; y: number } | null {
  const spot = { x: h.bx, y: h.by + h.fy * REACH * 0.75 }
  let best: { x: number; y: number } | null = null
  let bd = Infinity
  // Where each marble will be when the jaws arrive.
  const ahead = lead * (LUNGE_OUT + HOLD * 0.5)
  for (const m0 of w.marbles) {
    const m = { x: m0.x + m0.vx * ahead, y: m0.y + m0.vy * ahead }
    const dx = m.x - h.bx
    const dy = m.y - h.by
    const d = Math.hypot(dx, dy)
    if (d > REACH + MOUTH_R + MARBLE_R || d < 1) continue
    // Only marbles in front of the hippo; a lunge sideways would miss.
    if ((dy / d) * h.fy < 0.35) continue
    const k = Math.hypot(m.x - spot.x, m.y - spot.y)
    if (k < bd) {
      bd = k
      best = { x: m.x, y: m.y }
    }
  }
  return best
}

/** One step of the computer's hippo: wait out its reaction, then lunge at a marble in reach. */
export function decide(
  w: World,
  side: Side,
  d: Difficulty,
  rng: Rng,
  mem: BotMemory,
  dt: number,
): Cmd {
  const t = TUNING[d]
  const h = w.hippos[side]
  const target = pickMarble(w, h, t.lead)
  if (!target) {
    mem.wait = t.react
    return { tap: null }
  }
  mem.wait -= dt
  if (mem.wait > 0 || h.phase !== 'rest' || h.cool > 0) return { tap: null }
  mem.wait = t.react * (0.7 + rng.next() * 0.6)
  const ex = (rng.next() - 0.5) * 2 * t.err
  const ey = (rng.next() - 0.5) * 2 * t.err
  return { tap: { x: target.x + ex, y: target.y + ey } }
}
