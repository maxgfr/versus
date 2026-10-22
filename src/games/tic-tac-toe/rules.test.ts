import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import { type Cell, emptyBoard, moves, outcome, place, threats } from './rules.ts'

const board = (s: string): Cell[] => [...s].map((ch) => (ch === 'o' ? 0 : ch === 'x' ? 1 : null))

describe('tic tac toe rules', () => {
  it('starts empty with nine moves', () => {
    expect(moves(emptyBoard())).toHaveLength(9)
    expect(outcome(emptyBoard())).toBeNull()
  })

  it('detects rows, columns and diagonals', () => {
    expect(outcome(board('ooo......'))).toMatchObject({ winner: 0, line: [0, 1, 2] })
    expect(outcome(board('x..x..x..'))).toMatchObject({ winner: 1, line: [0, 3, 6] })
    expect(outcome(board('..o.o.o..'))).toMatchObject({ winner: 0, line: [2, 4, 6] })
  })

  it('detects a draw on a full board', () => {
    expect(outcome(board('oxooxxxoo'))).toEqual({ winner: 'draw' })
  })

  it('counts open threats (two in a line with the third empty)', () => {
    expect(threats(board('oo.......'), 0)).toBe(1)
    expect(threats(board('oox......'), 0)).toBe(0)
    // A fork: two ways to win at once.
    expect(threats(board('o.o...o..'), 0)).toBe(3)
    expect(threats(board('oo.......'), 1)).toBe(0)
  })

  it('a win on the last cell is a win, not a draw', () => {
    expect(outcome(board('oxoxoxxoo'))).toMatchObject({ winner: 0 })
  })

  it('refuses a taken cell', () => {
    expect(() => place(board('o........'), 0, 1)).toThrow()
  })
})

describe('tic tac toe bot', () => {
  it('takes a winning move', () => {
    const rng = new Rng(1)
    expect(choose(board('xx.oo....'), 1, 'normal', rng)).toBe(2)
  })

  it('blocks on hard', () => {
    const rng = new Rng(2)
    expect(choose(board('oo..x....'), 1, 'hard', rng)).toBe(2)
  })

  it('never loses on hard (bot vs bot always draws)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = new Rng(seed)
      let cells = emptyBoard()
      let turn: 0 | 1 = (seed % 2) as 0 | 1
      while (!outcome(cells)) {
        cells = place(cells, choose(cells, turn, 'hard', rng), turn)
        turn = turn === 0 ? 1 : 0
      }
      expect(outcome(cells)).toEqual({ winner: 'draw' })
    }
  })

  it('normal never misses a block, and beats easy far more than it loses', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(choose(board('oo..x....'), 1, 'normal', new Rng(seed))).toBe(2)
    }
    let won = 0
    let lost = 0
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Rng(seed)
      const normal = (seed % 2) as 0 | 1
      let cells = emptyBoard()
      let turn: 0 | 1 = 0
      while (!outcome(cells)) {
        cells = place(cells, choose(cells, turn, turn === normal ? 'normal' : 'easy', rng), turn)
        turn = turn === 0 ? 1 : 0
      }
      const o = outcome(cells)
      if (o?.winner === normal) won++
      else if (o?.winner !== 'draw') lost++
    }
    expect(won).toBeGreaterThan(lost * 5)
  })

  it('easy still finishes games with legal moves', () => {
    const rng = new Rng(7)
    let cells = emptyBoard()
    let turn: 0 | 1 = 0
    while (!outcome(cells)) {
      const m = choose(cells, turn, 'easy', rng)
      expect(cells[m]).toBeNull()
      cells = place(cells, m, turn)
      turn = turn === 0 ? 1 : 0
    }
  })
})
