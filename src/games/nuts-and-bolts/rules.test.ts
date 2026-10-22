import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { DETOUR, detour, nextTap, PACE } from './bot.ts'
import {
  BOLTS,
  buildPuzzle,
  CAP,
  canDrop,
  COLOURS,
  isSolved,
  level,
  move,
  moves,
  outlook,
  roundSeed,
  SWAPS,
  solvedBolts,
  solve,
  topRun,
  type Bolts,
} from './rules.ts'

describe('match rounds', () => {
  it('round 0 keeps the match seed; later rounds get their own, repeatably', () => {
    expect(roundSeed(4242, 0)).toBe(4242)
    const seeds = [0, 1, 2, 3].map((r) => roundSeed(4242, r))
    expect(new Set(seeds).size).toBe(4)
    expect(roundSeed(4242, 2)).toBe(seeds[2])
  })
})

/** Replay a plan from a start state; true when every step is legal and the end is solved. */
function replay(start: Bolts, plan: [number, number][]): boolean {
  let b = start
  for (const [f, t] of plan) {
    if (!canDrop(b, f, t)) return false
    b = move(b, f, t)
  }
  return isSolved(b)
}

describe('nuts and bolts moves', () => {
  it('starts from six full bolts and two empty ones, solved', () => {
    const s = solvedBolts()
    expect(s).toHaveLength(BOLTS)
    expect(s.slice(0, COLOURS).every((b) => b.length === CAP && b.every((c) => c === b[0]))).toBe(
      true,
    )
    expect(s.slice(COLOURS).every((b) => b.length === 0)).toBe(true)
    expect(isSolved(s)).toBe(true)
  })

  it('lifts the whole top run and drops only onto a matching top or an empty bolt with room', () => {
    const b: Bolts = [[1, 2, 2, 2], [2, 1, 1], [], [1, 2, 3, 4]]
    expect(topRun(b[0] ?? [])).toBe(3)
    expect(canDrop(b, 0, 1)).toBe(false) // top 2 onto top 1: no
    expect(canDrop(b, 1, 0)).toBe(false) // top 1 onto top 2: no
    expect(canDrop(b, 0, 2)).toBe(true) // onto empty
    expect(canDrop(b, 3, 2)).toBe(true)
    expect(canDrop([[1], [1, 1, 1, 1]], 0, 1)).toBe(false) // full bolt has no room
  })

  it('pours as many nuts as fit and leaves the rest on the source bolt', () => {
    const b: Bolts = [
      [0, 3, 3, 3],
      [3, 3, 3],
    ]
    const r = move(b, 0, 1)
    expect(r[1]).toEqual([3, 3, 3, 3])
    expect(r[0]).toEqual([0, 3, 3])
  })

  it('a bolt of one colour, or an empty one, counts as solved', () => {
    expect(isSolved([[0, 0], [1, 1, 1], []])).toBe(true)
    expect(isSolved([[0, 1], []])).toBe(false)
  })

  it('lists sensible moves and never onto a bolt with another colour on top', () => {
    const b: Bolts = [[0, 1], [2], []]
    const ms = moves(b)
    for (const [f, t] of ms) expect(canDrop(b, f, t)).toBe(true)
    expect(ms).not.toContainEqual([0, 1])
  })
})

describe('nuts and bolts puzzles', () => {
  it('builds the same puzzle from the same seed, with six colours of four nuts each', () => {
    const a = buildPuzzle(31, SWAPS.normal)
    expect(buildPuzzle(31, SWAPS.normal)).toEqual(a)
    expect(a.start).toHaveLength(BOLTS)
    const count = new Map<number, number>()
    for (const bolt of a.start) for (const c of bolt) count.set(c, (count.get(c) ?? 0) + 1)
    expect(count.size).toBe(COLOURS)
    for (const n of count.values()) expect(n).toBe(CAP)
    expect(isSolved(a.start)).toBe(false)
  })

  it('every puzzle is solvable and its plan replays to a solved board', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const p = buildPuzzle(seed * 17, SWAPS[d])
        expect(p.plan.length).toBeGreaterThan(0)
        expect(replay(p.start, p.plan)).toBe(true)
      }
    }
  })

  it('the search finds a short plan from a hand-made scramble', () => {
    const start: Bolts = [
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [2, 2, 2],
      [],
      [3, 3, 3, 3],
      [4, 4, 4, 4],
      [5, 5, 5, 5],
      [],
    ].map((b) => b.slice())
    const plan = solve(start)
    expect(plan).not.toBeNull()
    expect(replay(start, plan ?? [])).toBe(true)
  })

  it('a solved board needs no moves', () => {
    expect(solve(solvedBolts())).toEqual([])
  })

  it('generates quickly enough to start a game', () => {
    const t = performance.now()
    buildPuzzle(777, SWAPS.hard)
    expect(performance.now() - t).toBeLessThan(2500)
  })

  it('random legal play never breaks the nut count', () => {
    const rng = new Rng(4)
    let b = buildPuzzle(5, SWAPS.hard).start
    for (let s = 0; s < 200; s++) {
      const ms = moves(b)
      if (!ms.length) break
      const [f, t] = rng.pick(ms) as [number, number]
      b = move(b, f, t)
      expect(b.flat()).toHaveLength(COLOURS * CAP)
    }
  })
})

describe('nuts and bolts bot', () => {
  it('pace per tap: the easier the level, the slower the bot', () => {
    expect(PACE.easy).toBeGreaterThan(PACE.normal)
    expect(PACE.normal).toBeGreaterThan(PACE.hard)
  })

  it('a bot tap sequence solves the puzzle', () => {
    const p = buildPuzzle(12, SWAPS.normal)
    let b = p.start
    let idx = 0
    let hand = false
    let from = -1
    let taps = 0
    while (taps < 2000 && !isSolved(b)) {
      const t = nextTap(p.plan, idx, hand)
      if (!t) break
      taps++
      if (!hand) {
        from = t.bolt
        hand = true
      } else {
        b = move(b, from, t.bolt)
        idx++
        hand = false
      }
    }
    expect(isSolved(b)).toBe(true)
    expect(taps).toBeLessThan(2000)
  })
})

/** Six full-ish bolts whose tops match no bolt with room: not a single legal move. */
const DEADLOCK: Bolts = [
  [3, 3, 3, 0],
  [4, 4, 4, 0],
  [5, 5, 5, 0],
  [1, 1, 1, 1],
  [2, 2, 2, 2],
  [0, 3],
  [4],
  [5],
]

describe('nuts and bolts levels', () => {
  it('harder levels use more colours and less spare room; later rounds ramp up', () => {
    expect(level('easy', 0).colours).toBe(5)
    expect(level('normal', 0).colours).toBe(6)
    expect(level('hard', 0).colours).toBe(7)
    expect(level('easy', 2).colours).toBe(6)
    expect(level('hard', 4).colours).toBe(7)
    expect(level('normal', 3).swaps).toBeGreaterThan(level('normal', 0).swaps)
  })

  it('a hard puzzle has seven colours of four and a single spare bolt, and is solvable', () => {
    for (const seed of [3, 8, 13]) {
      const l = level('hard', 0)
      const p = buildPuzzle(seed, l.swaps, l.colours)
      expect(p.start.filter((b) => b.length === 0)).toHaveLength(1)
      const count = new Map<number, number>()
      for (const bolt of p.start) for (const c of bolt) count.set(c, (count.get(c) ?? 0) + 1)
      expect(count.size).toBe(7)
      for (const n of count.values()) expect(n).toBe(CAP)
      expect(replay(p.start, p.plan)).toBe(true)
    }
  })

  it('harder levels take longer to sort', () => {
    const avg = (d: 'easy' | 'normal' | 'hard') => {
      let n = 0
      for (let seed = 1; seed <= 6; seed++) {
        const l = level(d, 0)
        n += buildPuzzle(seed * 11, l.swaps, l.colours).plan.length
      }
      return n / 6
    }
    expect(avg('normal')).toBeGreaterThan(avg('easy'))
    expect(avg('hard')).toBeGreaterThan(avg('normal'))
  })
})

describe('nuts and bolts dead ends', () => {
  it('sees a board with no legal move as dead', () => {
    expect(moves(DEADLOCK)).toEqual([])
    expect(outlook(DEADLOCK)).toBe('dead')
  })

  it('a fresh puzzle is fine, a sorted one is solved', () => {
    expect(outlook(buildPuzzle(9, SWAPS.normal).start)).toBe('ok')
    expect(outlook(solvedBolts())).toBe('solved')
  })

  it('only calls a board dead when no solution exists at all', () => {
    // Random play into dead ends: a much bigger search confirms none of them can be sorted.
    let found = 0
    for (let seed = 1; seed <= 30 && found < 3; seed++) {
      const rng = new Rng(seed)
      let b = buildPuzzle(seed * 13, SWAPS.hard).start
      for (let s = 0; s < 60; s++) {
        const ms = moves(b)
        if (!ms.length) break
        const [f, t] = rng.pick(ms) as [number, number]
        b = move(b, f, t)
        const o = outlook(b)
        if (o === 'dead') {
          found++
          expect(solve(b, 200000)).toBeNull()
          break
        }
        if (o === 'solved') break
      }
    }
    expect(found).toBeGreaterThan(0)
  })
})

describe('nuts and bolts bot levels', () => {
  it('a detour is a legal move off the plan that still sorts the board', () => {
    const p = buildPuzzle(21, SWAPS.normal)
    const plan = detour(p.start, new Rng(3))
    expect(plan).not.toBeNull()
    expect(replay(p.start, plan ?? [])).toBe(true)
  })

  it('hard beats easy in a race on the same puzzle most of the time', () => {
    /** Seconds a bot takes to sort `start`: two taps per move at its pace. */
    const race = (start: Bolts, lv: 'easy' | 'hard', seed: number): number => {
      const rng = new Rng(seed)
      let b = start
      let plan = solve(b) ?? []
      let idx = 0
      let n = 0
      while (!isSolved(b) && n < 400) {
        if (rng.chance(DETOUR[lv])) {
          const d = detour(b, rng)
          if (d) {
            plan = d
            idx = 0
          }
        }
        const m = plan[idx++]
        if (!m) break
        b = move(b, m[0], m[1])
        n++
      }
      return isSolved(b) ? n * 2 * PACE[lv] : Infinity
    }
    let hardWins = 0
    for (let seed = 1; seed <= 10; seed++) {
      const l = level('normal', 0)
      const start = buildPuzzle(seed * 37, l.swaps, l.colours).start
      if (race(start, 'hard', seed) < race(start, 'easy', seed + 100)) hardWins++
    }
    expect(hardWins).toBeGreaterThanOrEqual(8)
  })

  it('easy wanders more than hard: slower to sort the same puzzles', () => {
    const time = (lv: 'easy' | 'normal' | 'hard'): number => {
      let total = 0
      for (let seed = 1; seed <= 6; seed++) {
        const rng = new Rng(seed)
        let b = buildPuzzle(seed * 7, SWAPS.normal).start
        let plan = solve(b) ?? []
        let idx = 0
        let n = 0
        while (!isSolved(b) && n < 400) {
          if (rng.chance(DETOUR[lv])) {
            const d = detour(b, rng)
            if (d) {
              plan = d
              idx = 0
            }
          }
          const m = plan[idx++]
          if (!m) break
          b = move(b, m[0], m[1])
          n++
        }
        expect(isSolved(b)).toBe(true)
        total += n * 2 * PACE[lv]
      }
      return total
    }
    const [e, n, h] = [time('easy'), time('normal'), time('hard')]
    expect(e).toBeGreaterThan(n)
    expect(n).toBeGreaterThan(h)
  })
})
