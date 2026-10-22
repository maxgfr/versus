import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import {
  FRAME,
  LANE,
  type Lane,
  MAX_SPEED,
  MIN_SPEED,
  rollOver,
  START_X,
  stepRoll,
  throwBall,
} from './rules.ts'

export interface Throw {
  dx: number
  dy: number
  speed: number
  curve: number
  /** Release point on the foul line (lane x). */
  x: number
}

interface Tune {
  /** How many candidate throws it tries on a practice lane before bowling. */
  plans: number
  /** Aim error at the pins (world units, ±), speed error (±), hook error (±). */
  aim: number
  speed: number
  curve: number
}

export const TUNE: Record<Difficulty, Tune> = {
  easy: { plans: 4, aim: 120, speed: 300, curve: 0.35 },
  normal: { plans: 14, aim: 46, speed: 140, curve: 0.15 },
  hard: { plans: 40, aim: 14, speed: 50, curve: 0.05 },
}

/** Every throw the bot knows: release points × targets × hooks × speeds. */
function catalogue(): Throw[] {
  const out: Throw[] = []
  for (const speed of [2100, 1600])
    for (const curve of [0, -0.5, 0.5])
      for (const x of [LANE.cx, LANE.cx - 120, LANE.cx + 120, START_X[0], START_X[1]])
        for (const tx of [-90, -46, 0, 46, 90]) {
          // Aim so the hooked path still crosses the pins near `tx`.
          const ty = LANE.pinY + 30
          out.push({ dx: LANE.cx + tx - x, dy: ty - LANE.ballY, speed, curve, x })
        }
  return out
}
const ALL = catalogue()

/** Pins a throw knocks down on a copy of the lane (the real physics, no luck involved). */
export function trial(lane: Lane, t: Throw): number {
  const copy = JSON.parse(JSON.stringify(lane)) as Lane
  throwBall(copy, t.dx, t.dy, t.speed, t.curve, 0, t.x)
  let clock = 0
  while (!rollOver(copy, clock)) {
    stepRoll(copy, FRAME)
    clock += FRAME
  }
  return copy.pins.filter((p) => p.down).length
}

/**
 * Practise a few throws on a copy of the lane (as the pins stand now), keep the
 * one that knocks down the most, then bowl it with the hand of the difficulty:
 * the hard bot tries many plans and barely wobbles, the easy one tries a few
 * and its arm shakes.
 */
export function choose(d: Difficulty, rng: Rng, lane: Lane): Throw {
  const tune = TUNE[d]
  let best: Throw | null = null
  let bestN = -1
  const n = Math.min(tune.plans, ALL.length)
  // A seeded sample of the catalogue, always including a plain pocket shot.
  const start = rng.int(0, ALL.length - 1)
  const stride = Math.max(1, Math.floor(ALL.length / n))
  for (let i = 0; i < n; i++) {
    const t = ALL[(start + i * stride) % ALL.length] as Throw
    const k = trial(lane, t)
    if (k > bestN) {
      bestN = k
      best = t
    }
  }
  const plan = best ?? (ALL[0] as Throw)
  const len = Math.hypot(plan.dx, plan.dy) || 1
  // Aim error at the pins turns into a direction error from the foul line.
  const err = ((rng.next() - 0.5) * 2 * tune.aim) / len
  const c = Math.cos(err)
  const s = Math.sin(err)
  return {
    dx: plan.dx * c - plan.dy * s,
    dy: plan.dx * s + plan.dy * c,
    speed: Math.min(
      MAX_SPEED,
      Math.max(MIN_SPEED, plan.speed + (rng.next() - 0.5) * 2 * tune.speed),
    ),
    curve: plan.curve + (rng.next() - 0.5) * 2 * tune.curve,
    x: plan.x,
  }
}
