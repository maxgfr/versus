import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { type Deal, type Dst, destinationFor, pickable, reveals, type Src } from './rules.ts'

/** Seconds between the computer's actions (a play or a draw). */
export const PACE: Record<Difficulty, number> = { easy: 1.4, normal: 0.9, hard: 0.5 }

/** Random score added to each option: easier computers choose less well. */
const NOISE: Record<Difficulty, number> = { easy: 45, normal: 12, hard: 0 }

export type Action = { kind: 'draw' } | { kind: 'play'; src: Src; dst: Dst }

/**
 * The computer's next action. Foundation plays first, then plays that turn a
 * hidden card face up, then waste plays, then other column moves. Turning the
 * stock is worth a little, so the waste keeps moving. Null when there is nothing left to do.
 */
export function chooseAction(d: Deal, level: Difficulty, rng: Rng): Action | null {
  let best: Action | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const src of pickable(d)) {
    const dst = destinationFor(d, src)
    if (!dst) continue
    const base = dst.to === 'found' ? 100 : reveals(d, src) ? 60 : src.from === 'waste' ? 40 : 8
    const score = base + rng.range(0, NOISE[level])
    if (score > bestScore) {
      bestScore = score
      best = { kind: 'play', src, dst }
    }
  }
  if (d.stock.length || d.waste.length) {
    const score = 10 + rng.range(0, NOISE[level])
    if (score > bestScore) best = { kind: 'draw' }
  }
  return best
}
