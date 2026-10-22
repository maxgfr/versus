import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { nextMove, PACE } from './bot.ts'
import {
  candidateList,
  completedUnits,
  countSolutions,
  digitCounts,
  entry,
  generate,
  GIVENS,
  givensFor,
  hiddenSingles,
  isSolved,
  matchWinner,
  nakedSingles,
  PEERS,
  progress,
  raceWinner,
  roundSeed,
  solve,
  UNITS,
} from './rules.ts'

function valid(grid: number[]): boolean {
  for (let i = 0; i < 81; i++) {
    const v = grid[i]
    if (!v || v < 1 || v > 9) return false
    for (const p of PEERS[i] as number[]) if (grid[p] === v) return false
  }
  return true
}

describe('sudoku generator', () => {
  it('makes a valid full solution and a puzzle with exactly one solution', () => {
    for (const seed of [1, 2, 3]) {
      const { puzzle, solution } = generate(seed, GIVENS.normal)
      expect(valid(solution)).toBe(true)
      puzzle.forEach((v, i) => {
        if (v) expect(v).toBe(solution[i])
      })
      expect(countSolutions(puzzle.slice())).toBe(1)
    }
  })

  it('is deterministic per seed and honours the givens target', () => {
    expect(generate(9, 32)).toEqual(generate(9, 32))
    const easy = generate(9, GIVENS.easy).puzzle.filter(Boolean).length
    const hard = generate(9, GIVENS.hard).puzzle.filter(Boolean).length
    expect(easy).toBe(GIVENS.easy)
    expect(hard).toBeGreaterThanOrEqual(GIVENS.hard)
    expect(hard).toBeLessThan(easy)
  })

  it('generates fast', () => {
    const t = performance.now()
    for (let s = 0; s < 10; s++) generate(100 + s, GIVENS.hard)
    expect((performance.now() - t) / 10).toBeLessThan(80)
  })
})

describe('sudoku helpers', () => {
  it('tracks progress, counts and completed units', () => {
    const { puzzle, solution } = generate(4, GIVENS.normal)
    expect(progress(puzzle, puzzle)).toBe(0)
    expect(progress(solution, puzzle)).toBe(1)
    expect(isSolved(solution, solution)).toBe(true)
    expect(digitCounts(solution).slice(1)).toEqual([9, 9, 9, 9, 9, 9, 9, 9, 9])
    expect(completedUnits(solution, 0)).toHaveLength(3)
  })

  it('gives every round of a match its own puzzle, round 0 the game seed', () => {
    expect(roundSeed(42, 0)).toBe(42)
    const first = generate(roundSeed(42, 0), GIVENS.normal).solution
    const second = generate(roundSeed(42, 1), GIVENS.normal).solution
    expect(second).not.toEqual(first)
    expect(generate(roundSeed(42, 1), GIVENS.normal)).toEqual(
      generate(roundSeed(42, 1), GIVENS.normal),
    )
  })

  it('ends the match at the chosen number of round wins', () => {
    expect(matchWinner([0, 0], 1)).toBeNull()
    expect(matchWinner([1, 0], 1)).toBe(0)
    expect(matchWinner([2, 1], 3)).toBeNull()
    expect(matchWinner([2, 3], 3)).toBe(1)
  })

  it('a bot solving move by move reaches the solution', () => {
    const { puzzle, solution } = generate(5, GIVENS.normal)
    const grid = puzzle.slice()
    const rng = new Rng(5)
    let mistakes = 0
    for (let n = 0; n < 200 && !isSolved(grid, solution); n++) {
      const m = nextMove(grid, 'easy', rng)
      if (!m) break
      if (m.digit === solution[m.cell]) grid[m.cell] = m.digit
      else mistakes++
    }
    expect(isSolved(grid, solution)).toBe(true)
    expect(mistakes).toBeGreaterThanOrEqual(0)
  })
})

describe('sudoku entries', () => {
  const { puzzle, solution } = generate(6, GIVENS.normal)
  const blank = puzzle.findIndex((v) => v === 0)

  it('fills the right digit, flags a wrong one, ignores no selection and filled cells', () => {
    const right = solution[blank] as number
    expect(entry(puzzle, solution, blank, right)).toBe('right')
    expect(entry(puzzle, solution, blank, (right % 9) + 1)).toBe('wrong')
    expect(entry(puzzle, solution, -1, right)).toBe('none')
    const given = puzzle.findIndex((v) => v !== 0)
    expect(entry(puzzle, solution, given, 1)).toBe('none')
  })

  it('a digit already placed nine times is inert, not a free penalty', () => {
    // Fill every cell of one digit, leave another cell blank: typing that digit there does nothing.
    const grid = solution.slice()
    const d = solution[blank] === 1 ? 2 : 1
    const other = grid.findIndex((v, i) => v !== d && i !== blank)
    grid[other] = 0
    expect(digitCounts(grid)[d]).toBe(9)
    expect(entry(grid, solution, other, d)).toBe('none')
    expect(entry(grid, solution, other, solution[other] as number)).toBe('right')
  })
})

describe('sudoku race', () => {
  it('waits while the rival can still beat the solver', () => {
    expect(raceWinner({ done: true, clock: 120 }, { done: false, clock: 100 })).toBeNull()
    expect(raceWinner({ done: false, clock: 90 }, { done: false, clock: 100 })).toBeNull()
  })

  it('gives the round to the solver once the rival clock reaches its time', () => {
    expect(raceWinner({ done: true, clock: 120 }, { done: false, clock: 120 })).toBe(0)
    expect(raceWinner({ done: false, clock: 200 }, { done: true, clock: 130 })).toBe(1)
  })

  it('counts penalties: a later but cleaner finish wins', () => {
    // Red finished first but its mistakes put it at 140; blue finishes clean at 135.
    expect(raceWinner({ done: true, clock: 140 }, { done: true, clock: 135 })).toBe(1)
    expect(raceWinner({ done: true, clock: 100 }, { done: true, clock: 100 })).toBe('draw')
  })
})

describe('sudoku deductions', () => {
  const { puzzle, solution } = generate(8, GIVENS.easy)

  it('lists units of nine distinct cells covering the board three times', () => {
    expect(UNITS).toHaveLength(27)
    const seen = Array<number>(81).fill(0)
    for (const u of UNITS) {
      expect(new Set(u).size).toBe(9)
      for (const i of u) seen[i] = (seen[i] ?? 0) + 1
    }
    expect(seen.every((n) => n === 3)).toBe(true)
  })

  it('naked and hidden singles are always the solution digit', () => {
    const naked = nakedSingles(puzzle)
    const hidden = hiddenSingles(puzzle)
    expect(naked.length + hidden.length).toBeGreaterThan(0)
    for (const m of [...naked, ...hidden]) expect(m.digit).toBe(solution[m.cell])
    for (const m of naked) expect(candidateList(puzzle, m.cell)).toEqual([m.digit])
  })
})

describe('sudoku bot', () => {
  function solve(d: 'easy' | 'normal' | 'hard', seed: number): { moves: number; mistakes: number } {
    const { puzzle, solution } = generate(seed, GIVENS[d])
    const grid = puzzle.slice()
    const rng = new Rng(seed)
    let mistakes = 0
    let moves = 0
    let avoid: { cell: number; digit: number } | null = null
    while (!isSolved(grid, solution) && moves < 400) {
      const m = nextMove(grid, d, rng, avoid)
      if (!m) break
      moves++
      expect(m.cell === avoid?.cell && m.digit === avoid.digit).toBe(false)
      if (m.digit === solution[m.cell]) {
        grid[m.cell] = m.digit
        avoid = null
      } else {
        mistakes++
        avoid = { cell: m.cell, digit: m.digit }
      }
    }
    expect(isSolved(grid, solution)).toBe(true)
    return { moves, mistakes }
  }

  it('hard never makes a mistake; easy makes clearly more than hard', () => {
    let easy = 0
    let hard = 0
    for (const seed of [11, 12, 13, 14]) {
      easy += solve('easy', seed).mistakes
      hard += solve('hard', seed).mistakes
    }
    expect(hard).toBe(0)
    expect(easy).toBeGreaterThan(hard)
  })

  it('normal finishes every puzzle', () => {
    for (const seed of [21, 22]) solve('normal', seed)
  })
})

describe('sudoku difficulty', () => {
  it('hard puzzles have fewer clues, and every round of a match tightens to a floor', () => {
    expect(GIVENS.easy).toBeGreaterThan(GIVENS.normal)
    expect(GIVENS.normal).toBeGreaterThan(GIVENS.hard)
    expect(givensFor('normal', 0)).toBe(GIVENS.normal)
    expect(givensFor('normal', 1)).toBe(GIVENS.normal - 2)
    expect(givensFor('hard', 50)).toBeGreaterThan(20)
    for (const d of ['easy', 'normal', 'hard'] as const)
      for (let r = 1; r < 6; r++) expect(givensFor(d, r)).toBeLessThanOrEqual(givensFor(d, r - 1))
  })

  it('solves from the board alone, and finds nothing on a broken grid', () => {
    const { puzzle, solution } = generate(31, GIVENS.hard)
    expect(solve(puzzle)).toEqual(solution)
    const broken = puzzle.slice()
    const i = broken.findIndex((v) => v === 0)
    const peer = (PEERS[i] as number[]).find((p) => broken[p] !== 0) as number
    broken[i] = broken[peer] as number
    expect(solve(broken)).toBeNull()
  })

  it('a hard bot beats an easy one on the same puzzle in most seeded races', () => {
    // Race clock: the bot's think time per entry plus the penalty for each mistake.
    const clock = (d: 'easy' | 'hard', seed: number): number => {
      const { puzzle, solution } = generate(seed, GIVENS.hard)
      const grid = puzzle.slice()
      const rng = new Rng(seed * 3 + (d === 'hard' ? 1 : 2))
      let t = 0
      let avoid: { cell: number; digit: number } | null = null
      for (let n = 0; n < 400 && !isSolved(grid, solution); n++) {
        const m = nextMove(grid, d, rng, avoid)
        if (!m) break
        t += PACE[d] * (m.think * rng.range(0.6, 1.2) + 0.15)
        if (m.digit === solution[m.cell]) {
          grid[m.cell] = m.digit
          avoid = null
        } else {
          t += 10
          avoid = m
        }
      }
      return t
    }
    let hardWins = 0
    const seeds = [41, 42, 43, 44, 45, 46]
    for (const seed of seeds) if (clock('hard', seed) < clock('easy', seed)) hardWins++
    expect(hardWins).toBeGreaterThanOrEqual(seeds.length - 1)
  })
})
