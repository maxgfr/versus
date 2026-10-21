import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { dealPairs } from '../../engines/cards/index.ts'
import { choose, type Memory, remember } from './bot.ts'
import {
  canTurn,
  cleared,
  hideMiss,
  matchWinner,
  newTable,
  PAIRS,
  pairsOf,
  turnUp,
} from './rules.ts'

describe('memory rules', () => {
  it('decides the match at the chosen number of round wins, draws never count', () => {
    expect(matchWinner([0, 0], 1)).toBeNull()
    expect(matchWinner([1, 0], 1)).toBe(0)
    expect(matchWinner([2, 1], 3)).toBeNull()
    expect(matchWinner([1, 3], 3)).toBe(1)
  })

  it('deals every pair twice', () => {
    const deck = dealPairs(new Rng(3), PAIRS)
    expect(deck).toHaveLength(PAIRS * 2)
    for (let p = 0; p < PAIRS; p++) expect(deck.filter((d) => d === p)).toHaveLength(2)
  })

  it('keeps a match and passes on a miss', () => {
    const t = newTable([0, 1, 0, 1])
    expect(turnUp(t, 0, 0)).toBeNull()
    expect(turnUp(t, 2, 0)).toBe('match')
    expect(pairsOf(t, 0)).toBe(1)
    expect(t.up).toEqual([])
    expect(turnUp(t, 1, 1)).toBeNull()
    expect(canTurn(t, 0)).toBe(false)
    expect(turnUp(t, 3, 1)).toBe('match')
    expect(cleared(t)).toBe(true)
  })

  it('turns a miss back down', () => {
    const t = newTable([0, 1, 1, 0])
    turnUp(t, 0, 0)
    expect(turnUp(t, 1, 0)).toBe('miss')
    expect(canTurn(t, 2)).toBe(false)
    hideMiss(t)
    expect(t.faceUp).toEqual([false, false, false, false])
    expect(canTurn(t, 0)).toBe(true)
  })
})

describe('memory bot', () => {
  it('completes a pair it remembers', () => {
    const t = newTable([0, 1, 2, 0, 1, 2])
    const mem: Memory = [0, null, null, 0, null, null]
    expect([0, 3]).toContain(choose(t, mem, new Rng(1)))
    turnUp(t, 0, 1)
    expect(choose(t, mem, new Rng(1))).toBe(3)
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot clears the board (${difficulty})`, () => {
      const rng = new Rng(11)
      const t = newTable(dealPairs(rng, PAIRS))
      const mem: Memory = t.deck.map(() => null)
      let side: 0 | 1 = 0
      let turns = 0
      while (!cleared(t)) {
        if (++turns > 2000) throw new Error('stuck')
        const i = choose(t, mem, rng)
        const r = turnUp(t, i, side)
        remember(mem, i, t.deck[i] ?? 0, difficulty, rng)
        if (r === 'miss') {
          hideMiss(t)
          side = side === 0 ? 1 : 0
        }
      }
      expect(pairsOf(t, 0) + pairsOf(t, 1)).toBe(PAIRS)
    })
  }

  it('hard needs fewer turns than easy on average', () => {
    const play = (difficulty: 'easy' | 'hard', seed: number) => {
      const rng = new Rng(seed)
      const t = newTable(dealPairs(rng, PAIRS))
      const mem: Memory = t.deck.map(() => null)
      let picks = 0
      while (!cleared(t)) {
        const i = choose(t, mem, rng)
        picks++
        const r = turnUp(t, i, 0)
        remember(mem, i, t.deck[i] ?? 0, difficulty, rng)
        if (r === 'miss') hideMiss(t)
      }
      return picks
    }
    let easy = 0
    let hard = 0
    for (let s = 0; s < 20; s++) {
      easy += play('easy', s)
      hard += play('hard', s)
    }
    expect(hard).toBeLessThan(easy)
  })
})
