import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { decide, planHold } from './bot.ts'
import {
  CATS,
  emptySheet,
  full,
  MAX_ROLLS,
  NCATS,
  openRows,
  score,
  total,
  turnsPlayed,
  type Sheet,
} from './rules.ts'

const cat = (id: string) => CATS.findIndex((c) => c.id === id)

describe('yazy scoring', () => {
  it('scores odds, evens and chance', () => {
    expect(score([1, 3, 5, 2, 4], cat('odds'))).toBe(9)
    expect(score([1, 3, 5, 2, 4], cat('evens'))).toBe(6)
    expect(score([1, 3, 5, 2, 4], cat('chance'))).toBe(15)
  })

  it('scores alike rows only when earned', () => {
    expect(score([2, 2, 2, 5, 6], cat('three'))).toBe(17)
    expect(score([2, 2, 3, 5, 6], cat('three'))).toBe(0)
    expect(score([4, 4, 4, 4, 1], cat('four'))).toBe(17)
    expect(score([4, 4, 4, 1, 1], cat('four'))).toBe(0)
  })

  it('scores full house, runs and yazy', () => {
    expect(score([3, 3, 5, 5, 5], cat('house'))).toBe(25)
    expect(score([3, 3, 5, 5, 6], cat('house'))).toBe(0)
    expect(score([1, 2, 3, 4, 6], cat('small'))).toBe(30)
    expect(score([2, 3, 4, 5, 6], cat('large'))).toBe(40)
    expect(score([1, 2, 3, 5, 6], cat('small'))).toBe(0)
    expect(score([6, 6, 6, 6, 6], cat('yazy'))).toBe(50)
    expect(score([6, 6, 6, 6, 5], cat('yazy'))).toBe(0)
  })

  it('tracks sheets', () => {
    const s = emptySheet()
    expect(s).toHaveLength(NCATS)
    expect(openRows(s)).toHaveLength(NCATS)
    s[0] = 10
    s[3] = 5
    expect(total(s)).toBe(15)
    expect(full(s)).toBe(false)
  })

  it('ends a shorter match after its turns, not after the whole sheet', () => {
    const s = emptySheet()
    s[0] = 10
    s[4] = 0
    s[8] = 20
    expect(turnsPlayed(s)).toBe(3)
    expect(full(s, 3)).toBe(true)
    expect(full(s, 4)).toBe(false)
    expect(full(s)).toBe(false)
  })
})

describe('yazy bot', () => {
  it('keeps four of a kind and rerolls the odd one', () => {
    const plan = planHold([6, 6, 6, 6, 2], emptySheet())
    expect(plan.held).toEqual([true, true, true, true, false])
  })

  it('takes a yazy when it has one', () => {
    const a = decide(
      [5, 5, 5, 5, 5],
      [false, false, false, false, false],
      1,
      emptySheet(),
      'hard',
      new Rng(1),
    )
    expect(a).toEqual({ kind: 'score', cat: cat('yazy') })
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`plays a full ${difficulty} game bot vs bot`, () => {
      const rng = new Rng(42)
      const sheets: [Sheet, Sheet] = [emptySheet(), emptySheet()]
      let turn: 0 | 1 = 0
      let guard = 0
      while (!(full(sheets[0]) && full(sheets[1]))) {
        let dice = [1, 1, 1, 1, 1]
        let held = [false, false, false, false, false]
        let rolls = 0
        for (;;) {
          if (++guard > 10_000) throw new Error('stuck')
          const a = decide(dice, held, rolls, sheets[turn], difficulty, rng)
          if (a.kind === 'roll') {
            expect(rolls).toBeLessThan(MAX_ROLLS)
            dice = dice.map((v, i) => (held[i] ? v : rng.int(1, 6)))
            rolls++
          } else if (a.kind === 'hold') held = a.held
          else {
            expect(sheets[turn][a.cat]).toBeNull()
            sheets[turn][a.cat] = score(dice, a.cat)
            break
          }
        }
        turn = turn === 0 ? 1 : 0
      }
      expect(total(sheets[0]) + total(sheets[1])).toBeGreaterThan(0)
    })
  }
})
