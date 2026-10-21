import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { memorise, nextPick, REMEMBER } from './bot.ts'
import factory, { type State } from './index.ts'
import { tileXY } from './render.ts'
import {
  decide,
  LEAD,
  makeOrder,
  MAX_LEN,
  MAX_ORDERS,
  nextLength,
  placeSpots,
  rightPick,
  SHOW,
  START_LEN,
  TOPPINGS,
  watchLength,
} from './rules.ts'

describe('pizza memory rules', () => {
  it('makes an order of distinct toppings', () => {
    for (let len = START_LEN; len <= MAX_LEN; len++) {
      const o = makeOrder(new Rng(len), len)
      expect(o).toHaveLength(len)
      expect(new Set(o).size).toBe(len)
      for (const t of o) expect(t >= 0 && t < TOPPINGS.length).toBe(true)
    }
  })

  it('places a spot for every topping inside the pizza', () => {
    const spots = placeSpots(new Rng(5), MAX_LEN)
    expect(spots).toHaveLength(MAX_LEN)
    for (const s of spots) expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(146 + 1e-9)
  })

  it('checks each pick against the next slot of the order', () => {
    const order = [4, 1, 7]
    expect(rightPick(order, [], 4)).toBe(true)
    expect(rightPick(order, [], 1)).toBe(false)
    expect(rightPick(order, [4], 1)).toBe(true)
    expect(rightPick(order, [4, 1], 7)).toBe(true)
  })

  it('makes the next order one topping longer only when both were right', () => {
    expect(nextLength(3, true)).toBe(4)
    expect(nextLength(3, false)).toBe(3)
    expect(nextLength(MAX_LEN, true)).toBe(MAX_LEN)
  })

  it('ends the game on a round only one side got right', () => {
    expect(decide([true, false], [1, 0], 1)).toBe(0)
    expect(decide([false, true], [0, 1], 1)).toBe(1)
    // Even on the last round, a clean split decides it.
    expect(decide([false, true], [3, 4], MAX_ORDERS)).toBe(1)
  })

  it('keeps going while both are right or both are wrong', () => {
    expect(decide([true, true], [1, 1], 1)).toBeNull()
    expect(decide([false, false], [0, 0], 2)).toBeNull()
  })

  it('after eight rounds the higher score wins, and equal scores draw', () => {
    expect(decide([true, true], [5, 4], MAX_ORDERS)).toBe(0)
    expect(decide([true, true], [3, 6], MAX_ORDERS)).toBe(1)
    expect(decide([false, false], [4, 4], MAX_ORDERS)).toBe('draw')
  })

  it('uses the match length the players chose', () => {
    // Three rounds: the score decides after the third, not before.
    expect(decide([true, true], [2, 1], 2, 3)).toBeNull()
    expect(decide([true, true], [2, 1], 3, 3)).toBe(0)
  })

  it('times a watch: appear one by one, then hold', () => {
    expect(watchLength(3)).toBeCloseTo(LEAD + 3 * SHOW + 1.0, 6)
    expect(watchLength(4)).toBeGreaterThan(watchLength(3))
  })
})

describe('pizza memory bot', () => {
  it('remembers slots with the difficulty probability', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const rng = new Rng(19)
      let hits = 0
      const n = 4000
      for (let i = 0; i < n; i++) hits += memorise(1, d, rng)[0] ? 1 : 0
      expect(Math.abs(hits / n - REMEMBER[d])).toBeLessThan(0.04)
    }
  })

  it('picks what it remembers, otherwise an unused topping', () => {
    const order = [6, 2, 9]
    const rng = new Rng(2)
    expect(nextPick(order, [], [true, false, false], rng)).toBe(6)
    expect(nextPick(order, [6], [true, true, false], rng)).toBe(2)
    for (let i = 0; i < 40; i++) {
      const p = nextPick(order, [6], [true, false, false], rng)
      expect(p).not.toBe(6)
    }
  })
})

// ---------- game level ----------

function ctxFor(bots: [boolean, boolean], difficulty: Difficulty, seed: number): GameContext {
  const audio = { play: () => {}, unlock: () => {} } as unknown as Audio
  return {
    stage: { edge: (side: Side) => (side === 0 ? 1800 : 0) } as unknown as Stage,
    input: new Input({} as Stage, '2p', 0),
    fx: new Fx(),
    audio,
    rng: new Rng(seed),
    mode: '2p',
    difficulty,
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
  }
}

describe('pizza memory game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot reaches a result in bounded time (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 8))
      let steps = 0
      while (!game.result) {
        game.update(1 / 60)
        if (++steps > 60 * 900) throw new Error('no result')
      }
      const w = game.result.winner
      expect(w === 0 || w === 1 || w === 'draw').toBe(true)
    })
  }

  it('a human rebuilds an order from the tray and a wrong pick ends the attempt', () => {
    const ctx = ctxFor([false, true], 'hard', 13)
    const game = factory()
    game.init(ctx)
    const snap = () => (game.snapshot() as { s: State }).s
    // Let the watch phase run out (the computer waits for its own turn too).
    let steps = 0
    while (snap().phase !== 'build' || snap().builder !== 0) {
      game.update(1 / 60)
      ctx.input.endStep()
      if (++steps > 60 * 60) throw new Error('never reached the red build')
    }
    const s = snap()
    const order = s.order
    // Correct first pick: tile of order[0] in the tray.
    const tile = s.perm.indexOf(order[0] ?? -1)
    const c = tileXY(tile)
    ctx.input.player(0).press(9001, c.x, c.y)
    game.update(1 / 60)
    ctx.input.endStep()
    expect(snap().built[0]).toEqual([order[0]])
    expect(snap().done[0]).toBeNull()

    // A wrong pick on the next slot (any tile that is not the next topping).
    const wrongTile = s.perm.findIndex((t) => t !== order[1])
    const w = tileXY(wrongTile)
    ctx.input.player(0).press(9002, w.x, w.y)
    game.update(1 / 60)
    ctx.input.endStep()
    expect(snap().done[0]).toBe(false)
    expect(snap().failTile[0]).toBe(wrongTile)
  })
})
