import { describe, expect, it } from 'vitest'
import { Fx } from '../../core/fx/fx.ts'
import type { GameContext } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import makeGame, { type State } from './index.ts'
import { TRAY } from './render.ts'
import { flickPow, TAP_POW } from './throw.ts'
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

  it('with two rerolls left, hard chases a run it would not chase with one', () => {
    // 1 2 3 + two sixes: one reroll keeps the sixes or the run start; two rerolls look further.
    const one = planHold([1, 2, 3, 6, 6], emptySheet(), 1)
    const two = planHold([1, 2, 3, 6, 6], emptySheet(), 2)
    expect(two.ev).toBeGreaterThan(one.ev)
  })

  it('on the last turn of the match only the points count', () => {
    // Odds and Big run open, dice 1 3 5 5 2: odds scores 14, the run 0. With turns to spare
    // the bot weighs what each row is worth later; on the last turn it just takes the 14.
    const sheet: Sheet = [null, 0, 0, 0, 0, 0, 0, null, 0]
    const a = decide(
      [1, 3, 5, 5, 2],
      [false, false, false, false, false],
      3,
      sheet,
      'hard',
      new Rng(1),
      1,
    )
    expect(a).toEqual({ kind: 'score', cat: cat('odds') })
  })

  it('scores more on average from easy to normal to hard', () => {
    const solo = (difficulty: 'easy' | 'normal' | 'hard', seed: number): number => {
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
            sheet[a.cat] = score(dice, a.cat)
            break
          }
        }
      }
      return total(sheet)
    }
    const avg = (d: 'easy' | 'normal' | 'hard') => {
      let t = 0
      for (let seed = 1; seed <= 40; seed++) t += solo(d, seed)
      return t / 40
    }
    const [e, n, h] = [avg('easy'), avg('normal'), avg('hard')]
    // Measured over 400 seeded games: easy 97, normal 177, hard 185.
    expect(n).toBeGreaterThan(e + 40)
    expect(h).toBeGreaterThan(e + 40)
  }, 60_000)

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

describe('yazy throw', () => {
  const ctx = (): GameContext => ({
    stage: {} as Stage,
    input: new Input({} as Stage, '1p', 0),
    fx: new Fx(),
    audio: { play: () => {}, buzz: () => {} } as unknown as GameContext['audio'],
    rng: new Rng(4),
    mode: '1p',
    difficulty: 'normal',
    bots: [false, false],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 4,
  })
  const step = (game: ReturnType<typeof makeGame>, c: GameContext) => {
    game.update(1 / 60)
    c.input.endStep()
  }
  const redTurn = (game: ReturnType<typeof makeGame>): State => {
    const s = (game.snapshot() as { s: State }).s
    s.turn = 0
    return s
  }

  it('a fast flick across the tray throws harder than a tap', () => {
    const c = ctx()
    const game = makeGame()
    game.init(c)
    const s = redTurn(game)
    const y = TRAY.y + TRAY.h / 2
    const p = c.input.player(0)
    p.press(1, 200, y)
    step(game, c)
    for (let k = 1; k <= 4; k++) {
      p.move(1, 200 + k * 110, y - k * 20)
      step(game, c)
    }
    p.release(1)
    step(game, c)
    expect(s.rolls).toBe(1)
    expect(s.pow).toBeGreaterThan(TAP_POW)
  })

  it('a tap on the tray before the first roll throws gently; later a tap holds a die', () => {
    const c = ctx()
    const game = makeGame()
    game.init(c)
    const s = redTurn(game)
    const slot = TRAY.slots[2] as { x: number; y: number }
    const p = c.input.player(0)
    p.press(1, slot.x, slot.y)
    step(game, c)
    p.release(1)
    step(game, c)
    expect(s.rolls).toBe(1)
    expect(s.pow).toBe(TAP_POW)
    for (let k = 0; k < 60; k++) step(game, c)
    p.press(2, slot.x, slot.y)
    step(game, c)
    p.release(2)
    step(game, c)
    expect(s.held[2]).toBe(true)
    expect(s.rolls).toBe(1)
  })

  it('throw energy follows the release speed, with a gentle floor', () => {
    expect(flickPow(0)).toBe(0.25)
    expect(flickPow(2600)).toBeCloseTo(0.5, 5)
    expect(flickPow(99999)).toBe(1)
  })
})
