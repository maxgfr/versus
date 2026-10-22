import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  apply,
  burst,
  CELLS,
  cellsOf,
  emptyPosition,
  evaluate,
  legalCells,
  neighbours,
  type Position,
  settle,
  unstable,
  winner,
} from './rules.ts'

/** Put dots on the board directly: `[cell, owner, dots]` triples. */
function board(turn: Side, moved: [boolean, boolean], cells: [number, Side, number][]): Position {
  const p = emptyPosition(turn)
  p.moved = moved
  for (const [i, owner, dots] of cells) {
    p.owner[i] = owner
    p.dots[i] = dots
  }
  return p
}

describe('color wars rules', () => {
  it('lets the first move claim any empty cell with three dots', () => {
    const p = emptyPosition(0)
    expect(legalCells(p)).toHaveLength(CELLS)
    const next = apply(p, 12)
    expect(next.owner[12]).toBe(0)
    expect(next.dots[12]).toBe(3)
    expect(next.turn).toBe(1)
    expect(next.moved).toEqual([true, false])
  })

  it('restricts later moves to one of your own cells', () => {
    const p = board(
      0,
      [true, true],
      [
        [0, 0, 1],
        [24, 1, 2],
      ],
    )
    expect(legalCells(p)).toEqual([0])
    expect(() => apply(p, 24)).toThrow()
    expect(apply(p, 0).dots[0]).toBe(2)
  })

  it('refuses a claim on a taken cell', () => {
    const p = board(1, [true, false], [[12, 0, 3]])
    expect(() => apply(p, 12)).toThrow()
  })

  it('bursts a four-dot cell into its neighbours and converts them', () => {
    expect(neighbours(12).sort((a, b) => a - b)).toEqual([7, 11, 13, 17])
    const p = board(1, [true, true], [[12, 0, 4]])
    const next = burst(p, [12])
    expect(next.owner[12]).toBeNull()
    expect(next.dots[12]).toBe(0)
    for (const n of [7, 11, 13, 17]) {
      expect(next.owner[n]).toBe(0)
      expect(next.dots[n]).toBe(1)
    }
  })

  it('gives a corner cell only two neighbours', () => {
    const next = burst(board(0, [true, true], [[0, 0, 4]]), [0])
    expect(next.dots[1]).toBe(1)
    expect(next.dots[5]).toBe(1)
    expect(next.dots.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('chains bursts until every cell is stable', () => {
    // Red's burst makes cell 13 a four-dot cell, which bursts in turn.
    const p = board(
      1,
      [true, true],
      [
        [12, 0, 4],
        [13, 0, 3],
        [14, 1, 1],
        [24, 1, 1],
      ],
    )
    const done = settle(p)
    expect(unstable(done)).toEqual([])
    expect(winner(done)).toBeNull()
    expect(cellsOf(done, 0)).toBeGreaterThan(cellsOf(p, 0))
  })

  it('ends the game as soon as the rival has no cells, mid-chain', () => {
    // Red's burst at cell 0 converts blue's only cell (1) and the rival is out.
    const p = board(
      1,
      [true, true],
      [
        [0, 0, 4],
        [1, 1, 3],
      ],
    )
    const next = burst(p, [0])
    expect(cellsOf(next, 1)).toBe(0)
    expect(winner(next)).toBe(0)
    expect(winner(settle(p))).toBe(0)
  })

  it('does not end the game before both sides have moved', () => {
    const p = board(1, [true, false], [[0, 0, 3]])
    expect(cellsOf(p, 1)).toBe(0)
    expect(winner(p)).toBeNull()
  })

  it('keeps cells and dots within bounds through a long game', () => {
    const rng = new Rng(7)
    let p = emptyPosition(0)
    for (let step = 0; step < 300 && winner(p) === null; step++) {
      p = settle(apply(p, rng.pick(legalCells(p))))
      expect(p.dots.every((d) => d >= 0)).toBe(true)
      if (winner(p) === null) for (const d of p.dots) expect(d).toBeLessThan(4)
    }
  })
})

describe('color wars bot', () => {
  it('always returns a legal cell', () => {
    const rng = new Rng(3)
    let p = emptyPosition(0)
    for (let step = 0; step < 10 && winner(p) === null; step++) {
      const side = p.turn
      const m = choose(p, side, step % 2 === 0 ? 'easy' : 'normal', rng)
      expect(legalCells(p, side)).toContain(m)
      p = settle(apply(p, m))
    }
  })

  it('takes the move that eliminates the rival', () => {
    // Red's burst at cell 0 sweeps blue's only cell (1) and the chain ends the game.
    const p = board(
      0,
      [true, true],
      [
        [0, 0, 3],
        [1, 1, 3],
        [6, 0, 1],
      ],
    )
    expect(choose(p, 0, 'normal', new Rng(4))).toBe(0)
    expect(choose(p, 0, 'hard', new Rng(4))).toBe(0)
  })

  it('finishes games at every level within a bounded number of moves', () => {
    const levels = [
      ['easy', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
      ['hard', 'hard'],
    ] as const
    for (const [a, b] of levels) {
      for (let seed = 1; seed <= 2; seed++) {
        const rng = new Rng(seed * 13)
        let p = emptyPosition((seed % 2) as Side)
        let moves = 0
        while (winner(p) === null && moves < 600) {
          const side = p.turn
          p = settle(apply(p, choose(p, side, side === 0 ? a : b, rng)))
          moves++
        }
        expect(winner(p)).not.toBeNull()
        expect(evaluate(p, 0) + evaluate(p, 1)).toBe(0)
      }
    }
  })
})

describe('color wars runaway chains and strength', () => {
  it('a board too full to ever sit still is still settled in bounded time', () => {
    // 25 cells at three dots plus one more: more dots than 25 stable cells can hold.
    const cells: [number, Side, number][] = []
    for (let i = 0; i < CELLS; i++) cells.push([i, i % 2 === 0 ? 0 : 1, 3])
    const p = board(0, [true, true], cells)
    p.dots[12] = 4
    const q = settle(p)
    // It returned (a side was wiped out mid-chain, or the wave cap stopped it), and
    // bursts never make dots: they are kept or lost at the edges.
    expect(q.dots.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(76)
  })

  const duel = (a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard', seed: number) => {
    const rng = new Rng(seed)
    let p = emptyPosition(seed % 2 === 0 ? 0 : 1)
    for (let t = 0; t < 300; t++) {
      const w = winner(p)
      if (w !== null) return w
      p = settle(apply(p, choose(p, p.turn, p.turn === 0 ? a : b, rng)))
    }
    return 'draw'
  }

  it('hard beats normal and normal beats easy, either side opening', () => {
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 6; seed++) {
      if (duel('hard', 'normal', seed) === 0) hard++
      if (duel('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(5)
    expect(normal).toBeGreaterThanOrEqual(5)
  }, 30000)
})
