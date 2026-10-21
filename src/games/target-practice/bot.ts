import type { Difficulty, Side } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { BOLT_TIME, BOW, TAP_PAD, type State, type Target, isAlive } from './rules.ts'

/** How far the bot's tap wanders from a target's centre, by difficulty (world units). */
const ERR: Record<Difficulty, number> = { easy: 84, normal: 56, hard: 24 }

/** Seconds the computer takes to notice a target and tap it. */
export function reaction(d: Difficulty, rng: Rng): number {
  return (d === 'easy' ? 0.95 : d === 'normal' ? 0.6 : 0.36) * rng.range(0.8, 1.25)
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
