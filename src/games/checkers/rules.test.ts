import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose, searchMoves } from './bot.ts'
import {
  apply,
  type Cell,
  count,
  hops,
  idx,
  legalMoves,
  MAX_PLIES,
  material,
  type Move,
  outcome,
  start,
} from './rules.ts'

/** Build a board from a list of [row, col, cell] placements. */
function board(...pieces: [number, number, Cell][]): Cell[] {
  const b: Cell[] = Array<Cell>(64).fill(0)
  for (const [r, c, cell] of pieces) b[idx(r, c)] = cell
  return b
}

const RED = 1
const RED_KING = 2
const BLUE = 3
const BLUE_KING = 4

/** Moves as "from>to>to" square-pair strings, for readable assertions. */
const paths = (moves: Move[]) => moves.map((m) => m.path.join('>')).sort()

describe('checkers rules', () => {
  it('starts with twelve men a side on dark squares', () => {
    const b = start()
    expect(count(b, 0)).toBe(12)
    expect(count(b, 1)).toBe(12)
    expect(b.every((cell, i) => cell === 0 || (Math.floor(i / 8) + (i % 8)) % 2 === 1)).toBe(true)
  })

  it('gives red seven opening moves, all forward', () => {
    const moves = legalMoves(start(), 0)
    expect(moves).toHaveLength(7)
    for (const m of moves) expect(m.path[1]! < m.path[0]!).toBe(true)
  })

  it('lets a man move diagonally forward only', () => {
    const b = board([4, 3, RED])
    expect(paths(legalMoves(b, 0))).toEqual(
      [`${idx(4, 3)}>${idx(3, 2)}`, `${idx(4, 3)}>${idx(3, 4)}`].sort(),
    )
  })

  it('forces a capture over every quiet move', () => {
    const b = board([5, 2, RED], [4, 3, RED], [3, 4, BLUE], [0, 7, RED])
    const moves = legalMoves(b, 0)
    expect(moves.every((m) => m.captured.length > 0)).toBe(true)
    expect(paths(moves)).toEqual([`${idx(4, 3)}>${idx(2, 5)}`])
  })

  it('continues a multi-jump until nothing is left to take', () => {
    // Red at (6,1) takes (5,2) to (4,3), then (3,4) to (2,5).
    const b = board([6, 1, RED], [5, 2, BLUE], [3, 4, BLUE], [7, 6, RED])
    const moves = legalMoves(b, 0)
    expect(moves).toEqual([
      { path: [idx(6, 1), idx(4, 3), idx(2, 5)], captured: [idx(5, 2), idx(3, 4)] },
    ])
  })

  it('does not jump the same piece twice', () => {
    // A man circling a single blue piece cannot take it twice.
    const b = board([6, 1, RED], [5, 2, BLUE], [3, 0, RED])
    const moves = legalMoves(b, 0)
    expect(moves.every((m) => new Set(m.captured).size === m.captured.length)).toBe(true)
    expect(moves.every((m) => m.captured.length <= 1)).toBe(true)
  })

  it('crowns a man that ends its move on the far row', () => {
    const b = board([1, 2, RED], [0, 1, 0], [7, 0, BLUE])
    const m = legalMoves(b, 0).find((x) => x.path[1] === idx(0, 3))!
    const { board: next, crowned } = apply(b, m)
    expect(crowned).toBe(true)
    expect(next[idx(0, 3)]).toBe(RED_KING)
  })

  it('stops a jumping man on the far row and crowns it', () => {
    // Red jumps (1,2) to land on (0,3); a blue man at (1,4) would be next, but a man jumps forward only.
    const b = board([2, 1, RED], [1, 2, BLUE], [1, 4, BLUE])
    const moves = legalMoves(b, 0)
    expect(moves).toEqual([{ path: [idx(2, 1), idx(0, 3)], captured: [idx(1, 2)] }])
    expect(apply(b, moves[0]!).crowned).toBe(true)
  })

  it('never lets a man jump backward', () => {
    const b = board([3, 3, RED], [4, 4, BLUE])
    expect(legalMoves(b, 0).every((m) => m.captured.length === 0)).toBe(true)
  })

  it('moves a king one square in any diagonal direction', () => {
    const b = board([4, 3, RED_KING], [7, 0, BLUE])
    const targets = legalMoves(b, 0)
      .map((m) => m.path[m.path.length - 1]!)
      .sort((x, y) => x - y)
    expect(targets).toEqual([idx(3, 2), idx(3, 4), idx(5, 2), idx(5, 4)])
  })

  it('does not let a king jump from a distance', () => {
    const b = board([0, 7, RED_KING], [3, 4, BLUE])
    expect(legalMoves(b, 0).every((m) => m.captured.length === 0)).toBe(true)
  })

  it('kings jump backward too, and chain jumps both ways', () => {
    const b = board([3, 3, BLUE_KING], [4, 4, RED], [2, 6, RED])
    const moves = legalMoves(b, 1)
    // (3,3) takes (4,4) to (5,5)... nothing more. The king at (3,3) cannot reach (2,6).
    expect(moves).toEqual([{ path: [idx(3, 3), idx(5, 5)], captured: [idx(4, 4)] }])
    const back = board([5, 5, BLUE_KING], [4, 4, RED], [2, 4, RED])
    expect(legalMoves(back, 1)).toEqual([
      { path: [idx(5, 5), idx(3, 3), idx(1, 5)], captured: [idx(4, 4), idx(2, 4)] },
    ])
  })

  it('ends the game when the rival has no pieces', () => {
    expect(outcome(board([4, 3, RED]), 1, 10)).toEqual({ winner: 0, note: 'No pieces left' })
  })

  it('ends the game when the side to move is blocked', () => {
    // Blue man at (6,1) cannot step to (7,0) or (7,2), both held, and has nothing to jump.
    const b = board([6, 1, BLUE], [7, 0, RED], [7, 2, RED])
    expect(legalMoves(b, 1)).toEqual([])
    expect(outcome(b, 1, 10)).toEqual({ winner: 0, note: 'No move left' })
  })

  it('judges the material at the move limit', () => {
    const b = board([4, 3, RED_KING], [1, 6, BLUE], [0, 1, BLUE])
    expect(material(b)).toEqual({ 0: 1.6, 1: 2 })
    expect(outcome(b, 1, MAX_PLIES)).toEqual({
      winner: 1,
      note: 'Most material at the move limit',
    })
    expect(outcome(board([4, 3, RED], [1, 6, BLUE]), 1, MAX_PLIES)?.winner).toBe('draw')
    expect(outcome(b, 1, MAX_PLIES - 1)).toBeNull()
  })

  it('plays out a full game with random choices within the ply cap', () => {
    const rng = new Rng(5)
    let b = start()
    let turn: 0 | 1 = 0
    let ply = 0
    let result = outcome(b, turn, ply)
    while (!result) {
      const moves = legalMoves(b, turn)
      const m = rng.pick(moves)
      b = apply(b, m).board
      turn = turn === 0 ? 1 : 0
      ply++
      result = outcome(b, turn, ply)
      expect(ply).toBeLessThanOrEqual(MAX_PLIES)
    }
    expect(result.winner).toBeDefined()
  })
})

describe('checkers hops', () => {
  it('says which piece each jump takes', () => {
    const man = { path: [idx(6, 1), idx(4, 3), idx(2, 5)], captured: [idx(5, 2), idx(3, 4)] }
    expect(hops(man)).toEqual([[idx(5, 2)], [idx(3, 4)]])
    const king = { path: [idx(2, 5), idx(4, 3)], captured: [idx(3, 4)] }
    expect(hops(king)).toEqual([[idx(3, 4)]])
    expect(hops({ path: [idx(5, 0), idx(4, 1)], captured: [] })).toEqual([[]])
  })
})

describe('checkers bot', () => {
  it('takes the free piece on hard', () => {
    const b = board([5, 2, RED], [4, 3, BLUE], [7, 6, BLUE])
    const m = choose({ board: b, turn: 0, ply: 0 }, 'hard', new Rng(1))
    expect(m.captured).toEqual([idx(4, 3)])
  })

  it('answers for either side, at every level', () => {
    const b = start()
    for (const level of ['easy', 'normal', 'hard'] as const) {
      const m = choose({ board: b, turn: 1, ply: 3 }, level, new Rng(4))
      expect(legalMoves(b, 1)).toContainEqual(m)
    }
  })

  it('plays computer against computer to a result', () => {
    const rng = new Rng(9)
    let b = start()
    let turn: 0 | 1 = 0
    let ply = 0
    let result = outcome(b, turn, ply)
    while (!result) {
      const m = choose({ board: b, turn, ply }, turn === 0 ? 'easy' : 'normal', rng)
      b = apply(b, m).board
      turn = turn === 0 ? 1 : 0
      ply++
      result = outcome(b, turn, ply)
    }
    expect(result.note).toBeDefined()
    expect(ply).toBeLessThanOrEqual(MAX_PLIES)
  }, 60_000)
})

describe('checkers search', () => {
  it('generates exactly the legal moves, through whole random games', () => {
    const rng = new Rng(21)
    for (let game = 0; game < 6; game++) {
      let b = start()
      let turn: 0 | 1 = game % 2 === 0 ? 0 : 1
      for (let ply = 0; ply < MAX_PLIES && !outcome(b, turn, ply); ply++) {
        const key = (m: Move) => `${m.path.join('>')}x${[...m.captured].sort().join(',')}`
        const want = legalMoves(b, turn).map(key).sort()
        expect(searchMoves(b, turn).map(key).sort()).toEqual(want)
        b = apply(b, rng.pick(legalMoves(b, turn))).board
        turn = turn === 0 ? 1 : 0
      }
    }
  })

  const duel = (a: 'easy' | 'normal' | 'hard', bl: 'easy' | 'normal' | 'hard', seed: number) => {
    const rng = new Rng(seed)
    let b = start()
    let turn: 0 | 1 = seed % 2 === 0 ? 0 : 1
    for (let ply = 0; ; ply++) {
      const o = outcome(b, turn, ply)
      if (o) return o.winner
      b = apply(b, choose({ board: b, turn, ply }, turn === 0 ? a : bl, rng)).board
      turn = turn === 0 ? 1 : 0
    }
  }

  it('hard beats easy and normal beats easy, either side opening', () => {
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 2; seed++) {
      if (duel('hard', 'easy', seed) === 0) hard++
      if (duel('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBe(2)
    expect(normal).toBe(2)
  }, 120_000)
})
