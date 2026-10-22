import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { decide, planHold } from './bot.ts'
import {
  emptySheet,
  full,
  isLegal,
  jokerOn,
  legalRows,
  MAX_ROLLS,
  NROWS,
  openRows,
  ROWS,
  rowScore,
  type Sheet,
  scoreRow,
  total,
  turnsPlayed,
  upperBonus,
  upperSum,
  YAZY_ROW,
} from './rules.ts'

const row = (id: string) => ROWS.findIndex((r) => r.id === id)

/** A sheet where only the rows in `open` are still empty; the rest hold 0. */
function sheetWithOpen(open: number[]): Sheet {
  const s = emptySheet()
  s.rows = s.rows.map((_, i) => (open.includes(i) ? null : 0))
  return s
}

describe('classic scoring', () => {
  it('has thirteen rows and the upper section first', () => {
    expect(ROWS).toHaveLength(NROWS)
    expect(ROWS.slice(0, 6).map((r) => r.label)).toEqual([
      'Aces',
      'Twos',
      'Threes',
      'Fours',
      'Fives',
      'Sixes',
    ])
    expect(YAZY_ROW).toBe(row('yazy'))
  })

  it('scores upper rows as the sum of their face', () => {
    expect(rowScore([1, 1, 3, 4, 6], row('ones'))).toBe(2)
    expect(rowScore([5, 5, 5, 5, 5], row('fives'))).toBe(25)
    expect(rowScore([2, 3, 4, 5, 6], row('sixes'))).toBe(6)
    expect(rowScore([2, 3, 4, 5, 6], row('twos'))).toBe(2)
  })

  it('scores alike rows only when earned', () => {
    expect(rowScore([2, 2, 2, 5, 6], row('three'))).toBe(17)
    expect(rowScore([2, 2, 3, 5, 6], row('three'))).toBe(0)
    expect(rowScore([4, 4, 4, 4, 1], row('four'))).toBe(17)
    expect(rowScore([4, 4, 4, 1, 1], row('four'))).toBe(0)
    expect(rowScore([4, 4, 4, 1, 1], row('chance'))).toBe(14)
  })

  it('scores full house, straights and yazy', () => {
    expect(rowScore([3, 3, 5, 5, 5], row('house'))).toBe(25)
    expect(rowScore([3, 3, 5, 5, 6], row('house'))).toBe(0)
    expect(rowScore([5, 5, 5, 5, 5], row('house'))).toBe(0)
    expect(rowScore([1, 2, 3, 4, 6], row('small'))).toBe(30)
    expect(rowScore([1, 2, 3, 5, 6], row('small'))).toBe(0)
    expect(rowScore([2, 3, 4, 5, 6], row('large'))).toBe(40)
    expect(rowScore([1, 2, 3, 4, 6], row('large'))).toBe(0)
    expect(rowScore([6, 6, 6, 6, 6], row('yazy'))).toBe(50)
    expect(rowScore([6, 6, 6, 6, 5], row('yazy'))).toBe(0)
  })

  it('gives the upper bonus at exactly 63, not 62', () => {
    const s = emptySheet()
    // 3 of each face: 3+6+9+12+15+18 = 63.
    for (let f = 0; f < 6; f++) s.rows[f] = 3 * (f + 1)
    expect(upperSum(s)).toBe(63)
    expect(upperBonus(s)).toBe(35)
    s.rows[0] = 2
    expect(upperSum(s)).toBe(62)
    expect(upperBonus(s)).toBe(0)
  })

  it('totals rows, the upper bonus and yazy bonuses', () => {
    const s = emptySheet()
    s.rows = s.rows.map((_, i) => (i < 6 ? 3 * (i + 1) : 10))
    expect(total(s)).toBe(63 + 35 + 7 * 10)
    s.yazyBonus = 2
    expect(total(s)).toBe(63 + 35 + 70 + 200)
  })

  it('tracks open rows and fullness', () => {
    const s = emptySheet()
    expect(openRows(s)).toHaveLength(NROWS)
    expect(full(s)).toBe(false)
    s.rows = s.rows.map(() => 1)
    expect(full(s)).toBe(true)
  })

  it('ends a shorter match after its turns', () => {
    const s = emptySheet()
    s.rows[0] = 4
    s.rows[7] = 0
    s.rows[12] = 22
    expect(turnsPlayed(s)).toBe(3)
    expect(full(s, 3)).toBe(true)
    expect(full(s, 4)).toBe(false)
    expect(full(s)).toBe(false)
  })
})

describe('classic yazy bonus and joker', () => {
  it('does not give a bonus while the yazy row is not 50', () => {
    const s = emptySheet()
    expect(jokerOn([4, 4, 4, 4, 4], s)).toBe(false)
    s.rows[YAZY_ROW] = 0
    expect(jokerOn([4, 4, 4, 4, 4], s)).toBe(false)
  })

  it('scores a bonus yazy as joker in the lower rows', () => {
    const s = emptySheet()
    s.rows[YAZY_ROW] = 50
    const dice = [5, 5, 5, 5, 5]
    expect(rowScore(dice, row('small'), true)).toBe(30)
    expect(rowScore(dice, row('large'), true)).toBe(40)
    expect(rowScore(dice, row('house'), true)).toBe(25)
    expect(rowScore(dice, row('three'), true)).toBe(25)
    expect(rowScore(dice, row('chance'), true)).toBe(25)
  })

  it('forces a bonus yazy into its open upper row', () => {
    const s = emptySheet()
    s.rows = s.rows.map((_, i) => (i === YAZY_ROW ? 50 : i === 3 ? null : 0))
    const dice = [4, 4, 4, 4, 4]
    expect(legalRows(dice, s)).toEqual([3])
    expect(isLegal(dice, s, row('small'))).toBe(false)
    expect(isLegal(dice, s, 3)).toBe(true)
  })

  it('lets a bonus yazy go to any open row once its upper row is filled', () => {
    const s = sheetWithOpen([row('small'), row('house'), row('chance')])
    s.rows[YAZY_ROW] = 50
    s.rows[3] = 12
    const dice = [4, 4, 4, 4, 4]
    expect(legalRows(dice, s)).toEqual([row('house'), row('small'), row('chance')])
  })

  it('adds 100 per bonus yazy when scored and counts it in the total', () => {
    const s = emptySheet()
    s.rows[YAZY_ROW] = 50
    const res = scoreRow(s, [2, 2, 2, 2, 2], row('large'))
    expect(res).toEqual({ points: 40, bonus: 100 })
    expect(s.rows[row('large')]).toBe(40)
    expect(s.yazyBonus).toBe(1)
    expect(total(s)).toBe(50 + 40 + 100)
  })

  it('a joker must take an open lower row before any other upper row', () => {
    // Fours filled, Aces and the lower rows Full house and Chance open.
    const s = sheetWithOpen([0, row('house'), row('chance')])
    s.rows[YAZY_ROW] = 50
    s.rows[3] = 12
    const dice = [4, 4, 4, 4, 4]
    expect(legalRows(dice, s)).toEqual([row('house'), row('chance')])
    expect(isLegal(dice, s, 0)).toBe(false)
  })

  it('a joker may only zero an upper row once every lower row is filled', () => {
    const s = sheetWithOpen([0, 1])
    s.rows[YAZY_ROW] = 50
    s.rows[3] = 12
    expect(legalRows([4, 4, 4, 4, 4], s)).toEqual([0, 1])
    expect(scoreRow(s, [4, 4, 4, 4, 4], 0)).toEqual({ points: 0, bonus: 100 })
  })

  it('joker rules still apply after a zeroed Yazy row, without the bonus', () => {
    const s = emptySheet()
    s.rows[YAZY_ROW] = 0
    // Its own upper row first.
    expect(legalRows([3, 3, 3, 3, 3], s)).toEqual([2])
    s.rows[2] = 9
    // Then the lower rows at full joker value, but no +100.
    expect(legalRows([3, 3, 3, 3, 3], s)).not.toContain(0)
    expect(scoreRow(s, [3, 3, 3, 3, 3], row('house'))).toEqual({ points: 25, bonus: 0 })
    expect(s.yazyBonus).toBe(0)
  })

  it('scores a real yazy normally into its own row', () => {
    const s = emptySheet()
    const res = scoreRow(s, [6, 6, 6, 6, 6], YAZY_ROW)
    expect(res).toEqual({ points: 50, bonus: 0 })
    expect(s.yazyBonus).toBe(0)
  })
})

describe('classic bot', () => {
  it('keeps four of a kind and rerolls the odd one', () => {
    const plan = planHold([6, 6, 6, 6, 2], emptySheet())
    expect(plan.held).toEqual([true, true, true, true, false])
  })

  it('takes a yazy into its row when it is open', () => {
    const a = decide(
      [5, 5, 5, 5, 5],
      [false, false, false, false, false],
      1,
      emptySheet(),
      'hard',
      new Rng(1),
    )
    expect(a).toEqual({ kind: 'score', row: YAZY_ROW })
  })

  it('takes the bonus yazy into the forced upper row', () => {
    const s = emptySheet()
    s.rows[YAZY_ROW] = 50
    const a = decide([5, 5, 5, 5, 5], [true, true, true, true, true], 1, s, 'hard', new Rng(3))
    expect(a).toEqual({ kind: 'score', row: row('fives') })
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`plays a full ${difficulty} game bot vs bot to a result in bounded steps`, () => {
      const rng = new Rng(42)
      const sheets: [Sheet, Sheet] = [emptySheet(), emptySheet()]
      let turn: 0 | 1 = 0
      let steps = 0
      while (!(full(sheets[0]) && full(sheets[1]))) {
        let dice = [1, 1, 1, 1, 1]
        let held = [false, false, false, false, false]
        let rolls = 0
        for (;;) {
          if (++steps > 20_000) throw new Error('stuck')
          const a = decide(dice, held, rolls, sheets[turn], difficulty, rng)
          if (a.kind === 'roll') {
            expect(rolls).toBeLessThan(MAX_ROLLS)
            dice = dice.map((v, i) => (held[i] ? v : rng.int(1, 6)))
            rolls++
          } else if (a.kind === 'hold') held = a.held
          else {
            expect(legalRows(dice, sheets[turn])).toContain(a.row)
            scoreRow(sheets[turn], dice, a.row)
            break
          }
        }
        turn = turn === 0 ? 1 : 0
      }
      expect(total(sheets[0]) + total(sheets[1])).toBeGreaterThan(0)
    })
  }

  it('normal and hard play far better games than easy on average', () => {
    const play = (difficulty: 'easy' | 'normal' | 'hard', seed: number) => {
      const rng = new Rng(seed)
      const sheet = emptySheet()
      while (!full(sheet)) {
        let dice = [1, 1, 1, 1, 1]
        let held = [false, false, false, false, false]
        let rolls = 0
        for (;;) {
          const a = decide(dice, held, rolls, sheet, difficulty, rng)
          if (a.kind === 'roll') {
            dice = dice.map((v, i) => (held[i] ? v : rng.int(1, 6)))
            rolls++
          } else if (a.kind === 'hold') held = a.held
          else {
            scoreRow(sheet, dice, a.row)
            break
          }
        }
      }
      return total(sheet)
    }
    let hard = 0
    let normal = 0
    let easy = 0
    for (let seed = 1; seed <= 60; seed++) {
      hard += play('hard', seed)
      normal += play('normal', seed)
      easy += play('easy', seed)
    }
    // Measured over 400 seeded games: easy 130, normal 236, hard 242. The
    // hard-normal gap is real but too small to show reliably over 60 games.
    expect(normal / 60).toBeGreaterThan(easy / 60 + 60)
    expect(hard / 60).toBeGreaterThan(easy / 60 + 60)
  }, 60_000)
})
