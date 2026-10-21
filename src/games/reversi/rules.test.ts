import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './ai.ts'
import {
  type Board,
  type Cell,
  counts,
  ending,
  flipsAt,
  legalMoves,
  nextTurn,
  play,
  startBoard,
} from './rules.ts'

/** Build a board from text rows (top first): `r` = red (side 0), `b` = blue (side 1), `.` = empty. */
function board(rows: string[]): Board {
  return rows.flatMap((row) => [...row].map((ch): Cell => (ch === 'r' ? 0 : ch === 'b' ? 1 : null)))
}

const EMPTY = Array<string>(8).fill('........')

describe('reversi rules', () => {
  it('starts with the standard four discs and four opening moves for red', () => {
    const b = startBoard()
    expect(counts(b)).toEqual([2, 2])
    expect(legalMoves(b, 0).map((m) => m.at)).toEqual([19, 26, 37, 44])
    expect(legalMoves(b, 1).map((m) => m.at)).toEqual([20, 29, 34, 43])
  })

  it('flips every bracketed rival disc in all directions at once', () => {
    const b = board([
      '........',
      '........',
      '..r.r...',
      '...bb...',
      '..rb....',
      '........',
      '........',
      '........',
    ])
    expect(flipsAt(b, 36, 0).sort((x, y) => x - y)).toEqual([27, 28, 35])
    const r = play(b, 36, 0)
    expect(counts(r.cells)).toEqual([7, 0])
  })

  it('a rival run that is not closed by an own disc flips nothing', () => {
    const b = board(['.bb.....', ...EMPTY.slice(1)])
    expect(flipsAt(b, 3, 0)).toEqual([])
    expect(flipsAt(b, 0, 0)).toEqual([])
  })

  it('refuses an occupied or non-bracketing square', () => {
    const b = startBoard()
    expect(flipsAt(b, 27, 0)).toEqual([])
    expect(flipsAt(b, 0, 0)).toEqual([])
    expect(() => play(b, 0, 0)).toThrow()
  })

  it('does not mutate the board it was given', () => {
    const b = startBoard()
    play(b, 19, 0)
    expect(counts(b)).toEqual([2, 2])
  })

  it('a player with no move passes and the other moves again', () => {
    // Blue has one disc, bracketed by red on one side only against the edge: blue cannot move.
    const b = board(['rrb.....', ...EMPTY.slice(1)])
    expect(legalMoves(b, 1)).toEqual([])
    expect(nextTurn(b, 0)).toEqual({ turn: 0, passed: true })
  })

  it('hands the turn over when the other side can move', () => {
    const b = board(['rbr.....', ...EMPTY.slice(1)])
    expect(nextTurn(b, 0)).toEqual({ turn: 1, passed: false })
  })

  it('the game ends when neither side can move and the most discs wins', () => {
    const red = board(['rrrrrrrr', ...EMPTY.slice(1)])
    expect(ending(red)).toEqual({ winner: 0, counts: [8, 0] })
    expect(nextTurn(red, 0)).toBeNull()
    // A lone blue disc that red can still bracket keeps the game going.
    expect(ending(board(['rrrb....', ...EMPTY.slice(1)]))).toBeNull()
  })

  it('a finished board with equal discs is a draw', () => {
    const cells: Cell[] = Array.from({ length: 64 }, (_, i) => (i % 2) as Side)
    expect(legalMoves(cells, 0)).toEqual([])
    expect(legalMoves(cells, 1)).toEqual([])
    expect(ending(cells)).toEqual({ winner: 'draw', counts: [32, 32] })
  })
})

describe('reversi bot', () => {
  it('always plays a legal square, for either side', () => {
    const rng = new Rng(9)
    for (const turn of [0, 1] as const) {
      const cells = startBoard()
      const move = choose({ cells, turn }, 'easy', rng.int(1, 1e6))
      expect(legalMoves(cells, turn).map((m) => m.at)).toContain(move)
    }
  })

  it('takes a corner when one is on offer', () => {
    // Red can take the corner at 0 (flipping the blue disc at 1) or other squares.
    const b = board([
      '.brr....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    expect(choose({ cells: b, turn: 0 }, 'normal', 3)).toBe(0)
  })

  it('finishes whole games computer against computer within bounded moves', () => {
    for (const [seed, difficulty] of [
      [11, 'normal'],
      [12, 'easy'],
      [13, 'normal'],
    ] as const) {
      const rng = new Rng(seed)
      let cells = startBoard()
      let turn: Side = 0
      let steps = 0
      let passes = 0
      let end = ending(cells)
      while (!end) {
        expect(legalMoves(cells, turn).length).toBeGreaterThan(0)
        const at = choose({ cells, turn }, difficulty, rng.int(1, 1e6))
        cells = play(cells, at, turn).cells
        steps++
        expect(steps).toBeLessThan(200)
        end = ending(cells)
        if (end) break
        const next = nextTurn(cells, turn)
        expect(next).not.toBeNull()
        if (next?.passed) passes++
        turn = next?.turn ?? turn
      }
      expect(end).not.toBeNull()
      // Every move fills one square, so the game is at most 60 moves plus passes.
      expect(steps).toBeLessThanOrEqual(60)
      expect(passes).toBeLessThan(60)
    }
  })
})
