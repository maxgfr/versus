import type { Difficulty, Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import {
  BOARD,
  BULL_PT,
  DOUBLE_IN,
  flickFor,
  gauss,
  OUTER_BULL,
  type Pt,
  scoreAt,
  SEGMENTS,
  TREBLE_IN,
  TREBLE_OUT,
} from './rules.ts'

/** How far the computer's dart lands from its aim, in board units (a gaussian). */
export const SPREAD: Record<Difficulty, number> = { easy: 62, normal: 28, hard: 12 }

/** Release speed the computer throws with: crisp, in the sweet spot (no sag, no extra wobble). */
export const BOT_SPEED = 1300

/**
 * The spots worth aiming at: the bull, and the middle of every treble, double
 * and the two single beds of each segment.
 */
function spots(): Pt[] {
  const out: Pt[] = [BULL_PT]
  const R = BOARD.r
  const radii = [
    (OUTER_BULL + TREBLE_IN) / 2,
    (TREBLE_IN + TREBLE_OUT) / 2,
    (TREBLE_OUT + DOUBLE_IN) / 2,
    (DOUBLE_IN + 1) / 2,
  ]
  for (let i = 0; i < SEGMENTS.length; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 10
    for (const f of radii)
      out.push({ x: BOARD.x + Math.cos(a) * f * R, y: BOARD.y + Math.sin(a) * f * R })
  }
  return out
}

/** Mean score of darts aimed at `p` with a gaussian spread `sigma` (fixed samples, so it is stable). */
export function expected(p: Pt, sigma: number, samples = 600): number {
  const rng = new Rng(0x5eed)
  let sum = 0
  for (let i = 0; i < samples; i++)
    sum += scoreAt({ x: p.x + gauss(rng) * sigma, y: p.y + gauss(rng) * sigma }).pts
  return sum / samples
}

const best = new Map<number, Pt>()

/**
 * Where an arm this steady scores most on average. A steady arm goes for
 * treble 20; a shaky one is better off in the fat middle of the board, where a
 * miss still lands on something.
 */
export function bestAim(sigma: number): Pt {
  const hit = best.get(sigma)
  if (hit) return hit
  let top = BULL_PT
  let topV = -1
  for (const p of spots()) {
    const v = expected(p, sigma, 300)
    if (v > topV) {
      topV = v
      top = p
    }
  }
  best.set(sigma, top)
  return top
}

/** Aim at the best spot for this arm, land with a gaussian error, and turn that into a flick. */
export function choose(side: Side, d: Difficulty, rng: Rng): Pt {
  const sigma = SPREAD[d]
  const aim = bestAim(sigma)
  const target = { x: aim.x + gauss(rng) * sigma, y: aim.y + gauss(rng) * sigma }
  return flickFor(side, target)
}
