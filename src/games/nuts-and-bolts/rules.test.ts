import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { nextTap, PACE } from './bot.ts'
import {
  BOLTS,
  buildPuzzle,
  CAP,
  canDrop,
  COLOURS,
  isSolved,
  move,
  moves,
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
