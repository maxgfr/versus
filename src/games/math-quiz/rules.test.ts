import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { planBot, BOT_TIME } from './bot.ts'
import {
  champion,
  dealSum,
  effort,
  due,
  makeOptions,
  makeQuestion,
  nextSum,
  NEXT_DELAY,
  OPS,
  press,
  TARGET,
  VOID_DELAY,
  type Question,
  type QuizState,
} from './rules.ts'

const sum = (q: Partial<Question> & Pick<Question, 'answer'>): Question => ({
  a: 0,
  b: 0,
  op: '+',
  ...q,
})

/** A state with a known sum and options, for hand-checked cases. */
function fixed(answer = 12): QuizState {
  return {
    q: sum({ answer, a: 7, b: answer - 7 }),
    choices: [
      [answer + 2, answer, answer - 1, answer + 5],
      [answer, answer + 1, answer - 3, answer + 4],
    ],
    score: [0, 0],
    locked: [false, false],
    done: false,
    winner: null,
    doneAt: -1,
    dealAt: -1,
    qAt: 0,
    sums: 1,
  }
}

const DIFFS = ['easy', 'normal', 'hard'] as const

describe('math quiz questions', () => {
  it('keeps answers positive and correct for every operator and difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const rng = new Rng(7)
      for (let i = 0; i < 2000; i++) {
        const q = makeQuestion(rng, d)
        expect(OPS).toContain(q.op)
        expect(q.answer).toBeGreaterThan(0)
        if (q.op === '+') expect(q.answer).toBe(q.a + q.b)
        if (q.op === '-') expect(q.answer).toBe(q.a - q.b)
        if (q.op === '×') expect(q.answer).toBe(q.a * q.b)
      }
    }
  })

  it('scales the numbers with difficulty', () => {
    const biggest = (d: 'easy' | 'hard') => {
      const rng = new Rng(3)
      let max = 0
      for (let i = 0; i < 500; i++) max = Math.max(max, makeQuestion(rng, d).answer)
      return max
    }
    expect(biggest('hard')).toBeGreaterThan(biggest('easy') * 2)
  })

  it('offers four distinct options including the answer, none of them zero or negative', () => {
    const rng = new Rng(5)
    for (let i = 0; i < 1000; i++) {
      const q = makeQuestion(rng, DIFFS[i % 3] ?? 'easy')
      const opts = makeOptions(rng, q)
      expect(opts).toHaveLength(4)
      expect(new Set(opts).size).toBe(4)
      expect(opts).toContain(q.answer)
      for (const v of opts) expect(v).toBeGreaterThan(0)
    }
  })

  it('gives each side the same options in its own order', () => {
    const s = dealSum(new Rng(9), 'normal', 0, 0)
    expect([...s.choices[0]].sort((x, y) => x - y)).toEqual([...s.choices[1]].sort((x, y) => x - y))
    expect(s.choices[0]).toContain(s.q.answer)
  })
})

describe('math quiz presses', () => {
  it('scores the first correct tap and settles the sum', () => {
    const s = fixed(12)
    expect(press(s, 0, 1, 2)).toBe('right')
    expect(s.score).toEqual([1, 0])
    expect(s.done).toBe(true)
    expect(s.winner).toBe(0)
    expect(s.dealAt).toBeCloseTo(2 + NEXT_DELAY)
  })

  it('ignores the other side once the sum is settled', () => {
    const s = fixed(12)
    press(s, 0, 1, 1)
    expect(press(s, 1, 0, 1.2)).toBe('ignored')
    expect(s.score).toEqual([1, 0])
  })

  it('costs a wrong tap, locking only that side for this sum', () => {
    const s = fixed(12)
    expect(press(s, 0, 0, 1)).toBe('wrong')
    expect(s.score).toEqual([-1, 0])
    expect(s.locked).toEqual([true, false])
    expect(press(s, 0, 1, 1.5)).toBe('ignored')
    expect(press(s, 1, 0, 1.6)).toBe('right')
    expect(s.score).toEqual([-1, 1])
  })

  it('voids the sum when both sides are locked out', () => {
    const s = fixed(12)
    press(s, 0, 0, 1)
    expect(s.done).toBe(false)
    press(s, 1, 2, 1.1)
    expect(s.done).toBe(true)
    expect(s.winner).toBeNull()
    expect(s.score).toEqual([-1, -1])
    expect(s.dealAt).toBeCloseTo(1.1 + VOID_DELAY)
  })

  it('treats an out-of-range button index as ignored', () => {
    expect(press(fixed(), 0, 9, 1)).toBe('ignored')
  })

  it('makes a new sum with scores kept and locks cleared', () => {
    const rng = new Rng(2)
    const s = fixed(12)
    press(s, 0, 1, 1)
    expect(due(s, 1.5)).toBe(false)
    expect(due(s, 1 + NEXT_DELAY)).toBe(true)
    nextSum(s, rng, 'easy', 1 + NEXT_DELAY)
    expect(s.score).toEqual([1, 0])
    expect(s.done).toBe(false)
    expect(s.locked).toEqual([false, false])
    expect(s.dealAt).toBe(-1)
    expect(s.sums).toBe(2)
  })

  it('crowns the first side to the target', () => {
    const s = fixed(12)
    s.score = [TARGET - 1, 4]
    expect(champion(s)).toBeNull()
    press(s, 0, 1, 3)
    expect(champion(s)).toBe(0)
  })

  it('crowns the side that reaches the match length the players chose', () => {
    const s = fixed(12)
    s.score = [4, 2]
    expect(champion(s, 5)).toBeNull()
    press(s, 0, 1, 3)
    expect(champion(s, 5)).toBe(0)
  })
})

describe('math quiz bot', () => {
  it('takes longer on harder sums, as people do', () => {
    const easy = effort({ a: 3, b: 4, op: '+', answer: 7 })
    const carry = effort({ a: 58, b: 67, op: '+', answer: 125 })
    const borrow = effort({ a: 52, b: 38, op: '-', answer: 14 })
    const big = effort({ a: 12, b: 14, op: '×', answer: 168 })
    expect(easy).toBe(1)
    expect(carry).toBeGreaterThan(1.4)
    expect(borrow).toBeGreaterThan(1.2)
    expect(big).toBeGreaterThan(1.5)
    for (const e of [easy, carry, borrow, big]) expect(e).toBeLessThanOrEqual(2)
    const rng = new Rng(5)
    const slow = planBot('hard', new Rng(5), [1, 2, 3, 4], 2, 2).delay
    const quick = planBot('hard', rng, [1, 2, 3, 4], 2, 1).delay
    expect(slow).toBeCloseTo(quick * 2, 5)
  })

  it('sums get bigger as the race nears its end', () => {
    const biggest = (heat: number) => {
      const rng = new Rng(6)
      let max = 0
      for (let i = 0; i < 500; i++) max = Math.max(max, makeQuestion(rng, 'normal', heat).answer)
      return max
    }
    expect(biggest(1)).toBeGreaterThan(biggest(0))
  })

  it('answers inside its difficulty window', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const [lo, hi] = BOT_TIME[d]
      const rng = new Rng(4)
      for (let i = 0; i < 300; i++) {
        const plan = planBot(d, rng, [5, 9, 12, 3], 12)
        expect(plan.delay).toBeGreaterThanOrEqual(lo)
        expect(plan.delay).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('never slips on hard, rarely on normal, and about a quarter of the time on easy', () => {
    const rng = new Rng(8)
    const choices = [5, 9, 12, 3]
    for (let i = 0; i < 200; i++) expect(planBot('hard', rng, choices, 12).idx).toBe(2)
    let normal = 0
    for (let i = 0; i < 1000; i++) if (planBot('normal', rng, choices, 12).wrong) normal++
    expect(normal / 1000).toBeLessThan(0.1)
    expect(normal).toBeGreaterThan(0)
    let slips = 0
    for (let i = 0; i < 2000; i++) {
      const p = planBot('easy', rng, choices, 12)
      if (p.wrong) {
        slips++
        expect(p.idx).not.toBe(2)
      } else expect(p.idx).toBe(2)
    }
    expect(slips / 2000).toBeGreaterThan(0.2)
    expect(slips / 2000).toBeLessThan(0.3)
  })

  it('plays computer vs computer to a champion in bounded time', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const rng = new Rng(21)
      const s = dealSum(rng, d, 0, 0)
      let now = 0
      let plan: [ReturnType<typeof planBot>, ReturnType<typeof planBot>] = [
        planBot(d, rng, s.choices[0], s.q.answer),
        planBot(d, rng, s.choices[1], s.q.answer),
      ]
      let at: [number, number] = [plan[0].delay, plan[1].delay]
      let steps = 0
      while (champion(s) === null) {
        if (++steps > 60 * 60 * 30) throw new Error(`no champion (${d})`)
        now += 1 / 60
        if (s.done) {
          if (due(s, now)) {
            nextSum(s, rng, d, now)
            plan = [
              planBot(d, rng, s.choices[0], s.q.answer),
              planBot(d, rng, s.choices[1], s.q.answer),
            ]
            at = [now + plan[0].delay, now + plan[1].delay]
          }
          continue
        }
        for (const side of [0, 1] as const) {
          if (now >= at[side]) {
            at[side] = Infinity
            press(s, side, plan[side].idx, now)
          }
        }
      }
      expect(Math.max(...s.score)).toBe(TARGET)
    }
  })

  it('the harder computer wins head to head: hard over normal, normal over easy', () => {
    const race = (a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard', seed: number) => {
      const rng = new Rng(seed)
      const s = dealSum(rng, 'normal', 0, 0)
      const d = [a, b] as const
      const plan = () =>
        [0, 1].map((i) =>
          planBot(d[i] ?? 'easy', rng, s.choices[i as 0 | 1], s.q.answer, effort(s.q)),
        )
      let p = plan()
      let at = [p[0]?.delay ?? 0, p[1]?.delay ?? 0]
      let now = 0
      while (champion(s) === null && now < 600) {
        now += 1 / 60
        if (s.done) {
          if (due(s, now)) {
            nextSum(s, rng, 'normal', now)
            p = plan()
            at = [now + (p[0]?.delay ?? 0), now + (p[1]?.delay ?? 0)]
          }
          continue
        }
        for (const side of [0, 1] as const) {
          if (now >= (at[side] ?? Infinity)) {
            at[side] = Infinity
            press(s, side, p[side]?.idx ?? 0, now)
          }
        }
      }
      return champion(s)
    }
    let hard = 0
    let normal = 0
    for (let seed = 1; seed <= 6; seed++) {
      if (race('hard', 'normal', seed) === 0) hard++
      if (race('normal', 'easy', seed) === 0) normal++
    }
    expect(hard).toBe(6)
    expect(normal).toBe(6)
  })
})
