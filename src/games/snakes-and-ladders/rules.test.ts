import { describe, expect, it } from 'vitest'
import { Fx } from '../../core/fx/fx.ts'
import type { GameContext } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import type { Stage } from '../../core/stage.ts'
import { frame } from '../../engines/dice/index.ts'
import { TAP_POW } from '../yazy/throw.ts'
import makeGame, { type State } from './index.ts'
import { DIE } from './render.ts'
import { Rng } from '../../core/rng.ts'
import { decide } from './bot.ts'
import { colOf, finished, GOAL, linkAt, makeBoard, move, rowOf, type Board } from './rules.ts'

const board = makeBoard()

const quiet: Board = {
  ladders: [{ from: 4, to: 20 }],
  snakes: [{ from: 30, to: 5 }],
}

describe('board', () => {
  it('is the same board every time', () => {
    expect(makeBoard()).toEqual(board)
  })

  it('has six ladders and six snakes', () => {
    expect(board.ladders).toHaveLength(6)
    expect(board.snakes).toHaveLength(6)
  })

  it('climbs up and slides down, across rows', () => {
    for (const l of board.ladders) {
      expect(l.to).toBeGreaterThan(l.from)
      expect(rowOf(l.to)).not.toBe(rowOf(l.from))
    }
    for (const s of board.snakes) {
      expect(s.to).toBeLessThan(s.from)
      expect(rowOf(s.to)).not.toBe(rowOf(s.from))
    }
  })

  it('never reuses a square and never touches 1 or 100', () => {
    const all = [...board.ladders, ...board.snakes].flatMap((l) => [l.from, l.to])
    expect(new Set(all).size).toBe(all.length)
    expect(all).not.toContain(1)
    expect(all).not.toContain(GOAL)
  })

  it('numbers the track boustrophedon: 1 bottom-left, 11 back to the right', () => {
    expect([colOf(1), rowOf(1)]).toEqual([0, 0])
    expect([colOf(10), rowOf(10)]).toEqual([9, 0])
    expect([colOf(11), rowOf(11)]).toEqual([9, 1])
    expect([colOf(20), rowOf(20)]).toEqual([0, 1])
    expect([colOf(100), rowOf(100)]).toEqual([0, 9])
  })
})

describe('moves', () => {
  it('hops square by square from the start pad', () => {
    const m = move(0, 3, quiet)
    expect(m.path).toEqual([1, 2, 3])
    expect(m.to).toBe(3)
    expect(m.link).toBeUndefined()
  })

  it('climbs a ladder when it lands on the foot', () => {
    const m = move(0, 4, quiet)
    expect(m.path).toEqual([1, 2, 3, 4])
    expect(m.to).toBe(20)
    expect(m.link).toEqual({ from: 4, to: 20 })
  })

  it('slides down a snake', () => {
    const m = move(25, 5, quiet)
    expect(m.to).toBe(5)
    expect(m.link).toEqual({ from: 30, to: 5 })
  })

  it('passes over a link without using it', () => {
    expect(move(2, 4, quiet).to).toBe(6)
  })

  it('needs an exact roll to land on 100', () => {
    expect(move(94, 6, quiet).to).toBe(GOAL)
    expect(finished(move(94, 6, quiet).to)).toBe(true)
    expect(finished(move(99, 1, quiet).to)).toBe(true)
  })

  it('bounces back by the excess past 100', () => {
    const m = move(97, 6, quiet)
    expect(m.path).toEqual([98, 99, 100, 99, 98, 97])
    expect(m.to).toBe(97)
    expect(finished(m.to)).toBe(false)
  })

  it('bounces back from 98 on a four', () => {
    expect(move(98, 4, quiet).to).toBe(98)
    expect(move(98, 2, quiet).to).toBe(100)
  })

  it('only the square it stops on can carry a link', () => {
    const m = move(3, 1, quiet)
    expect(m.to).toBe(20)
    expect(m.link).toEqual({ from: 4, to: 20 })
    expect(linkAt(quiet, 4)).toEqual({ from: 4, to: 20 })
    expect(linkAt(quiet, 20)).toBeUndefined()
  })
})

describe('bot', () => {
  it('rolls on every difficulty', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) expect(decide(d)).toBe('roll')
  })
})

describe('snakes and ladders', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`a computer-vs-computer game (seed ${seed}) ends within bounded rolls`, () => {
      const rng = new Rng(seed)
      const pos: [number, number] = [0, 0]
      let turn: 0 | 1 = rng.chance(0.5) ? 0 : 1
      let rolls = 0
      let winner: 0 | 1 | null = null
      while (winner === null) {
        if (++rolls > 5000) throw new Error('game did not end')
        const face = rng.int(1, 6)
        const m = move(pos[turn], face, board)
        pos[turn] = m.to
        if (finished(m.to)) winner = turn
        else if (face !== 6) turn = turn === 0 ? 1 : 0
      }
      expect(finished(pos[winner])).toBe(true)
      expect(rolls).toBeLessThan(5000)
    })
  }
})

describe('snakes and ladders throw', () => {
  const ctx = (): GameContext => ({
    stage: {} as Stage,
    input: new Input({} as Stage, '1p', 0),
    fx: new Fx(),
    audio: { play: () => {}, buzz: () => {} } as unknown as GameContext['audio'],
    rng: new Rng(3),
    mode: '1p',
    difficulty: 'normal',
    bots: [false, false],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 3,
  })
  const step = (game: ReturnType<typeof makeGame>, c: GameContext) => {
    game.update(1 / 60)
    c.input.endStep()
  }

  it('a tap on your die rolls gently, a fast flick off it throws hard', () => {
    for (const flick of [false, true]) {
      const c = ctx()
      const game = makeGame()
      game.init(c)
      const s = (game.snapshot() as { s: State }).s
      s.turn = 0
      const at = frame(0, DIE.x, DIE.y)
      const p = c.input.player(0)
      p.press(1, at.x, at.y)
      step(game, c)
      if (flick)
        for (let k = 1; k <= 4; k++) {
          p.move(1, at.x + k * 30, at.y - k * 120)
          step(game, c)
        }
      p.release(1)
      step(game, c)
      expect(s.rolls[0]).toBe(1)
      if (flick) expect(s.pow[0]).toBeGreaterThan(TAP_POW)
      else expect(s.pow[0]).toBe(TAP_POW)
    }
  })
})
