import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { memorise, nextPick, recall, REMEMBER } from './bot.ts'
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
  SHOW_MIN,
  showTime,
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

  it('a slip costs only the round: the game goes on', () => {
    // It used to end the whole match on the first round only one side got right.
    expect(decide([1, 0], 1)).toBeNull()
    expect(decide([0, 1], 1)).toBeNull()
    expect(decide([1, 1], 2)).toBeNull()
    expect(decide([0, 0], 2)).toBeNull()
  })

  it('after the last round the higher score wins, and equal scores draw', () => {
    expect(decide([5, 4], MAX_ORDERS)).toBe(0)
    expect(decide([3, 6], MAX_ORDERS)).toBe(1)
    expect(decide([4, 4], MAX_ORDERS)).toBe('draw')
  })

  it('ends early once the trailing side can no longer catch up', () => {
    // Eight rounds: 5–1 after six, two left, the lead holds.
    expect(decide([5, 1], 6)).toBe(0)
    // 4–2 after six: blue can still level it.
    expect(decide([4, 2], 6)).toBeNull()
  })

  it('uses the match length the players chose', () => {
    // Three rounds: the score decides after the third, not before.
    expect(decide([1, 1], 2, 3)).toBeNull()
    expect(decide([2, 1], 3, 3)).toBe(0)
  })

  it('times a watch: appear one by one, then hold', () => {
    expect(watchLength(3)).toBeCloseTo(LEAD + 3 * SHOW + 1.0, 6)
    expect(watchLength(4)).toBeGreaterThan(watchLength(3))
    expect(watchLength(3, 0.6)).toBeLessThan(watchLength(3))
  })

  it('ramps up: each order played shows the toppings faster, down to a floor', () => {
    expect(showTime(0)).toBe(SHOW)
    expect(showTime(3)).toBeLessThan(showTime(2))
    expect(showTime(50)).toBe(SHOW_MIN)
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

  it('memory fades with longer orders, least for hard', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      expect(recall(START_LEN, 0, d)).toBe(REMEMBER[d])
      expect(recall(8, 0, d)).toBeLessThan(recall(4, 0, d))
    }
    expect(recall(8, 4, 'hard')).toBeGreaterThan(recall(8, 4, 'normal'))
    expect(recall(8, 4, 'normal')).toBeGreaterThan(recall(8, 4, 'easy'))
  })

  it('hard beats normal and normal beats easy in sudden-death orders', () => {
    /** One attempt at an order: true when every pick is right. */
    const attempt = (order: number[], d: Difficulty, rng: Rng): boolean => {
      const known = memorise(order.length, d, rng)
      const built: number[] = []
      while (built.length < order.length) {
        const t = nextPick(order, built, known, rng, d)
        if (!rightPick(order, built, t)) return false
        built.push(t)
      }
      return true
    }
    const duel = (a: Difficulty, b: Difficulty): number => {
      let wins = 0
      for (let seed = 1; seed <= 200; seed++) {
        const rng = new Rng(seed)
        let len = START_LEN
        for (let round = 0; round < 40; round++) {
          const order = makeOrder(rng, len)
          const r: [boolean, boolean] = [attempt(order, a, rng), attempt(order, b, rng)]
          if (r[0] !== r[1]) {
            if (r[0]) wins++
            break
          }
          len = nextLength(len, r[0] && r[1])
        }
      }
      return wins / 200
    }
    expect(duel('hard', 'easy')).toBeGreaterThan(0.85)
    expect(duel('hard', 'normal')).toBeGreaterThan(0.55)
    expect(duel('normal', 'easy')).toBeGreaterThan(0.7)
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
  const audio = { play: () => {}, unlock: () => {}, buzz: () => {} } as unknown as Audio
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

  it('a slip does not end the match: it runs its rounds unless the lead is out of reach', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const ctx = { ...ctxFor([true, true], 'easy', seed), target: 5 }
      const game = factory()
      game.init(ctx)
      const snap = () => (game.snapshot() as { s: State }).s
      let steps = 0
      while (!game.result) {
        game.update(1 / 60)
        if (++steps > 60 * 900) throw new Error('no result')
      }
      const s = snap()
      const rounds = s.round + 1
      const lead = Math.abs(s.scores[0] - s.scores[1])
      expect(rounds === 5 || lead > 5 - rounds).toBe(true)
    }
  })

  it('the computer remembers the very first order, not only the later ones', () => {
    // It used to memorise only from the second order on, so a hard bot guessed its way through round 1.
    let right = 0
    for (let seed = 1; seed <= 20; seed++) {
      const game = factory()
      game.init(ctxFor([true, true], 'hard', seed))
      const snap = () => (game.snapshot() as { s: State }).s
      while (snap().phase !== 'after') game.update(1 / 60)
      right += snap().done.filter((d) => d === true).length
    }
    expect(right).toBeGreaterThanOrEqual(36)
  })

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
