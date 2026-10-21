import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { FIND_TIME, findDelay } from './bot.ts'
import {
  champion,
  DECK,
  FREEZE,
  layoutCard,
  newFind,
  projectivePlane,
  shared,
  SYMBOLS,
  symbolAt,
  tap,
  TARGET,
  target,
  type FindState,
} from './rules.ts'

describe('projective plane deck', () => {
  it('has 57 cards of 8 symbols over 57 symbols', () => {
    expect(DECK).toHaveLength(57)
    for (const c of DECK) {
      expect(c).toHaveLength(8)
      expect(new Set(c).size).toBe(8)
    }
    expect(SYMBOLS).toHaveLength(57)
    expect(new Set(SYMBOLS).size).toBe(57)
  })

  it('makes every pair of cards share exactly one symbol', () => {
    for (let i = 0; i < DECK.length; i++)
      for (let j = i + 1; j < DECK.length; j++) {
        const common = DECK[i]?.filter((s) => DECK[j]?.includes(s)).length
        expect(common).toBe(1)
      }
  })

  it('puts every symbol on exactly 8 cards', () => {
    for (let s = 0; s < 57; s++) expect(DECK.filter((c) => c.includes(s))).toHaveLength(8)
  })

  it('finds the shared symbol between two cards', () => {
    const a = DECK[0] ?? []
    const b = DECK[5] ?? []
    const s = shared(a, b)
    expect(a).toContain(s)
    expect(b).toContain(s)
    expect(shared([0, 1, 2], [3, 4, 5])).toBe(-1)
  })

  it('builds the plane for other prime orders too', () => {
    const p = projectivePlane(3)
    expect(p).toHaveLength(13)
    for (const line of p) expect(line).toHaveLength(4)
  })
})

describe('find match layouts', () => {
  it('scatters the eight symbols without overlap, inside the card', () => {
    const rng = new Rng(17)
    for (let line = 0; line < 57; line++) {
      const l = layoutCard(rng, line)
      expect(l.items.map((i) => i.s).sort((x, y) => x - y)).toEqual(
        [...(DECK[line] ?? [])].sort((x, y) => x - y),
      )
      for (let i = 0; i < l.items.length; i++) {
        const a = l.items[i]
        expect(a).toBeDefined()
        expect(Math.hypot(a?.x ?? 0, a?.y ?? 0) + (a?.r ?? 0)).toBeLessThanOrEqual(240)
        for (let j = i + 1; j < l.items.length; j++) {
          const b = l.items[j]
          expect(
            Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0)),
          ).toBeGreaterThanOrEqual((a?.r ?? 0) + (b?.r ?? 0))
        }
      }
    }
  })

  it('reads the symbol under a point, or none', () => {
    const l = layoutCard(new Rng(3), 0)
    const it = l.items[0]
    expect(symbolAt(l, it?.x ?? 0, it?.y ?? 0)).toBe(it?.s)
    expect(symbolAt(l, 9999, 9999)).toBe(-1)
  })
})

describe('find match race', () => {
  const deal = (seed: number) => newFind(new Rng(seed), 0)

  it('deals a centre card and two own cards, all distinct', () => {
    const s = deal(4)
    const lines = [s.centre.line, s.own[0].line, s.own[1].line]
    expect(new Set(lines).size).toBe(3)
    expect(s.queue).toHaveLength(54)
  })

  it('scores the right symbol, moves the card to the centre and deals a new one', () => {
    const rng = new Rng(4)
    const s = newFind(rng, 0)
    const old = s.own[0]
    const sym = target(s, 0)
    expect(tap(s, 0, sym, 1, rng)).toBe('hit')
    expect(s.score).toEqual([1, 0])
    expect(s.centre.line).toBe(old.line)
    expect(s.own[0].line).not.toBe(old.line)
    expect(s.flySide).toBe(0)
    expect(s.flyAt).toBe(1)
    // The new centre and the other side's card still share exactly one symbol.
    expect(shared(DECK[s.centre.line] ?? [], DECK[s.own[1].line] ?? [])).toBeGreaterThanOrEqual(0)
    expect(target(s, 1)).toBeGreaterThanOrEqual(0)
  })

  it('freezes a side for a second after a wrong symbol', () => {
    const rng = new Rng(9)
    const s = newFind(rng, 0)
    const wrong = (DECK[s.own[0].line] ?? []).find((x) => x !== target(s, 0)) ?? -1
    expect(tap(s, 0, wrong, 2, rng)).toBe('miss')
    expect(s.score).toEqual([0, 0])
    expect(tap(s, 0, target(s, 0), 2 + FREEZE / 2, rng)).toBe('ignored')
    expect(tap(s, 0, target(s, 0), 2 + FREEZE, rng)).toBe('hit')
  })

  it('ignores taps that hit no symbol', () => {
    const rng = new Rng(2)
    const s = newFind(rng, 0)
    expect(tap(s, 1, -1, 1, rng)).toBe('ignored')
    expect(s.score).toEqual([0, 0])
  })

  it('never deals the same card twice on the table', () => {
    const rng = new Rng(21)
    const s: FindState = newFind(rng, 0)
    let now = 0
    for (let i = 0; i < 10; i++) {
      now += 1
      const side = (i % 2) as 0 | 1
      tap(s, side, target(s, side), now, rng)
      const visible = [s.centre.line, s.own[0].line, s.own[1].line]
      expect(new Set(visible).size).toBe(3)
    }
    expect(s.score[0] + s.score[1]).toBe(10)
  })

  it('gives the computer a reaction window by difficulty', () => {
    const rng = new Rng(1)
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const [lo, hi] = FIND_TIME[d]
      for (let i = 0; i < 200; i++) {
        const t = findDelay(d, rng)
        expect(t).toBeGreaterThanOrEqual(lo)
        expect(t).toBeLessThanOrEqual(hi)
      }
    }
    expect(FIND_TIME.hard[1]).toBeLessThan(FIND_TIME.normal[0])
    expect(FIND_TIME.normal[1]).toBeLessThan(FIND_TIME.easy[0])
  })

  for (const bot of [2, 3, 4] as const) {
    it(`computer vs computer finds a champion in bounded steps (seed ${bot})`, () => {
      const rng = new Rng(bot * 101)
      const s = newFind(rng, 0)
      const delay: [number, number] = [0, 0]
      const plan = (side: 0 | 1, now: number) => {
        delay[side] = now + findDelay('hard', rng)
      }
      plan(0, 0)
      plan(1, 0)
      let now = 0
      let steps = 0
      while (champion(s, TARGET) === null) {
        if (++steps > 60 * 60 * 10) throw new Error('no champion')
        now += 1 / 60
        for (const side of [0, 1] as const) {
          if (now >= delay[side]) {
            const before = s.centre.line
            tap(s, side, target(s, side), now, rng)
            if (s.centre.line !== before) {
              plan(0, now)
              plan(1, now)
            }
          }
        }
      }
      expect(Math.max(...s.score)).toBe(TARGET)
      expect(s.queue.length).toBeGreaterThan(0)
    })
  }
})
