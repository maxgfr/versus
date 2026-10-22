import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose, hardDepth } from './bot.ts'
import {
  type Cell,
  emptyPosition,
  evaluate,
  isLegal,
  legalMoves,
  play,
  type Position,
  verdict,
  winningCells,
} from './rules.ts'

const none = (): Cell[] => Array<Cell>(81).fill(null)

/** A position where the given small boards are already won. */
function withWon(won: Cell[], active = -1, turn: Side = 0): Position {
  return { turn, cells: none(), won, active }
}

/** Fill small board `b` with a full draw: no line for either side. */
function drawnBoard(cells: Cell[], b: number): void {
  const pattern: Side[] = [1, 0, 1, 1, 0, 0, 0, 1, 1]
  pattern.forEach((v, i) => {
    cells[b * 9 + i] = v
  })
}

describe('ultimate tic tac toe rules', () => {
  it('opens with 81 legal moves, anywhere', () => {
    expect(legalMoves(emptyPosition(0))).toHaveLength(81)
  })

  it('sends the rival to the small board with the same number', () => {
    // Red plays cell 4 of board 0, so blue must answer in board 4.
    const next = play(emptyPosition(0), 4)
    expect(next.active).toBe(4)
    expect(next.turn).toBe(1)
    const moves = legalMoves(next)
    expect(moves).toHaveLength(9)
    expect(moves.every((m) => m >= 36 && m <= 44)).toBe(true)
  })

  it('frees the rival when the target small board is already won', () => {
    // Red plays cell 2 of board 0, which sends blue to board 2. Board 2 is won.
    const next = play(withWon([null, null, 0, null, null, null, null, null, null]), 2)
    expect(next.active).toBe(-1)
    expect(legalMoves(next)).toHaveLength(71)
    expect(isLegal(next, 18)).toBe(false)
  })

  it('frees the rival when the target small board is full', () => {
    const p = withWon(Array<Cell>(9).fill(null))
    drawnBoard(p.cells, 3)
    const next = play(p, 3)
    expect(next.active).toBe(-1)
    expect(legalMoves(next)).toHaveLength(71)
  })

  it('frees the rival when the move wins the very board it sends them to', () => {
    // Red holds cells 0 and 8 of board 4 and plays its centre (cell 4): board 4 is
    // won, and the move would send blue to board 4, which is now closed.
    const p = emptyPosition(0)
    p.cells[36] = 0
    p.cells[44] = 0
    p.cells[0] = 1
    p.cells[9] = 1
    const next = play(p, 40)
    expect(next.won[4]).toBe(0)
    expect(next.active).toBe(-1)
    expect(legalMoves(next).every((m) => Math.floor(m / 9) !== 4)).toBe(true)
  })

  it('marks a small board when someone completes a line on it', () => {
    const p = emptyPosition(0)
    p.cells[0] = 0
    p.cells[1] = 0
    p.active = 0
    const next = play(p, 2)
    expect(next.won[0]).toBe(0)
    expect(next.cells[2]).toBe(0)
  })

  it('records a drawn small board without an owner', () => {
    const p = emptyPosition(0)
    drawnBoard(p.cells, 0)
    p.cells[0] = null // leave one cell open so the move below fills it
    p.active = 0
    const next = play(p, 0)
    expect(next.won[0]).toBeNull()
    expect(next.active).toBe(-1)
  })

  it('wins the game with three small boards in a row', () => {
    const p: Position = {
      turn: 0,
      cells: none(),
      won: [0, 0, null, null, null, null, null, null, null],
      active: 2,
    }
    p.cells[18] = 0
    p.cells[19] = 0
    const next = play(p, 20)
    expect(next.won[2]).toBe(0)
    expect(verdict(next)).toMatchObject({ winner: 0, line: [0, 1, 2] })
  })

  it('decides by most boards when every board is closed', () => {
    // Red wins 5 small boards, blue 4, and no line: red takes it.
    const won: Cell[] = [0, 0, 1, 1, 0, 0, 0, 1, 1]
    expect(verdict(withWon(won))).toEqual({ winner: 0, line: null, boards: [5, 4] })
  })

  it('draws when the boards are level and nobody has a line', () => {
    const won: Cell[] = [1, 0, 1, 0, 1, 0, 0, 1, null]
    const p = withWon(won)
    drawnBoard(p.cells, 8)
    expect(verdict(p)).toEqual({ winner: 'draw', line: null, boards: [4, 4] })
  })

  it('is not decided while a board is still open', () => {
    expect(verdict(emptyPosition(0))).toBeNull()
  })

  it('refuses taken cells, closed boards and the wrong board', () => {
    const first = play(emptyPosition(0), 0)
    expect(() => play(first, 0)).toThrow()
    expect(() => play(first, 9)).toThrow()
    const won: Cell[] = [0, null, null, null, null, null, null, null, null]
    expect(() => play(withWon(won), 1)).toThrow()
    expect(isLegal(withWon(won, 0), 4)).toBe(false)
  })

  it('finds the cells that would complete a small line', () => {
    const p = emptyPosition(0)
    p.cells[0] = 1
    p.cells[1] = 1
    expect(winningCells(p.cells, 0, 1)).toEqual([2])
    expect(winningCells(p.cells, 0, 0)).toEqual([])
  })

  it('evaluates from the point of view of the side asked', () => {
    const p = emptyPosition(0)
    p.won[4] = 0
    p.cells[0] = 0
    p.cells[9] = 1
    expect(evaluate(p, 0)).toBe(-evaluate(p, 1))
    expect(evaluate(p, 0)).toBeGreaterThan(0)
  })
})

describe('ultimate tic tac toe bot', () => {
  it('takes a move that completes a small board when one is available', () => {
    const p = emptyPosition(0)
    p.cells[0] = 0
    p.cells[1] = 0
    p.active = 0
    expect(choose(p, 'normal', new Rng(3))).toBe(2)
  })

  it('searches deeper when the reply is forced into one board', () => {
    expect(hardDepth(emptyPosition(0))).toBeLessThan(hardDepth(play(emptyPosition(0), 4)))
  })

  it('hard beats normal from either seat', () => {
    for (const hardSide of [0, 1] as Side[]) {
      const rng = new Rng(100 + hardSide)
      let p = emptyPosition(hardSide)
      while (!verdict(p)) p = play(p, choose(p, p.turn === hardSide ? 'hard' : 'normal', rng))
      expect(verdict(p)?.winner).toBe(hardSide)
    }
  }, 30_000)

  it('always returns a legal move', () => {
    const rng = new Rng(11)
    let p = emptyPosition(0)
    for (let step = 0; step < 20 && !verdict(p); step++) {
      const difficulty = step % 2 === 0 ? 'easy' : 'normal'
      const m = choose(p, difficulty, rng)
      expect(isLegal(p, m)).toBe(true)
      p = play(p, m)
    }
  })

  it('finishes bot against bot games within 81 moves at every level', () => {
    const levels = [
      ['easy', 'easy'],
      ['normal', 'easy'],
      ['normal', 'normal'],
      ['hard', 'normal'],
    ] as const
    for (const [a, b] of levels) {
      for (let seed = 1; seed <= 2; seed++) {
        const rng = new Rng(seed * 97)
        let p = emptyPosition((seed % 2) as Side)
        let moves = 0
        while (!verdict(p) && moves < 81) {
          p = play(p, choose(p, p.turn === 0 ? a : b, rng))
          moves++
        }
        expect(verdict(p)).not.toBeNull()
      }
    }
  })

  it('hard plays a complete game against normal within the move limit', () => {
    const rng = new Rng(5)
    let p = emptyPosition(0)
    let moves = 0
    while (!verdict(p) && moves < 81) {
      p = play(p, choose(p, p.turn === 0 ? 'hard' : 'normal', rng))
      moves++
    }
    expect(verdict(p)).not.toBeNull()
  })
})
