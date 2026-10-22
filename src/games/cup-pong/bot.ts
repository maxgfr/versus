import type { Difficulty, Side } from '../../core/game.ts'
import { other } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { jitter, type ShotParams } from '../../engines/aim/index.ts'
import {
  advance,
  CUP_H,
  type Cup,
  fire,
  type Flick,
  landingOf,
  originOf,
  type State,
} from './rules.ts'

/**
 * The computer's flick. Easy picks a cup at random and aims its rim. Normal
 * and hard play each candidate through the real rules (rims, walls, the bounce)
 * and pick the cup and flick that sinks most often under their own hand
 * shake: a cup tucked among others forgives a miss by landing in a neighbour.
 */

const ERR: Record<Difficulty, { angle: number; power: number }> = {
  easy: { angle: 0.05, power: 0.05 },
  normal: { angle: 0.032, power: 0.03 },
  hard: { angle: 0.017, power: 0.016 },
}

/** Which cup (index) a flick takes when played through the rules, or -1. */
export function outcome(s: State, side: Side, shot: Flick): number {
  const c: State = {
    ...s,
    cups: s.cups.map((x) => ({ ...x })),
    ball: null,
    phase: 'aim',
    aiming: null,
  }
  fire(c, side, shot)
  for (let i = 0; i < 400 && c.phase === 'fly'; i++) {
    for (const e of advance(c, 1 / 60).events) if (e.kind === 'cup') return e.cup
  }
  return -1
}

/** The flick (neutral arc) whose ball comes down through rim height on the cup's centre. */
function aimAt(side: Side, cup: { x: number; y: number }, arc: number): Flick {
  const o = originOf(side)
  const dx = cup.x - o.x
  const dy = cup.y - o.y
  const len = Math.hypot(dx, dy)
  const dir = { dx: dx / len, dy: dy / len }
  let lo = 0.2
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const p = (lo + hi) / 2
    const at = landingOf(side, { ...dir, power: p, arc }, CUP_H)
    if (Math.hypot(at.x - o.x, at.y - o.y) < len) lo = p
    else hi = p
  }
  return { ...dir, power: (lo + hi) / 2, arc }
}

/** Share of a 5 × 5 grid of the bot's own errors around `shot` that sinks a cup. */
function catchRate(s: State, side: Side, shot: Flick, d: Difficulty): number {
  const err = ERR[d]
  const a0 = Math.atan2(shot.dy, shot.dx)
  let n = 0
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const a = a0 + (i / 2) * err.angle
      const p = shot.power + (j / 2) * err.power
      if (outcome(s, side, { dx: Math.cos(a), dy: Math.sin(a), power: p, arc: shot.arc }) >= 0) n++
    }
  return n / 25
}

export function choose(s: State, side: Side, d: Difficulty, rng: Rng): Flick {
  const targets = s.cups.filter((c) => c.side === other(side) && c.alive)
  if (targets.length === 0) return { dx: 0, dy: side === 0 ? -1 : 1, power: 0.5 }
  const arc = d === 'easy' ? 1 : 1.1
  let best: Flick
  if (d === 'easy') best = aimAt(side, rng.pick(targets) as Cup, arc)
  else {
    let bestV = -1
    best = aimAt(side, targets[0] as Cup, arc)
    for (const cup of targets) {
      const shot = aimAt(side, cup, arc)
      const v = catchRate(s, side, shot, d) + rng.next() * 0.01
      if (v > bestV) {
        bestV = v
        best = shot
      }
    }
  }
  const j: ShotParams = jitter(best, rng, ERR[d].angle, ERR[d].power)
  return { ...j, arc }
}
