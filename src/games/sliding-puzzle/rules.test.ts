import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { botPlan, botTap, PACE } from './bot.ts'
import {
  CELLS,
  distance,
  foldPlan,
  MIN_DISTANCE,
  scrambleSize,
  solveTaps,
  isSolved,
  neighbours,
  progress,
  scramble,
  slide,
  SCRAMBLE_MOVES,
  solvedBoard,
  solvePlan,
} from './rules.ts'

describe('sliding puzzle: scramble', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(scramble(new Rng(7))).toEqual(scramble(new Rng(7)))
    expect(scramble(new Rng(7)).tiles).not.toEqual(scramble(new Rng(8)).tiles)
  })

  it('makes a permutation of the tiles that is not solved', () => {
    const { tiles } = scramble(new Rng(3))
    expect([...tiles].sort((a, b) => a - b)).toEqual(
      solvedBoard()
        .slice()
        .sort((a, b) => a - b),
    )
    expect(isSolved(tiles)).toBe(false)
  })

  it('never undoes the previous move and only walks legal gap steps', () => {
    const { path } = scramble(new Rng(11))
    expect(path).toHaveLength(SCRAMBLE_MOVES + 1)
    for (let i = 1; i < path.length; i++) {
      expect(neighbours(path[i - 1] as number)).toContain(path[i])
      if (i >= 2) expect(path[i]).not.toBe(path[i - 2])
    }
  })

  it('is solved by undoing its moves in order', () => {
    for (const seed of [1, 2, 3, 99]) {
      const sc = scramble(new Rng(seed))
      let tiles = sc.tiles
      for (const cell of solvePlan(sc.path)) {
        const r = slide(tiles, cell)
        expect(r).not.toBeNull()
        tiles = r?.tiles as number[]
      }
      expect(isSolved(tiles)).toBe(true)
    }
  })
})

describe('sliding puzzle: scramble size', () => {
  it('never deals a puzzle that is nearly solved', () => {
    for (let seed = 0; seed < 300; seed++)
      expect(distance(scramble(new Rng(seed)).tiles)).toBeGreaterThanOrEqual(MIN_DISTANCE)
  })
})

describe('sliding puzzle: folded plans', () => {
  it('slides a straight run of the gap in one tap', () => {
    // Gap at 15; the plan walks it left along the bottom row to 12, then up to 8.
    expect(foldPlan(15, [14, 13, 12, 8])).toEqual([12, 8])
    // Up the last column, then left: two runs.
    expect(foldPlan(15, [11, 7, 6, 5])).toEqual([7, 5])
  })

  it('does not fold across the end of a row', () => {
    // Gap at 4 (row 1, col 0): 3 is index-adjacent to 4 but on the row above.
    expect(foldPlan(4, [5, 1, 0])).toEqual([5, 1, 0])
  })

  it('a folded plan still solves the scramble, in fewer taps', () => {
    for (const seed of [1, 5, 9, 40]) {
      const sc = scramble(new Rng(seed))
      const plan = botPlan(sc.tiles, 'hard')
      expect(plan.length).toBeLessThan(botPlan(sc.tiles, 'easy').length)
      let tiles = sc.tiles
      for (const cell of plan) {
        const r = slide(tiles, cell)
        expect(r).not.toBeNull()
        tiles = r?.tiles as number[]
      }
      expect(isSolved(tiles)).toBe(true)
    }
  })
})

describe('sliding puzzle: taps', () => {
  const solved = solvedBoard()

  it('ignores the gap and cells that are not in line with it', () => {
    // Gap at 15 (row 3, col 3). Cell 10 is in neither its row nor its column.
    expect(slide(solved, CELLS - 1)).toBeNull()
    expect(slide(solved, 10)).toBeNull()
    expect(slide(solved, 0)).toBeNull()
  })

  it('slides a tile next to the gap into it', () => {
    const r = slide(solved, 11)
    expect(r?.tiles[11]).toBe(0)
    expect(r?.tiles[15]).toBe(12)
    expect(r?.from[15]).toBe(11)
    expect(r?.from[11]).toBe(11)
  })

  it('slides the whole run in a row toward the gap', () => {
    // Gap at 15; tap cell 12 (same row): tiles 13, 14, 15 each move one step right.
    const r = slide(solved, 12)
    expect(r?.tiles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 13, 14, 15])
    expect(r?.from[13]).toBe(12)
    expect(r?.from[15]).toBe(14)
  })

  it('slides the whole run in a column toward the gap, and back', () => {
    const moved = slide(solved, 3)
    expect(moved?.tiles).toEqual([1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8, 13, 14, 15, 12])
    // The gap is now at 3: tapping the bottom of the column slides it back down.
    expect(slide(moved?.tiles ?? [], 15)?.tiles).toEqual(solved)
  })

  it('does not change the board it is given', () => {
    const before = solved.slice()
    slide(solved, 12)
    expect(solved).toEqual(before)
  })

  it('treats the edge of a row as a boundary', () => {
    // Gap at 3 (row 0, col 3). Cell 4 is index-adjacent but in row 1.
    const board = [1, 2, 3, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    expect(slide(board, 4)).toBeNull()
    expect(slide(board, 0)?.tiles.slice(0, 4)).toEqual([0, 1, 2, 3])
  })
})

describe('sliding puzzle: progress', () => {
  it('is 1 exactly when solved and below 1 otherwise', () => {
    const sc = scramble(new Rng(5))
    const start = distance(sc.tiles)
    expect(progress(solvedBoard(), start)).toBe(1)
    expect(progress(sc.tiles, start)).toBeLessThan(1)
    expect(progress(sc.tiles, start)).toBeGreaterThanOrEqual(0)
    expect(distance(solvedBoard())).toBe(0)
  })
})

describe('sliding puzzle: bot', () => {
  it('has a positive pace per difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) expect(PACE[d]).toBeGreaterThan(0)
  })

  for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
    it(`solves a scramble on ${d} in bounded taps`, () => {
      for (const seed of [4, 21, 77]) {
        const sc = scramble(new Rng(seed))
        const rng = new Rng(seed + 1)
        let tiles = sc.tiles
        let plan = botPlan(sc.tiles, d)
        let taps = 0
        while (!isSolved(tiles) && taps < 400) {
          const m = botTap(tiles, plan, d, rng)
          expect(m).not.toBeNull()
          const r = slide(tiles, m?.cell as number)
          expect(r).not.toBeNull()
          tiles = r?.tiles as number[]
          plan = m?.plan as number[]
          taps++
        }
        expect(isSolved(tiles)).toBe(true)
        expect(taps).toBeLessThan(SCRAMBLE_MOVES * 3)
      }
    })
  }
})

describe('sliding puzzle: difficulty', () => {
  it('scrambles further on harder levels and further each race of a match', () => {
    expect(scrambleSize('easy', 0).min).toBeLessThan(scrambleSize('normal', 0).min)
    expect(scrambleSize('normal', 0).min).toBeLessThan(scrambleSize('hard', 0).min)
    for (let r = 1; r < 8; r++) {
      expect(scrambleSize('normal', r).moves).toBeGreaterThanOrEqual(
        scrambleSize('normal', r - 1).moves,
      )
      expect(scrambleSize('normal', r).min).toBeGreaterThanOrEqual(
        scrambleSize('normal', r - 1).min,
      )
    }
    const sz = scrambleSize('hard', 2)
    const sc = scramble(new Rng(12), sz.moves, sz.min)
    expect(distance(sc.tiles)).toBeGreaterThanOrEqual(sz.min)
  })

  it('solves a board from the board alone', () => {
    const sz = scrambleSize('hard', 0)
    for (const seed of [2, 3]) {
      const sc = scramble(new Rng(seed), sz.moves, sz.min)
      const taps = solveTaps(sc.tiles, 1.6) as number[]
      expect(taps).not.toBeNull()
      let tiles = sc.tiles
      for (const cell of taps) tiles = slide(tiles, cell)?.tiles as number[]
      expect(isSolved(tiles)).toBe(true)
      // Shorter than undoing the scramble walk.
      expect(taps.length).toBeLessThan(sz.moves)
    }
  })

  it('a hard bot beats an easy one on the same board in most seeded races', () => {
    const sz = scrambleSize('normal', 0)
    const race = (d: Difficulty, seed: number, tiles0: number[]): number => {
      const rng = new Rng(seed)
      let tiles = tiles0
      let plan = botPlan(tiles, d)
      let t = 0
      for (let n = 0; n < 500 && !isSolved(tiles); n++) {
        const m = botTap(tiles, plan, d, rng) as { cell: number; plan: number[] }
        tiles = slide(tiles, m.cell)?.tiles as number[]
        plan = m.plan
        t += PACE[d] * rng.range(0.7, 1.3)
      }
      return t
    }
    let wins = 0
    const seeds = [3, 4, 5, 6, 7, 8]
    for (const seed of seeds) {
      const sc = scramble(new Rng(seed), sz.moves, sz.min)
      if (race('hard', seed, sc.tiles) < race('easy', seed + 50, sc.tiles)) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(seeds.length - 1)
  })
})
