import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'

/**
 * Pure rules for Tap Match. A stack of tiles sits in three layers over a
 * 14 × 10 slot grid; a tile covers 2 × 2 slots. A tile is free when no tile on
 * a higher layer overlaps it. Taking a free tile puts it in the tray, sorted by
 * kind; three of a kind vanish at once; a seventh tile that completes no set
 * fills the tray and loses.
 */

export const TRAY = 7
/** Tiles of one kind that vanish together from the tray. */
export const SET = 3

export const LEVELS: Record<Difficulty, { kinds: number; sets: number }> = {
  easy: { kinds: 6, sets: 12 },
  normal: { kinds: 8, sets: 15 },
  hard: { kinds: 10, sets: 20 },
}

export interface Tile {
  /** What the tile shows (0..kinds-1). */
  k: number
  /** Top-left corner in slot units. */
  x: number
  y: number
  /** Layer, 0 at the bottom. */
  l: number
}

export interface Layout {
  tiles: Tile[]
  /** Indices of the tiles lying on top of each tile and overlapping it. */
  above: number[][]
  /** Indices of the tiles each tile lies on and overlaps. */
  under: number[][]
}

interface Pos {
  x: number
  y: number
}

/** Two tiles overlap when their 2 × 2 footprints share a slot. */
export function overlaps(a: Pos, b: Pos): boolean {
  return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
}

/** Candidate positions per layer: layer 1 sits half a tile off the grid of layer 0. */
function grid(l: number): Pos[] {
  const [x0, x1, y0, y1] = l === 0 ? [0, 12, 0, 8] : l === 1 ? [1, 11, 1, 7] : [2, 10, 2, 6]
  const out: Pos[] = []
  for (let x = x0 ?? 0; x <= (x1 ?? 0); x += 2)
    for (let y = y0 ?? 0; y <= (y1 ?? 0); y += 2) out.push({ x, y })
  return out
}

/** Stack positions for n tiles: half on the floor, a third on top of those, the rest on top. */
function place(rng: Rng, n: number): Tile[] | null {
  const want = [Math.ceil(n / 2), Math.floor(n / 3)]
  want.push(n - (want[0] ?? 0) - (want[1] ?? 0))
  const tiles: Tile[] = []
  for (let l = 0; l < 3; l++) {
    const need = want[l] ?? 0
    let got = 0
    for (const p of rng.shuffle(grid(l))) {
      if (got === need) break
      // Above the floor, a tile must rest on a tile of the layer below.
      if (l > 0 && !tiles.some((u) => u.l === l - 1 && overlaps(u, p))) continue
      tiles.push({ k: 0, x: p.x, y: p.y, l })
      got++
    }
    if (got < need) return null
  }
  return tiles
}

export function link(tiles: Tile[]): Layout {
  const above = tiles.map((a) => tiles.flatMap((b, j) => (b.l > a.l && overlaps(a, b) ? [j] : [])))
  const under = tiles.map((a) => tiles.flatMap((b, j) => (b.l < a.l && overlaps(a, b) ? [j] : [])))
  return { tiles, above, under }
}

/** Tile i is free when every tile on top of it has been taken. */
export function isFree(lay: Layout, taken: readonly boolean[], i: number): boolean {
  return (lay.above[i] ?? []).every((j) => taken[j])
}

/**
 * Put `item` into a kind-sorted tray. A set of three vanishes (`cleared`, with
 * `at` the slot where the set stood); otherwise a full tray is `lost`.
 */
export function settle<T extends { k: number }>(
  tray: readonly T[],
  item: T,
): { tray: T[]; at: number; cleared: boolean; lost: boolean } {
  const next = tray.slice()
  let pos = next.findIndex((s) => s.k > item.k)
  if (pos < 0) pos = next.length
  next.splice(pos, 0, item)
  const at = next.findIndex((s) => s.k === item.k)
  if (next.filter((s) => s.k === item.k).length === SET) {
    return { tray: next.filter((s) => s.k !== item.k), at, cleared: true, lost: false }
  }
  return { tray: next, at, cleared: false, lost: next.length >= TRAY }
}

/**
 * From a position (tiles taken, tray), the first move of a line that clears
 * the whole stack, found by a player who always knows the best move: -1 when
 * none was found. Depth-first search with memoised states; a node budget keeps
 * it bounded (running out counts as not found).
 */
export function solve(
  lay: Layout,
  taken: readonly boolean[],
  tray: readonly { k: number }[],
  budget = 30000,
): number {
  const n = lay.tiles.length
  const cur = taken.slice()
  let left = 0
  for (const t of cur) if (!t) left++
  if (left === 0) return -1
  const seen = new Set<string>()
  let nodes = 0
  let first = -1
  const dfs = (tray: readonly { k: number }[], left: number, depth: number): boolean => {
    if (left === 0) return true
    if (++nodes > budget) return false
    const key = cur.map((v) => (v ? '1' : '0')).join('') + tray.map((s) => s.k).join('')
    if (seen.has(key)) return false
    seen.add(key)
    const moves: { i: number; same: number }[] = []
    for (let i = 0; i < n; i++) {
      if (cur[i] || !isFree(lay, cur, i)) continue
      const k = lay.tiles[i]?.k ?? 0
      moves.push({ i, same: tray.filter((s) => s.k === k).length })
    }
    // Completing a set first keeps the tray short.
    moves.sort((a, b) => b.same - a.same)
    for (const m of moves) {
      const r = settle(tray, { k: lay.tiles[m.i]?.k ?? 0 })
      if (r.lost) continue
      cur[m.i] = true
      if (dfs(r.tray, left - 1, depth + 1)) {
        if (depth === 0) first = m.i
        return true
      }
      cur[m.i] = false
    }
    return false
  }
  return dfs(tray, left, 0) ? first : -1
}

/** Can every tile be cleared from the start of this layout? */
export function solvable(lay: Layout, budget = 30000): boolean {
  const n = lay.tiles.length
  return (
    solve(
      lay,
      Array.from({ length: n }, () => false),
      [],
      budget,
    ) >= 0
  )
}

/** Every kind gets one set, the spare sets are dealt at random: kind per set. */
function setKinds(rng: Rng, level: { kinds: number; sets: number }): number[] {
  const kinds = Array.from({ length: level.kinds }, (_, k) => k)
  for (let s = level.kinds; s < level.sets; s++) kinds.push(rng.int(0, level.kinds - 1))
  return rng.shuffle(kinds)
}

/**
 * Kinds dealt so the stack is solvable by construction: tiles are taken off a
 * copy of the stack in a random order (always a free one), and each three in a
 * row share a kind, so playing that order never holds more than two tiles.
 */
function dealSolvable(rng: Rng, lay: Layout, level: { kinds: number; sets: number }): void {
  const n = lay.tiles.length
  const taken = Array.from({ length: n }, () => false)
  const kinds = setKinds(rng, level)
  for (let pick = 0; pick < n; pick++) {
    const free: number[] = []
    for (let i = 0; i < n; i++) if (!taken[i] && isFree(lay, taken, i)) free.push(i)
    const i = free[rng.int(0, free.length - 1)] ?? 0
    taken[i] = true
    const t = lay.tiles[i]
    if (t) t.k = kinds[Math.floor(pick / SET)] ?? 0
  }
}

/**
 * Seeded layout: stack positions, kinds (each kind a whole number of sets),
 * solvable. Kinds are dealt at random and checked by the solver; after
 * `attempts` misses they are dealt by construction, so the stack is always
 * solvable and always inside the grid.
 */
export function buildLayout(
  seed: number,
  level: { kinds: number; sets: number },
  attempts = 200,
): Layout {
  const rng = new Rng(seed)
  const n = level.sets * SET
  let tiles: Tile[] | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    const got = place(rng, n)
    if (!got) continue
    tiles = got
    const bag: number[] = []
    for (const k of setKinds(rng, level)) for (let i = 0; i < SET; i++) bag.push(k)
    rng.shuffle(bag)
    tiles.forEach((t, i) => {
      t.k = bag[i] ?? 0
    })
    const lay = link(tiles)
    if (solvable(lay)) return lay
  }
  // place() fits a stack within a try or two; the bound only guards the loop.
  for (let tries = 0; !tiles && tries < 1000; tries++) tiles = place(rng, n)
  if (!tiles) throw new Error('tap-match: no room for the stack')
  const lay = link(tiles)
  dealSolvable(rng, lay, level)
  return lay
}
