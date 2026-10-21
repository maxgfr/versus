import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { isFree, type Layout, SET, TRAY } from './rules.ts'

/** Seconds between the computer's taps (it plays in demos, tests and 1P vs computer). */
export const PACE: Record<Difficulty, number> = { easy: 1.6, normal: 1.0, hard: 0.6 }

/**
 * The free tile the computer takes next. A tile that completes a set in the
 * tray wins outright; then a tile whose set can be finished from tiles that
 * are free now (or that taking it uncovers), keeping the tray short; then
 * tiles that uncover others. Opening a kind with no partners in sight costs
 * more the fuller the tray. Easier levels add noise to the scores. Returns -1
 * if no tile is free.
 */
export function pickTile(
  lay: Layout,
  taken: readonly boolean[],
  tray: readonly { k: number }[],
  d: Difficulty,
  rng: Rng,
): number {
  const noise = d === 'easy' ? 160 : d === 'normal' ? 60 : 0
  const free: number[] = []
  lay.tiles.forEach((_, i) => {
    if (!taken[i] && isFree(lay, taken, i)) free.push(i)
  })
  const freeOf = (k: number) => free.filter((j) => lay.tiles[j]?.k === k).length
  let best = -1
  let bestScore = -Infinity
  for (const i of free) {
    const k = lay.tiles[i]?.k ?? 0
    const same = tray.filter((s) => s.k === k).length
    let score: number
    if (same === SET - 1) score = 1000
    else {
      // Tiles this one uncovers (every other tile on top of them is gone).
      const opens = (lay.under[i] ?? []).filter(
        (j) => !taken[j] && (lay.above[j] ?? []).every((a) => a === i || taken[a]),
      )
      const near = freeOf(k) - 1 + opens.filter((j) => lay.tiles[j]?.k === k).length
      const need = SET - 1 - same
      const after = tray.length + 1
      if (near >= need) score = 300 + same * 120 - need * 30
      else score = -60 * Math.max(0, after - 2)
      // A tray this full must not take a tile it cannot pair soon.
      if (after >= TRAY - 1 && near < need) score -= 600
      for (const j of opens) {
        const kj = lay.tiles[j]?.k ?? 0
        score += 14 + (tray.some((s) => s.k === kj) ? 30 : 0) + (kj === k ? 20 : 0)
      }
    }
    score += rng.range(0, noise)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}
