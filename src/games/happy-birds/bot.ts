import type { Difficulty } from '../../core/game.ts'
import { hash01 } from '../../engines/runner/index.ts'
import { BIRD_R, BIRD_X, FLAP, GRAVITY, nextPipe, pipe, type Bird } from './rules.ts'

const NOISE: Record<Difficulty, number> = { easy: 0.3, normal: 0.16, hard: 0.02 }
/** Share of pipes where the bot misjudges badly. */
const LAPSE: Record<Difficulty, number> = { easy: 0.09, normal: 0.025, hard: 0 }
/** Seconds the bot looks ahead: a long horizon makes it flap too early and clip the top. */
const LOOK: Record<Difficulty, number> = { easy: 0.08, normal: 0.045, hard: 0.025 }
/** Height gained by one flap from a standstill. */
const RISE = (FLAP * FLAP) / (2 * GRAVITY)

function wobbleFor(own: number, i: number, gapH: number, d: Difficulty): number {
  return (hash01(own ^ 0x5eed, i, 3) * 2 - 1) * NOISE[d] * gapH * 0.5
}

/**
 * Keep the bird bouncing around its aim point in the next gap: flap whenever it
 * sinks half a flap below it. The aim point wanders per pipe by difficulty, so
 * easy birds clip pipes and hard ones rarely do.
 */
export function shouldFlap(seed: number, b: Bird, now: number, d: Difficulty, salt = 0): boolean {
  const own = seed ^ salt
  if (!b.alive || now - b.flapAt < 0.14) return false
  const p = nextPipe(seed, b.dist)
  // A lapse: on some pipes the bot simply stops paying attention.
  if (p.i >= 3 && hash01(own ^ 0x1a95e, p.i, 5) < LAPSE[d] && p.x - b.dist - BIRD_X < 120)
    return false
  let aim: number
  if (p.x - BIRD_R <= b.dist + BIRD_X) {
    // Inside a pipe: get as close as the walls allow to the gap after it.
    const n = pipe(seed, p.i + 1)
    const wobble = wobbleFor(own, n.i, n.gapH, d)
    aim = Math.max(
      p.gapY - p.gapH / 2 + BIRD_R + RISE * 0.5,
      Math.min(p.gapY + p.gapH / 2 - BIRD_R - RISE / 2 - 12, n.gapY + wobble),
    )
  } else {
    const wobble = wobbleFor(own, p.i, p.gapH, d)
    aim = p.gapY + wobble
  }
  const future = b.y + b.vy * LOOK[d]
  if (future <= aim + RISE / 2) return false
  // Never flap into the top of the gap (except to save it from the ground).
  const top = p.gapY - p.gapH / 2
  if (b.y - RISE < top + BIRD_R + 6 && b.y < p.gapY + p.gapH / 2 - BIRD_R) return false
  return true
}
