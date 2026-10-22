import { describe, expect, it } from 'vitest'
import type { Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  apply,
  isOver,
  legalPits,
  nextPos,
  type Position,
  settle,
  sowPath,
  startPosition,
  verdict,
} from './rules.ts'

const total = (pits: readonly number[]) => pits.reduce((a, b) => a + b, 0)

/** A position from explicit pits (14 entries) for the side to move. */
function at(turn: Side, pits: number[]): Position {
  return { turn, pits }
}

describe('mancala rules', () => {
  it('starts with four seeds in each pit and 48 seeds in all', () => {
    const p = startPosition(0)
    expect(total(p.pits)).toBe(48)
    expect(legalPits(p)).toEqual([0, 1, 2, 3, 4, 5])
    expect(legalPits(startPosition(1))).toEqual([7, 8, 9, 10, 11, 12])
  })

  it('sows counter-clockwise and skips the rival store', () => {
    // Red from pit 5 with 9 seeds: its store 6, blue's pits 7-12, skip blue's store 13, then 0 and 1.
    expect(sowPath(0, 5, 9)).toEqual([6, 7, 8, 9, 10, 11, 12, 0, 1])
    // Eight seeds from the same pit end in pit 0.
    expect(sowPath(0, 5, 8).at(-1)).toBe(0)
    // Blue from pit 12 with 2 seeds: its own store 13, then red's pit 0.
    expect(sowPath(1, 12, 2)).toEqual([13, 0])
    // Blue skips red's store (6); red skips blue's store (13).
    expect(nextPos(5, 1)).toBe(7)
    expect(nextPos(5, 0)).toBe(6)
    expect(nextPos(12, 0)).toBe(0)
  })

  it('gives an extra turn when the last seed lands in the mover store', () => {
    const next = apply(at(0, [0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0]), 4)
    expect(next.turn).toBe(0)
    expect(next.pits[6]).toBe(1)
    expect(next.pits[5]).toBe(1)
    expect(settle([0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0], 0, 6).again).toBe(true)
  })

  it('captures the seed landed in an empty pit with the opposite pit', () => {
    // Red's pit 0 has one seed and pit 1 is empty; pit 11 faces pit 1 and holds three.
    const pits = [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 3, 0, 0]
    const next = apply(at(0, pits), 0)
    expect(next.pits[6]).toBe(4)
    expect(next.pits[1]).toBe(0)
    expect(next.pits[11]).toBe(0)
    expect(next.turn).toBe(1)
  })

  it('does not capture when the opposite pit is empty', () => {
    const pits = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    const next = apply(at(0, pits), 0)
    expect(next.pits[6]).toBe(0)
    expect(next.pits[1]).toBe(1)
  })

  it('ends the game when a side is empty and sends the rest home', () => {
    // Red's only seed reaches its store and red has nothing left: blue's seeds go to blue.
    const pits = [0, 0, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 3]
    const next = apply(at(0, pits), 5)
    expect(isOver(next.pits)).toBe(true)
    expect(next.pits[6]).toBe(1)
    expect(next.pits[13]).toBe(5)
    expect(verdict(next)).toEqual({ winner: 1, score: [1, 5] })
  })

  it('declares a draw on equal stores', () => {
    const pits = [0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 4]
    expect(verdict(at(0, pits))).toEqual({ winner: 'draw', score: [4, 4] })
  })

  it('refuses an empty pit and a rival pit', () => {
    const p = startPosition(0)
    expect(() => apply(p, 7)).toThrow()
    expect(() => apply({ ...p, pits: [0, ...p.pits.slice(1)] }, 0)).toThrow()
  })

  it('conserves seeds through random play', () => {
    const rng = new Rng(42)
    for (let game = 0; game < 20; game++) {
      let p = startPosition(game % 2 === 0 ? 0 : 1)
      for (let step = 0; step < 400 && !verdict(p); step++) {
        p = apply(p, rng.pick(legalPits(p)))
        expect(total(p.pits)).toBe(48)
      }
      expect(verdict(p)).not.toBeNull()
    }
  })

  it('lets a long sowing lap back into its own pit', () => {
    // Thirteen seeds from pit 0 go all the way round (skipping blue's store) and the last one lands back in pit 0.
    expect(sowPath(0, 0, 13).at(-1)).toBe(0)
  })
})

describe('mancala bot', () => {
  it('always returns a legal pit', () => {
    const rng = new Rng(9)
    let p = startPosition(0)
    for (let step = 0; step < 6 && !verdict(p); step++) {
      const pit = choose(p, 'easy', rng)
      expect(legalPits(p)).toContain(pit)
      p = apply(p, pit)
    }
  })

  it('takes the capture over a move that gains nothing', () => {
    // Pit 4 lands alone in empty pit 5 and captures blue's five in pit 7; pit 0 gains nothing.
    const p = at(0, [2, 0, 0, 0, 1, 0, 0, 5, 0, 0, 0, 0, 0, 0])
    expect(choose(p, 'hard', new Rng(1))).toBe(4)
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
        const rng = new Rng(seed * 31)
        let p = startPosition((seed % 2) as Side)
        let moves = 0
        while (!verdict(p) && moves < 400) {
          p = apply(p, choose(p, p.turn === 0 ? a : b, rng))
          moves++
        }
        expect(verdict(p)).not.toBeNull()
      }
    }
  })
})

describe('mancala computer strength', () => {
  const duel = (a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard', seed: number) => {
    const rng = new Rng(seed)
    let p = startPosition((seed % 2) as Side)
    for (let n = 0; n < 400; n++) {
      const v = verdict(p)
      if (v) return v.winner
      p = apply(p, choose(p, p.turn === 0 ? a : b, rng))
    }
    return 'draw'
  }

  it('hard beats easy and normal beats easy over seeded games, either side opening', () => {
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 6; seed++) {
      if (duel('hard', 'easy', seed) === 0) hard++
      if (duel('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(5)
    expect(normal).toBeGreaterThanOrEqual(5)
  }, 30000)

  it('hard beats normal more often than not', () => {
    let hard = 0
    for (let seed = 1; seed <= 4; seed++) if (duel('hard', 'normal', seed) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  }, 30000)
})
