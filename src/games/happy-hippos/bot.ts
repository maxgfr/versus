import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  type Cmd,
  HEAD_R,
  type Hippo,
  HOLD,
  MOUTH_AT,
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
  /** How far into the edge of its reach it dares to bite (0..1 of the catch radius). */
  edge: number
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { react: 1.1, err: 210, lead: 0, edge: 0.3 },
  normal: { react: 0.3, err: 60, lead: 0.7, edge: 0.5 },
  hard: { react: 0.07, err: 6, lead: 1, edge: 0.95 },
}

/** Per-bot memory carried between steps (not synced). */
export interface BotMemory {
  wait: number
}

export const newMemory = (): BotMemory => ({ wait: 0.3 })

/** The farthest the mouth can land from the hippo's base. */
const MOUTH_REACH = REACH + HEAD_R * MOUTH_AT

/**
 * The point the hippo should bite: a marble in front and within reach, where
 * it will be when the jaws arrive (`lead` = how much of that motion it allows
 * for). With `greedy`, a bite that takes several marbles beats a lone one.
 */
export function pickMarble(
  w: World,
  h: Hippo,
  lead = 0,
  greedy = false,
  edge = 0.6,
  patient = false,
): { x: number; y: number } | null {
  const spot = { x: h.bx, y: h.by + h.fy * MOUTH_REACH * 0.75 }
  let best: { x: number; y: number } | null = null
  let bd = Infinity
  const ahead = lead * (LUNGE_OUT + HOLD * 0.5)
  const at = w.marbles.map((m0) => ({ x: m0.x + m0.vx * ahead, y: m0.y + m0.vy * ahead }))
  const catchR = MOUTH_R + MARBLE_R
  for (let i = 0; i < at.length; i++) {
    const m = at[i] as { x: number; y: number }
    const m0 = w.marbles[i]
    const dx = m.x - h.bx
    const dy = m.y - h.by
    const d = Math.hypot(dx, dy)
    if (d > MOUTH_REACH + catchR * edge || d < 1) continue
    // Only marbles in front of the hippo; a lunge sideways would miss.
    if ((dy / d) * h.fy < 0.35) continue
    // A patient player lets a marble rolling in come closer before biting: an
    // edge-of-reach bite now would waste the whole lunge cycle.
    if (patient && m0 && d > MOUTH_REACH * 0.8) {
      const radial = (m0.vx * dx + m0.vy * dy) / d
      if (radial < -60) continue
    }
    let k = Math.hypot(m.x - spot.x, m.y - spot.y)
    if (greedy) {
      let n = 0
      for (const o of at) if (Math.hypot(o.x - m.x, o.y - m.y) < catchR) n++
      k -= (n - 1) * 400
    }
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
  const target = pickMarble(w, h, t.lead, d !== 'easy', t.edge, d === 'hard')
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
