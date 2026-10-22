import type { Difficulty } from '../../core/game.ts'
import type { Rng } from '../../core/rng.ts'
import { isFree, type Layout, SET, settle, TRAY, visible } from './rules.ts'

/** Seconds between the computer's taps: a child on easy, a quick human on hard. */
export const PACE: Record<Difficulty, number> = { easy: 1.8, normal: 0.85, hard: 0.55 }

/**
 * How far the computer plans ahead: search nodes per tap (0: none, it picks
 * by eye). The search only uses what a player can see (`visible`): a tile
 * buried under others is unknown until a corner of it shows.
 */
export const SEARCH: Record<Difficulty, number> = { easy: 0, normal: 300, hard: 4000 }

/** Noise added to the by-eye scores: easy makes plenty of slips, hard none. */
const NOISE: Record<Difficulty, number> = { easy: 520, normal: 40, hard: 0 }

/** What the computer knows of each tile's kind: -1 for a tile it cannot see. */
export function knownKinds(lay: Layout, taken: readonly boolean[]): number[] {
  const seen = visible(lay, taken)
  return lay.tiles.map((t, i) => (seen[i] ? t.k : -1))
}

/**
 * Plan ahead over the tiles in sight: each free, known tile is tried first,
 * then lines after it are searched depth-first (sets first) within an equal
 * share of `budget`. A line scores sets cleared and tiles taken, less a full
 * tray; the first tile of the best line is returned (-1 if none is safe).
 */
export function plan(
  lay: Layout,
  known: readonly number[],
  taken: readonly boolean[],
  tray: readonly { k: number }[],
  budget: number,
): number {
  const n = lay.tiles.length
  const cur = taken.slice()
  const moves = (tr: readonly { k: number }[]) => {
    const out: { i: number; same: number }[] = []
    for (let i = 0; i < n; i++) {
      const k = known[i] ?? -1
      if (cur[i] || k < 0 || !isFree(lay, cur, i)) continue
      out.push({ i, same: tr.filter((s) => s.k === k).length })
    }
    return out.sort((a, b) => b.same - a.same)
  }
  const value = (tr: readonly { k: number }[], depth: number, sets: number) =>
    sets * 40 + depth * 6 - tr.length * 14 - (tr.length >= TRAY - 1 ? 120 : 0)
  const roots = moves(tray)
  if (roots.length === 0) return -1
  const share = Math.max(8, Math.floor(budget / roots.length))
  let best = -1
  let bestV = -Infinity
  for (const root of roots) {
    const r0 = settle(tray, { k: known[root.i] ?? 0 })
    if (r0.lost) continue
    let nodes = 0
    let top = value(r0.tray, 1, r0.cleared ? 1 : 0)
    const seen = new Set<string>()
    const dfs = (tr: readonly { k: number }[], depth: number, sets: number): void => {
      top = Math.max(top, value(tr, depth, sets))
      if (++nodes > share) return
      const key = cur.map((v) => (v ? '1' : '0')).join('') + tr.map((s) => s.k).join(',')
      if (seen.has(key)) return
      seen.add(key)
      for (const m of moves(tr)) {
        const r = settle(tr, { k: known[m.i] ?? 0 })
        if (r.lost) continue
        cur[m.i] = true
        dfs(r.tray, depth + 1, sets + (r.cleared ? 1 : 0))
        cur[m.i] = false
        if (nodes > share) return
      }
    }
    cur[root.i] = true
    dfs(r0.tray, 1, r0.cleared ? 1 : 0)
    cur[root.i] = false
    if (top > bestV) {
      bestV = top
      best = root.i
    }
  }
  return best
}

/**
 * The free tile the computer takes next, from what it can see. Normal and
 * hard plan ahead (`plan`), hard much further. When planning finds no safe
 * tile, or on easy, it picks by eye: a tile that completes a set in the tray
 * wins outright; then a tile whose set can be finished from tiles in sight,
 * keeping the tray short; then tiles that uncover others. Opening a kind with
 * no partners in sight costs more the fuller the tray. Returns -1 if no tile
 * is free.
 */
export function pickTile(
  lay: Layout,
  taken: readonly boolean[],
  tray: readonly { k: number }[],
  d: Difficulty,
  rng: Rng,
): number {
  const known = knownKinds(lay, taken)
  const budget = SEARCH[d]
  if (budget > 0) {
    // A tile that completes a set in the tray never hurts: take it at once.
    for (let i = 0; i < lay.tiles.length; i++) {
      const k = known[i] ?? -1
      if (k < 0 || taken[i] || !isFree(lay, taken, i)) continue
      if (tray.filter((s) => s.k === k).length === SET - 1) return i
    }
    const i = plan(lay, known, taken, tray, budget)
    if (i >= 0) return i
  }
  const noise = NOISE[d]
  const free: number[] = []
  lay.tiles.forEach((_, i) => {
    if (!taken[i] && isFree(lay, taken, i)) free.push(i)
  })
  const freeOf = (k: number) => free.filter((j) => known[j] === k).length
  let best = -1
  let bestScore = -Infinity
  for (const i of free) {
    const k = known[i] ?? 0
    const same = tray.filter((s) => s.k === k).length
    let score: number
    if (same === SET - 1) score = 1000
    else {
      // Tiles this one uncovers (every other tile on top of them is gone); a hidden one is a guess.
      const opens = (lay.under[i] ?? []).filter(
        (j) => !taken[j] && (lay.above[j] ?? []).every((a) => a === i || taken[a]),
      )
      const near = freeOf(k) - 1 + opens.filter((j) => known[j] === k).length
      const need = SET - 1 - same
      const after = tray.length + 1
      if (near >= need) score = 300 + same * 120 - need * 30
      else score = -60 * Math.max(0, after - 2)
      // A tray this full must not take a tile it cannot pair soon.
      if (after >= TRAY - 1 && near < need) score -= 600
      for (const j of opens) {
        const kj = known[j] ?? -1
        score += 14 + (kj >= 0 && tray.some((s) => s.k === kj) ? 30 : 0) + (kj === k ? 20 : 0)
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
