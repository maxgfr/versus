import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { pickTile, PACE } from './bot.ts'
import {
  buildLayout,
  isFree,
  LEVELS,
  type Layout,
  overlaps,
  settle,
  SET,
  solve,
  solvable,
  TRAY,
} from './rules.ts'

const EASY = LEVELS.easy
const NORMAL = LEVELS.normal
const HARD = LEVELS.hard

/** Play a whole game with the bot on both sides; returns the result and the number of taps. */
function playBot(lay: Layout, d: 'easy' | 'normal' | 'hard', seed: number, cap = 5000) {
  const n = lay.tiles.length
  const taken = Array.from({ length: n }, () => false)
  let tray: { k: number }[] = []
  const rng = new Rng(seed)
  let taps = 0
  let left = n
  while (left > 0 && taps < cap) {
    const i = pickTile(lay, taken, tray, d, rng)
    if (i < 0) return { outcome: 'stuck' as const, taps }
    taps++
    taken[i] = true
    left--
    const r = settle(tray, { k: lay.tiles[i]?.k ?? 0 })
    tray = r.tray
    if (r.lost) return { outcome: 'lost' as const, taps }
  }
  return { outcome: left === 0 ? ('cleared' as const) : ('capped' as const), taps }
}

describe('tap match layouts', () => {
  it('uses whole sets: tile count is a multiple of three and each kind a multiple of three', () => {
    for (const level of [EASY, NORMAL, HARD]) {
      const lay = buildLayout(7, level)
      expect(lay.tiles.length).toBe(level.sets * SET)
      const counts = new Map<number, number>()
      for (const t of lay.tiles) counts.set(t.k, (counts.get(t.k) ?? 0) + 1)
      expect(counts.size).toBe(level.kinds)
      for (const c of counts.values()) expect(c % SET).toBe(0)
    }
  })

  it('stacks in three layers, with tiles resting on the layer below and no same-layer overlap', () => {
    const lay = buildLayout(11, NORMAL)
    const tiles = lay.tiles
    expect(tiles.some((t) => t.l === 2)).toBe(true)
    tiles.forEach((a, i) => {
      if (a.l > 0) expect(tiles.some((b) => b.l === a.l - 1 && overlaps(a, b))).toBe(true)
      tiles.forEach((b, j) => {
        if (i !== j && a.l === b.l) expect(overlaps(a, b)).toBe(false)
      })
    })
  })

  it('leaves only top tiles free at the start, and some free tiles to play', () => {
    const lay = buildLayout(3, HARD)
    const taken = Array.from({ length: lay.tiles.length }, () => false)
    const free = lay.tiles.map((_, i) => isFree(lay, taken, i)).filter(Boolean).length
    expect(free).toBeGreaterThan(0)
    lay.tiles.forEach((t, i) => {
      if (t.l === 2) expect(isFree(lay, taken, i)).toBe(true)
    })
  })

  it('is deterministic per seed and differs between seeds', () => {
    expect(buildLayout(42, NORMAL)).toEqual(buildLayout(42, NORMAL))
    expect(buildLayout(42, NORMAL)).not.toEqual(buildLayout(43, NORMAL))
  })

  it('every generated layout is solvable (seeds 1..6, all levels)', () => {
    for (const level of [EASY, NORMAL, HARD]) {
      for (let seed = 1; seed <= 6; seed++) expect(solvable(buildLayout(seed, level))).toBe(true)
    }
  })

  it('generates fast enough for a game start', () => {
    const t = performance.now()
    for (let s = 0; s < 6; s++) buildLayout(500 + s, HARD)
    expect((performance.now() - t) / 6).toBeLessThan(400)
  })
})

describe('tap match solver and deal', () => {
  it('solve gives a first move, and following it clears the whole stack', () => {
    for (const level of [EASY, HARD]) {
      const lay = buildLayout(5, level)
      const n = lay.tiles.length
      const taken = Array.from({ length: n }, () => false)
      let tray: { k: number }[] = []
      for (let left = n; left > 0; left--) {
        const i = solve(lay, taken, tray)
        expect(i).toBeGreaterThanOrEqual(0)
        expect(taken[i]).toBe(false)
        expect(isFree(lay, taken, i)).toBe(true)
        taken[i] = true
        const r = settle(tray, { k: lay.tiles[i]?.k ?? 0 })
        expect(r.lost).toBe(false)
        tray = r.tray
      }
      expect(tray).toEqual([])
    }
  })

  it('solve finds no line from a lost cause', () => {
    const lay = buildLayout(5, EASY)
    const taken = Array.from({ length: lay.tiles.length }, () => false)
    // One of each of the six kinds: whatever tile comes next is a seventh with no set.
    const tray = [0, 1, 2, 3, 4, 5].map((k) => ({ k }))
    expect(EASY.kinds).toBe(6)
    expect(solve(lay, taken, tray, 2000)).toBe(-1)
  })

  it('when random deals keep failing, the constructive deal is solvable and inside the grid', () => {
    for (const level of [EASY, NORMAL, HARD]) {
      for (let seed = 1; seed <= 6; seed++) {
        const lay = buildLayout(seed, level, 0)
        expect(lay.tiles.length).toBe(level.sets * SET)
        for (const t of lay.tiles) {
          expect(t.x).toBeGreaterThanOrEqual(0)
          expect(t.x + 2).toBeLessThanOrEqual(14)
          expect(t.y).toBeGreaterThanOrEqual(0)
          expect(t.y + 2).toBeLessThanOrEqual(10)
        }
        const counts = new Map<number, number>()
        for (const t of lay.tiles) counts.set(t.k, (counts.get(t.k) ?? 0) + 1)
        expect(counts.size).toBe(level.kinds)
        for (const c of counts.values()) expect(c % SET).toBe(0)
        expect(solvable(lay, 200000)).toBe(true)
      }
    }
  })
})

describe('tap match tray', () => {
  it('keeps the tray sorted by kind and vanishes a set of three', () => {
    let tray: { k: number }[] = []
    tray = settle(tray, { k: 4 }).tray
    tray = settle(tray, { k: 1 }).tray
    expect(tray.map((s) => s.k)).toEqual([1, 4])
    const second = settle(tray, { k: 4 })
    expect(second.cleared).toBe(false)
    const third = settle(second.tray, { k: 4 })
    expect(third.cleared).toBe(true)
    expect(third.tray.map((s) => s.k)).toEqual([1])
    expect(third.at).toBe(1)
  })

  it('loses when the seventh tile completes no set', () => {
    let tray: { k: number }[] = []
    for (let k = 0; k < TRAY - 1; k++) tray = settle(tray, { k }).tray
    expect(tray.length).toBe(TRAY - 1)
    const r = settle(tray, { k: 20 })
    expect(r.lost).toBe(true)
    expect(r.cleared).toBe(false)
  })

  it('a seventh tile that completes a set does not lose', () => {
    // Six tiles: two of kind 0, two of kind 1, one of 2, one of 3; the seventh is kind 0.
    let tray: { k: number }[] = []
    for (const k of [0, 0, 1, 1, 2, 3]) tray = settle(tray, { k }).tray
    const r = settle(tray, { k: 0 })
    expect(r.cleared).toBe(true)
    expect(r.lost).toBe(false)
    expect(r.tray.length).toBe(4)
  })

  it('a set can never sit in the tray for longer than its third tile', () => {
    expect(SET).toBe(3)
    const r = settle([{ k: 2 }, { k: 2 }], { k: 2 })
    expect(r.cleared).toBe(true)
  })
})

describe('tap match bot', () => {
  it('has a pace per difficulty', () => {
    expect(PACE.easy).toBeGreaterThan(PACE.normal)
    expect(PACE.normal).toBeGreaterThan(PACE.hard)
  })

  it('prefers a tile that completes a set in the tray', () => {
    const lay = buildLayout(9, NORMAL)
    const taken = Array.from({ length: lay.tiles.length }, () => false)
    const first = lay.tiles.findIndex((_, i) => isFree(lay, taken, i))
    const kind = lay.tiles[first]?.k ?? 0
    const tray = [{ k: kind }, { k: kind }]
    // Hard has no noise: the completing tile must win if one is free.
    const pick = pickTile(lay, taken, tray, 'hard', new Rng(1))
    expect(lay.tiles[pick]?.k).toBe(kind)
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`plays a whole bot-vs-bot game to a result at ${d}`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const r = playBot(buildLayout(seed, LEVELS[d]), d, seed)
        expect(['cleared', 'lost']).toContain(r.outcome)
        expect(r.taps).toBeLessThan(5000)
      }
    })
  }

  it('the hard bot clears every sample layout (it looks ahead with the solver)', () => {
    for (let s = 1; s <= 6; s++)
      expect(playBot(buildLayout(s, HARD), 'hard', s).outcome).toBe('cleared')
  })

  it('clears more stacks the harder it plays', () => {
    const cleared = (d: 'easy' | 'normal' | 'hard') =>
      Array.from({ length: 16 }, (_, s) => s + 1).filter(
        (s) => playBot(buildLayout(s, HARD), d, s).outcome === 'cleared',
      ).length
    const [e, n, h] = [cleared('easy'), cleared('normal'), cleared('hard')]
    expect(h).toBeGreaterThanOrEqual(n)
    expect(n).toBeGreaterThan(e)
  })
})
