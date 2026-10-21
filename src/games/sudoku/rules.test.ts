import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { nextMove } from './bot.ts'
import {
  completedUnits,
  countSolutions,
  digitCounts,
  generate,
  GIVENS,
  isSolved,
  matchWinner,
  PEERS,
  progress,
  roundSeed,
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
      const m = nextMove(grid, solution, 'easy', rng)
      if (!m) break
      if (m.digit === solution[m.cell]) grid[m.cell] = m.digit
      else mistakes++
    }
    expect(isSolved(grid, solution)).toBe(true)
    expect(mistakes).toBeGreaterThanOrEqual(0)
  })
})
