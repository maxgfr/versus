import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { LANE } from './rules.ts'

interface Pt {
  x: number
  y: number
}

export interface Throw {
  dx: number
  dy: number
  speed: number
  curve: number
}

/** How far a bot's aim (world units at the headpin) and speed (world units / s) wander. */
const TUNE: Record<Difficulty, { aim: number; speed: number }> = {
  easy: { aim: 150, speed: 260 },
  normal: { aim: 70, speed: 130 },
  hard: { aim: 20, speed: 40 },
}

/**
 * A throw at the pocket beside the headpin, with the error of the difficulty.
 * On a second roll (`standing` given and not a full rack) it aims at the middle
 * of the pins still up instead, to pick up the spare.
 */
export function choose(d: Difficulty, rng: Rng, standing?: readonly Pt[]): Throw {
  const tune = TUNE[d]
  const side = rng.chance(0.5) ? 1 : -1
  let tx = LANE.cx + side * 46
  let ty = LANE.pinY + 40
  if (standing && standing.length > 0 && standing.length < 10) {
    tx = standing.reduce((a, p) => a + p.x, 0) / standing.length
    ty = Math.max(...standing.map((p) => p.y))
  }
  tx += (rng.next() - 0.5) * 2 * tune.aim
  return {
    dx: tx - LANE.cx,
    dy: ty - LANE.ballY,
    speed: 1500 + (rng.next() - 0.5) * 2 * tune.speed,
    curve: 0,
  }
}
