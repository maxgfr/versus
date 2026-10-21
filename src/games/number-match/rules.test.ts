import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { nextMove, PACE } from './bot.ts'
import {
  addRest,
  ADDS,
  anyPair,
  canPair,
  CAPACITY,
  collapse,
  COLS,
  cross,
  left,
  pairs,
  START,
  START_ROWS,
  startNumbers,
  touching,
} from './rules.ts'

/** A row of nine: the digits as text, zeros are crossed out cells. */
const row = (s: string): number[] => s.split('').map(Number)

describe('number match pairs', () => {
  it('pairs equal digits and digits that sum to ten', () => {
    const v = row('191822888')
    expect(canPair(v, 0, 1)).toBe(true) // 1 + 9, touching
    expect(canPair(v, 3, 4)).toBe(true) // 8 + 2, touching
    expect(canPair(v, 4, 5)).toBe(true) // 2 and 2, touching
    expect(canPair(v, 0, 2)).toBe(false) // 1 + 1 = 2
    expect(canPair(v, 2, 6)).toBe(false) // 1 + 8 = 9
  })

  it('needs touching cells, or only crossed-out cells between them in reading order', () => {
    const open = [1, ...Array.from({ length: 16 }, () => 0), 9]
    expect(canPair(open, 0, 17)).toBe(true)
    const blocked = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 9]
    expect(canPair(blocked, 0, 18)).toBe(false) // 1 + 9, but the 2 lies between them
  })

  it('a number between them in reading order blocks a pair that is not touching', () => {
    const v = [4, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 6]
    expect(canPair(v, 0, 18)).toBe(false) // 4 + 6, but the 3 at index 9 lies between
    v[9] = 0
    expect(canPair(v, 0, 18)).toBe(true) // now only crossed-out cells lie between
  })

  it('counts vertical and diagonal neighbours as touching', () => {
    // 1 at (row 0, col 8), 9 at (row 1, col 7): diagonal neighbours.
    const v = Array.from({ length: 18 }, (_, i) => (i === 8 ? 1 : i === 16 ? 9 : 0))
    expect(touching(8, 16)).toBe(true)
    expect(canPair(v, 8, 16)).toBe(true)
    // 1 at (0, 0), 9 at (1, 0): vertical neighbours.
    const w = Array.from({ length: 18 }, (_, i) => (i === 0 ? 1 : i === 9 ? 9 : 0))
    expect(canPair(w, 0, 9)).toBe(true)
  })

  it('never pairs a number with itself, or with a crossed-out cell', () => {
    const v = row('500000000')
    expect(canPair(v, 0, 0)).toBe(false)
    expect(canPair(v, 0, 2)).toBe(false) // a crossed-out cell is not a number
    expect(canPair(v, 0, 1)).toBe(false) // 5 + 0 is not 10 and 0 is empty
    const twins = row('550000000')
    expect(canPair(twins, 0, 1)).toBe(true)
  })

  it('lists every pair on the board', () => {
    expect(pairs(row('555000000'))).toEqual([
      [0, 1],
      [1, 2],
    ])
  })
})

describe('number match rows', () => {
  it('crossing out clears both cells without collapsing a partly empty row', () => {
    const vals = [...row('419191919'), ...row('777777777')]
    expect(canPair(vals, 0, 2)).toBe(false)
    const r = cross(vals, 0, 1)
    expect(r.rows).toBe(0)
    expect(r.vals.slice(0, 2)).toEqual([0, 0])
    expect(left(r.vals)).toBe(vals.length - 2)
  })

  it('a row cleared to nothing collapses and the rows below move up', () => {
    const top = row('123456789')
    const below = row('777777777')
    const vals = [...top, ...below]
    // Clear the top row by pairing it off: remove 1+9, 2+8, 3+7, 4+6, 5+5 (only 5 and 5 need two 5s).
    let v = vals.slice()
    v[0] = 0
    v[8] = 0
    v[1] = 0
    v[7] = 0
    v[2] = 0
    v[6] = 0
    v[3] = 0
    v[5] = 0
    v[4] = 0
    const c = collapse(v)
    expect(c.rows).toBe(1)
    expect(c.vals).toEqual(below)
  })

  it('after a row collapses, cells on either side of it are reading-order neighbours', () => {
    // A 9 at the end of row 0 and a 1 at the start of row 2, with row 1 entirely crossed out.
    const vals = [...row('000000009'), ...row('000000000'), ...row('100000000')]
    expect(canPair(vals, 8, 18)).toBe(true) // 9 + 1, and only crossed-out cells lie between them
    const collapsed = collapse(vals)
    expect(collapsed.rows).toBe(1)
    expect(canPair(collapsed.vals, 8, 9)).toBe(true)
  })

  it('Add copies the numbers left, in reading order, after the last number', () => {
    const vals = [...row('105000300'), ...row('000070000')]
    const r = addRest(vals)
    // The crossed-out cells after the last number (the 7) are reused.
    expect(r.from).toBe(14)
    expect(r.vals).toEqual([...vals.slice(0, 14), 1, 5, 3, 7])
    expect(left(r.vals)).toBe(8)
  })

  it('Add stops copying at the board capacity', () => {
    const full = Array.from({ length: CAPACITY - 4 }, (_, i) => (i % 9) + 1)
    const r = addRest(full)
    expect(r.vals).toHaveLength(CAPACITY)
    expect(r.vals.slice(CAPACITY - 4)).toEqual([1, 2, 3, 4])
  })

  it('a crossed-out partial last row collapses too', () => {
    const vals = [...row('123456789'), 0, 0, 0]
    expect(collapse(vals)).toEqual({ vals: row('123456789'), rows: 1, removed: [1] })
  })

  it('collapse reports which rows it removed', () => {
    const vals = [...row('000000000'), ...row('100000009'), ...row('000000000'), ...row('5')]
    const c = collapse(vals)
    expect(c.removed).toEqual([0, 2])
    expect(c.vals).toEqual([...row('100000009'), 5])
  })

  it('finds whether any pair is left, and agrees with the full list', () => {
    expect(anyPair(row('123412341'))).toBe(false)
    expect(anyPair(row('123412346'))).toBe(true) // 4 and 6 touch and make ten
    for (let seed = 1; seed < 40; seed++) {
      const v = startNumbers(seed)
      for (let i = 0; i < v.length; i += 3) v[i] = 0
      expect(anyPair(v)).toBe(pairs(v).length > 0)
    }
  })

  it('the opening board has four rows', () => {
    expect(startNumbers(3)).toHaveLength(START_ROWS * COLS)
    expect(START).toBe(START_ROWS * COLS)
    expect(startNumbers(3)).toEqual(startNumbers(3))
  })
})

describe('number match bot', () => {
  it('only plays legal pairs', () => {
    const vals = startNumbers(12)
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const m = nextMove(vals, ADDS, d, new Rng(1))
      expect(m?.kind).toBe('pair')
      if (m?.kind === 'pair') expect(canPair(vals, m.i, m.j)).toBe(true)
    }
  })

  it('adds a row when stuck, and gives up when stuck with no adds left', () => {
    const stuck = row('123412341')
    expect(pairs(stuck)).toEqual([])
    expect(nextMove(stuck, 2, 'hard', new Rng(1))).toEqual({ kind: 'add' })
    expect(nextMove(stuck, 0, 'hard', new Rng(1))).toBeNull()
  })

  it('has a pace per difficulty', () => {
    expect(PACE.easy).toBeGreaterThan(PACE.normal)
    expect(PACE.normal).toBeGreaterThan(PACE.hard)
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`a bot game at ${d} ends within bounded steps`, () => {
      let vals = startNumbers(21)
      let adds = 0
      const rng = new Rng(9)
      let steps = 0
      while (left(vals) > 0 && steps < 2000) {
        steps++
        const m = nextMove(vals, ADDS - adds, d, rng)
        if (!m) break
        if (m.kind === 'add') {
          vals = addRest(vals).vals
          adds++
        } else vals = cross(vals, m.i, m.j).vals
      }
      expect(steps).toBeLessThan(2000)
      expect(vals.length).toBeLessThanOrEqual(CAPACITY)
    })
  }
})
