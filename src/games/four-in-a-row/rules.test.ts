import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './ai.ts'
import {
  addRound,
  type Board,
  type Cell,
  COLS,
  dropRow,
  emptyBoard,
  legalColumns,
  matchOver,
  nextStarter,
  outcome,
  play,
  ROWS,
  winLine,
} from './rules.ts'

/** Build a board from text rows (top first): `r` = red (side 0), `b` = blue (side 1), `.` = empty. */
function board(rows: string[]): Board {
  return rows.flatMap((row) => [...row].map((ch): Cell => (ch === 'r' ? 0 : ch === 'b' ? 1 : null)))
}

/** Play a list of columns, alternating sides from `starter`. */
function drops(cols: number[], starter: Side = 0): Board {
  let b = emptyBoard()
  let turn = starter
  for (const c of cols) {
    b = play(b, c, turn)
    turn = turn === 0 ? 1 : 0
  }
  return b
}

describe('four in a row rules', () => {
  it('starts empty with every column open', () => {
    expect(emptyBoard()).toHaveLength(COLS * ROWS)
    expect(legalColumns(emptyBoard())).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(outcome(emptyBoard())).toBeNull()
  })

  it('discs fall to the lowest empty row and stack upwards', () => {
    expect(dropRow(emptyBoard(), 3)).toBe(ROWS - 1)
    const b = drops([3, 3, 3])
    expect(b[(ROWS - 1) * COLS + 3]).toBe(0)
    expect(b[(ROWS - 2) * COLS + 3]).toBe(1)
    expect(b[(ROWS - 3) * COLS + 3]).toBe(0)
    expect(dropRow(b, 3)).toBe(ROWS - 4)
  })

  it('refuses a full column and drops nothing into it', () => {
    const full = drops([0, 0, 0, 0, 0, 0])
    expect(dropRow(full, 0)).toBe(-1)
    expect(legalColumns(full)).not.toContain(0)
    expect(() => play(full, 0, 1)).toThrow()
  })

  it('does not mutate the board it was given', () => {
    const b = emptyBoard()
    play(b, 2, 0)
    expect(b.every((c) => c === null)).toBe(true)
  })

  it('detects a horizontal four on the bottom row', () => {
    const b = drops([0, 0, 1, 1, 2, 2, 3])
    expect(outcome(b)).toMatchObject({ winner: 0, line: [35, 36, 37, 38] })
  })

  it('detects a vertical four', () => {
    const b = drops([0, 1, 0, 1, 0, 1, 0])
    expect(outcome(b)).toMatchObject({ winner: 0, line: [14, 21, 28, 35] })
  })

  it('detects a down-right diagonal', () => {
    const b = board(['.......', '.......', 'r......', '.r.....', '..r....', '...r...'])
    expect(outcome(b)).toMatchObject({ winner: 0, line: [14, 22, 30, 38] })
  })

  it('detects a down-left diagonal for blue', () => {
    const b = board(['.......', '.......', '......b', '.....b.', '....b..', '...b...'])
    expect(winLine(b)).toMatchObject({ side: 1, line: [20, 26, 32, 38] })
  })

  it('three in a row is not a win', () => {
    expect(
      outcome(board(['.......', '.......', '.......', '.......', '.......', 'rrr....'])),
    ).toBeNull()
  })

  it('a four broken by the other colour is not a win', () => {
    expect(
      outcome(board(['.......', '.......', '.......', '.......', '.......', 'rrbrr..'])),
    ).toBeNull()
  })

  it('a full board with no four is a draw', () => {
    // Colour (row + floor(col / 2)) mod 2: rows and diagonals never run past two.
    const cells: Cell[] = Array.from({ length: COLS * ROWS }, (_, i) => {
      const r = Math.floor(i / COLS)
      const c = i % COLS
      return ((r + Math.floor(c / 2)) % 2) as Side
    })
    expect(legalColumns(cells)).toHaveLength(0)
    expect(outcome(cells)).toEqual({ winner: 'draw' })
  })

  it('the round starter alternates and round wins only count real wins', () => {
    expect(nextStarter(0)).toBe(1)
    expect(nextStarter(1)).toBe(0)
    expect(addRound([0, 0], { winner: 1, line: [] })).toEqual([0, 1])
    expect(addRound([1, 0], { winner: 'draw' })).toEqual([1, 0])
    expect(addRound([1, 0], null)).toEqual([1, 0])
  })

  it('a match is decided at the chosen number of round wins', () => {
    expect(matchOver([1, 1], 2)).toBeNull()
    expect(matchOver([2, 0], 2)).toBe(0)
    expect(matchOver([1, 2], 2)).toBe(1)
    // A longer match (first to 3) is not over at two round wins.
    expect(matchOver([2, 0], 3)).toBeNull()
    expect(matchOver([3, 1], 3)).toBe(0)
    expect(matchOver([1, 3], 3)).toBe(1)
  })
})

describe('four in a row bot', () => {
  it('always plays a legal column', () => {
    const rng = new Rng(3)
    let cells = emptyBoard()
    let turn: Side = 0
    for (let i = 0; i < COLS * ROWS && !outcome(cells); i++) {
      const col = choose({ cells, turn }, 'easy', rng.int(1, 1e6))
      expect(legalColumns(cells)).toContain(col)
      cells = play(cells, col, turn)
      turn = turn === 0 ? 1 : 0
    }
  })

  it('takes an immediate win as either side', () => {
    // Red has three on the bottom row; blue to move must block, red to move wins.
    const threat = board(['.......', '.......', '.......', '.......', '.......', 'rrr....'])
    expect(choose({ cells: threat, turn: 0 }, 'normal', 1)).toBe(3)
    const blueWins = board(['.......', '.......', '.......', '.......', '.......', 'bbb....'])
    expect(choose({ cells: blueWins, turn: 1 }, 'normal', 2)).toBe(3)
  })

  it('blocks an open three on hard', () => {
    // Red threatens four on the bottom row; blue has no win, so it must take column 3.
    const threat = board(['.......', '.......', '.......', '.......', 'b......', 'rrr....'])
    expect(choose({ cells: threat, turn: 1 }, 'hard', 4)).toBe(3)
  })

  it('easy still takes a win or blocks one on its random moves', () => {
    const threat = board(['.......', '.......', '.......', '.......', '.......', 'rrr....'])
    for (let seed = 1; seed <= 30; seed++) {
      expect(choose({ cells: threat, turn: 0 }, 'easy', seed)).toBe(3)
      expect(choose({ cells: threat, turn: 1 }, 'easy', seed)).toBe(3)
    }
  })

  it('hard beats easy and normal beats easy head to head, either side starting', () => {
    const duel = (a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard', seed: number) => {
      let cells = emptyBoard()
      let turn: Side = seed % 2 === 0 ? 0 : 1
      for (let n = 0; ; n++) {
        const o = outcome(cells)
        if (o) return o.winner
        cells = play(cells, choose({ cells, turn }, turn === 0 ? a : b, seed * 100 + n), turn)
        turn = turn === 0 ? 1 : 0
      }
    }
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 4; seed++) {
      if (duel('hard', 'easy', seed) === 0) hard++
      if (duel('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(3)
    expect(normal).toBeGreaterThanOrEqual(3)
  }, 60000)

  it('finishes whole matches computer against computer within bounded moves', () => {
    for (const [seed, difficulty, target] of [
      [5, 'normal', 2],
      [6, 'easy', 2],
      [7, 'normal', 3],
      [8, 'hard', 1],
    ] as const) {
      const rng = new Rng(seed)
      let wins: [number, number] = [0, 0]
      let starter: Side = seed % 2 === 0 ? 0 : 1
      let rounds = 0
      while (matchOver(wins, target) === null) {
        // A round is at most one disc per cell; draws do not count, so bound the rounds too.
        expect(rounds).toBeLessThan(20)
        let cells = emptyBoard()
        let turn = starter
        let moves = 0
        let o = outcome(cells)
        while (!o) {
          const col = choose({ cells, turn }, difficulty, rng.int(1, 1e6))
          cells = play(cells, col, turn)
          turn = turn === 0 ? 1 : 0
          moves++
          expect(moves).toBeLessThanOrEqual(COLS * ROWS)
          o = outcome(cells)
        }
        wins = addRound(wins, o)
        starter = nextStarter(starter)
        rounds++
      }
      expect(matchOver(wins, target)).not.toBeNull()
    }
  })
})
