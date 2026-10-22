import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOLT_TIME, BOW, hitValue, TAP_PAD, type State, type Target, isAlive } from './rules.ts'

/** How far the bot's tap wanders from a target's centre, by difficulty (world units). */
const ERR: Record<Difficulty, number> = { easy: 84, normal: 42, hard: 16 }

/** Seconds the computer takes to notice a target and tap it. */
export function reaction(d: Difficulty, rng: Rng): number {
  return (d === 'easy' ? 0.95 : d === 'normal' ? 0.46 : 0.3) * rng.range(0.8, 1.25)
}

/**
 * The best live target for this side: the most points it would be worth when
 * the bolt lands (a fresh balloon's bonus included), skipping targets that
 * will be gone by then and those a bolt already in the air (its own, or the
 * rival's, which lands first) will take. The soonest to vanish breaks ties.
 */
export function bestTarget(s: State, _side: Side): Target | undefined {
  const taken = new Set(s.bolts.map((b) => b.target))
  let best: Target | undefined
  let score = -Infinity
  for (const t of s.targets) {
    if (taken.has(t.id) || !isAlive(t, s.now)) continue
    const left = t.born + t.life - s.now
    if (left < BOLT_TIME + 0.12) continue
    const v = hitValue(t, s.now + BOLT_TIME).pts * 10 - left
    if (v > score) {
      score = v
      best = t
    }
  }
  return best
}

/** The nearest live target from this side's crossbow that is not already being shot at. */
export function pickTarget(s: State, side: Side): Target | undefined {
  const bow = BOW[side] as { x: number; y: number }
  const chasing = new Set(s.bolts.filter((b) => b.side === side).map((b) => b.target))
  let best: Target | undefined
  let bestD = Infinity
  for (const t of s.targets) {
    if (chasing.has(t.id) || !isAlive(t, s.now)) continue
    // Only targets that will still be there when the bolt arrives.
    if (t.born + t.life - s.now < BOLT_TIME + 0.15) continue
    const d = Math.hypot(t.x - bow.x, t.y - bow.y)
    if (d < bestD) {
      best = t
      bestD = d
    }
  }
  return best
}

/** Where the computer taps: near the centre, wandering by difficulty but inside the tap pad. */
export function aimPoint(t: Target, d: Difficulty, rng: Rng): { x: number; y: number } {
  const reach = Math.min(ERR[d], t.r + TAP_PAD - 2)
  const a = rng.next() * Math.PI * 2
  const m = Math.sqrt(rng.next()) * reach
  return { x: t.x + Math.cos(a) * m, y: t.y + Math.sin(a) * m }
}
