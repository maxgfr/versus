import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { champion, due, press, TARGET } from '../math-quiz/rules.ts'
import { BOT_TIME, planFlagBot } from './bot.ts'
import { COUNTRIES } from './countries.ts'
import { dealFlag, flagAt, makeOptions, nextFlag } from './rules.ts'

const indexOf = (code: string) => COUNTRIES.findIndex((c) => c.code === code)

describe('flag quiz countries', () => {
  it('covers the whole world, each country once', () => {
    expect(COUNTRIES).toHaveLength(197)
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(197)
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(197)
  })

  it('gives every country five distinct traps, all real and none of them itself', () => {
    COUNTRIES.forEach((c, i) => {
      expect(c.traps, c.name).toHaveLength(5)
      expect(new Set(c.traps).size, c.name).toBe(5)
      expect(c.traps, c.name).not.toContain(i)
      expect(Math.min(...c.traps), c.name).toBeGreaterThanOrEqual(0)
    })
  })

  it('never asks players to tell apart two flags the emoji make identical', () => {
    expect(COUNTRIES[indexOf('ID')]?.traps).not.toContain(indexOf('MC'))
    expect(COUNTRIES[indexOf('MC')]?.traps).not.toContain(indexOf('ID'))
  })

  it('builds the flag emoji from the country code', () => {
    expect(COUNTRIES[indexOf('FR')]?.flag).toBe('🇫🇷')
    expect(COUNTRIES[indexOf('JP')]?.flag).toBe('🇯🇵')
  })

  it('sets the classic traps', () => {
    const first = (code: string) => COUNTRIES[COUNTRIES[indexOf(code)]?.traps[0] ?? -1]?.code
    expect(first('TD')).toBe('RO')
    expect(first('IE')).toBe('CI')
    expect(first('AU')).toBe('NZ')
    expect(COUNTRIES[indexOf('NE')]?.traps).toContain(indexOf('NG'))
    expect(COUNTRIES[indexOf('AT')]?.traps).toContain(indexOf('AU'))
  })
})

describe('flag quiz deal', () => {
  it('shows every flag once before any comes back', () => {
    const seen = new Set(COUNTRIES.map((_, n) => flagAt(1234, n)))
    expect(seen.size).toBe(COUNTRIES.length)
    expect(flagAt(1234, COUNTRIES.length)).toBe(flagAt(1234, 0))
  })

  it('always offers the answer and its most tempting trap, four distinct names', () => {
    const rng = new Rng(3)
    COUNTRIES.forEach((c, i) => {
      for (let k = 0; k < 20; k++) {
        const opts = makeOptions(rng, i)
        expect(new Set(opts).size, c.name).toBe(4)
        expect(opts, c.name).toContain(i)
        expect(opts, c.name).toContain(c.traps[0])
        for (const o of opts) if (o !== i) expect(c.traps, c.name).toContain(o)
      }
    })
  })

  it('gives each side the same names in its own order', () => {
    const s = dealFlag(new Rng(9), 77, 0, 0)
    expect([...s.choices[0]].sort((x, y) => x - y)).toEqual([...s.choices[1]].sort((x, y) => x - y))
    expect(s.choices[0]).toContain(s.q.answer)
    expect(s.q.answer).toBe(flagAt(77, 0))
  })

  it('moves on to the next flag keeping the scores and clearing the locks', () => {
    const rng = new Rng(2)
    const s = dealFlag(rng, 5, 0, 0)
    s.score = [3, 1]
    press(s, 0, s.choices[0].indexOf(s.q.answer), 1)
    expect(s.score).toEqual([4, 1])
    nextFlag(s, rng, 2.5)
    expect(s.score).toEqual([4, 1])
    expect(s.done).toBe(false)
    expect(s.locked).toEqual([false, false])
    expect(s.q.answer).toBe(flagAt(5, 1))
  })

  it('can lock a side out without costing it a point', () => {
    const s = dealFlag(new Rng(2), 5, 0, 0)
    s.score = [3, 1]
    const wrong = s.choices[0].findIndex((v) => v !== s.q.answer)
    expect(press(s, 0, wrong, 1, 0)).toBe('wrong')
    expect(s.score).toEqual([3, 1])
    expect(s.locked).toEqual([true, false])
  })
})

describe('flag quiz bot', () => {
  it('answers inside its difficulty window', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const [lo, hi] = BOT_TIME[d]
      const rng = new Rng(4)
      for (let i = 0; i < 300; i++) {
        const plan = planFlagBot(d, rng, makeOptions(rng, 10), 10)
        expect(plan.delay).toBeGreaterThanOrEqual(lo)
        expect(plan.delay).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('falls only for the most tempting trap', () => {
    const rng = new Rng(8)
    const answer = indexOf('TD')
    const trap = COUNTRIES[answer]?.traps[0]
    let slips = 0
    for (let i = 0; i < 1000; i++) {
      const choices = makeOptions(rng, answer)
      const plan = planFlagBot('easy', rng, choices, answer)
      expect(choices[plan.idx]).toBe(plan.wrong ? trap : answer)
      if (plan.wrong) slips++
    }
    expect(slips).toBeGreaterThan(200)
    expect(slips).toBeLessThan(400)
  })

  it('plays computer vs computer to a champion in bounded time', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const rng = new Rng(21)
      const s = dealFlag(rng, 42, 0, 0)
      const planBoth = (now: number) =>
        ([0, 1] as const).map((side) => {
          const p = planFlagBot(d, rng, s.choices[side], s.q.answer)
          return { at: now + p.delay, idx: p.idx }
        })
      let plans = planBoth(0)
      let now = 0
      for (let steps = 0; champion(s) === null; steps++) {
        if (steps > 60 * 60 * 30) throw new Error(`no champion (${d})`)
        now += 1 / 60
        if (s.done) {
          if (due(s, now)) {
            nextFlag(s, rng, now)
            plans = planBoth(now)
          }
          continue
        }
        for (const side of [0, 1] as const) {
          const p = plans[side]
          if (p && now >= p.at) {
            p.at = Infinity
            press(s, side, p.idx, now)
          }
        }
      }
      expect(Math.max(...s.score)).toBe(TARGET)
    }
  })
})
