import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { route, StarBot } from './bot.ts'
import {
  BASKET_HALF,
  BASKET_SPEED,
  BASKET_Y,
  clampBasket,
  COMET,
  type Drop,
  GOLD,
  type Item,
  LIMIT,
  STAR,
  type Sky,
  schedule,
  SHOWER,
  skyNew,
  skyStep,
  winnerOf,
} from './rules.ts'

/** A sky with one item placed by hand. */
function skyWith(kind: number, x: number, y: number, basket = 500): Sky {
  const s = skyNew()
  s.basket = basket
  const it: Item = { id: 1, kind, x, y, vy: 0, rot: 0 }
  s.items.push(it)
  return s
}

const NONE: Drop[] = []

describe('star catcher rules', () => {
  it('the basket slides toward the target at most at its speed', () => {
    const s = skyNew()
    s.basket = 500
    skyStep(s, STEP, 0, NONE, 900)
    expect(s.basket).toBeCloseTo(500 + BASKET_SPEED * STEP, 5)
    for (let i = 0; i < 600; i++) skyStep(s, STEP, i * STEP, NONE, 900)
    expect(s.basket).toBeCloseTo(900, 5)
  })

  it('no target means the basket holds still', () => {
    const s = skyNew()
    s.basket = 250
    skyStep(s, STEP, 0, NONE, null)
    expect(s.basket).toBe(250)
  })

  it('the basket stays inside the sky', () => {
    expect(clampBasket(0)).toBe(BASKET_HALF)
    expect(clampBasket(2000)).toBe(1000 - BASKET_HALF)
  })

  it('a star in the basket scores 1', () => {
    const s = skyWith(STAR, 500, BASKET_Y, 500)
    const evs = skyStep(s, STEP, 0, NONE, null)
    expect(evs.some((e) => e.k === 'catch')).toBe(true)
    expect(s.score).toBe(1)
    expect(s.items).toHaveLength(0)
  })

  it('golden stars are worth three and comets two', () => {
    const gold = skyWith(GOLD, 500, BASKET_Y, 500)
    skyStep(gold, STEP, 0, NONE, null)
    expect(gold.score).toBe(3)
    const comet = skyWith(COMET, 500, BASKET_Y, 500)
    skyStep(comet, STEP, 0, NONE, null)
    expect(comet.score).toBe(2)
  })

  it('a star past the basket is missed without penalty', () => {
    const s = skyWith(STAR, 100, BASKET_Y + 100, 900)
    skyStep(s, STEP, 0, NONE, null)
    expect(s.items).toHaveLength(0)
    expect(s.score).toBe(0)
  })

  it('comets fall faster than stars', () => {
    const sched: Drop[] = [
      { t: 0, x: 300, vy: 300, kind: STAR },
      { t: 0, x: 600, vy: 300, kind: COMET },
    ]
    const s = skyNew()
    skyStep(s, 0.5, 0, sched, null)
    const star = s.items.find((i) => i.kind === STAR)
    const comet = s.items.find((i) => i.kind === COMET)
    expect(comet!.y - 960).toBeGreaterThan(star!.y - 960)
  })

  it('items drop from the schedule at their time, not before', () => {
    const sched: Drop[] = [{ t: 2, x: 500, vy: 300, kind: STAR }]
    const s = skyNew()
    skyStep(s, STEP, 1.9, sched, null)
    expect(s.items).toHaveLength(0)
    skyStep(s, STEP, 2.01, sched, null)
    expect(s.items).toHaveLength(1)
  })

  it('both skies get the same pattern', () => {
    const sched = schedule(33)
    const a = skyNew()
    const b = skyNew()
    for (let i = 0; i < 60 * LIMIT; i++) {
      const t = i * STEP
      skyStep(a, STEP, t, sched, null)
      skyStep(b, STEP, t, sched, null)
    }
    expect(a.nid).toBe(b.nid)
    expect(a.caught).toEqual(b.caught)
  })

  it('the pattern has stars, golden stars and comets', () => {
    const s = schedule(12)
    const kinds = new Set(s.map((d) => d.kind))
    expect(kinds).toEqual(new Set([STAR, GOLD, COMET]))
  })

  it('the most points wins; equal points draw', () => {
    expect(winnerOf([9, 2])).toBe(0)
    expect(winnerOf([2, 9])).toBe(1)
    expect(winnerOf([4, 4])).toBe('draw')
  })
})

/** A whole match between two catchers. */
function play(seed: number, a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard') {
  const sched = schedule(seed)
  const rng = new Rng(seed)
  const skies: [Sky, Sky] = [skyNew(), skyNew()]
  const bots = [new StarBot(rng.fork(), a), new StarBot(rng.fork(), b)]
  let t = 0
  let steps = 0
  while (t < LIMIT) {
    t += STEP
    steps++
    for (const side of [0, 1] as const) {
      const target = bots[side]!.step(skies[side], STEP)
      skyStep(skies[side], STEP, t, sched, target, bots[side]!.speed)
    }
  }
  return {
    scores: [skies[0].score, skies[1].score] as [number, number],
    winner: winnerOf([skies[0].score, skies[1].score]),
    steps,
  }
}

describe('star catcher bot vs bot', () => {
  it('reaches a result within the match length, for either side', () => {
    for (let seed = 0; seed < 8; seed++) {
      const r = play(seed, 'normal', 'normal')
      expect(r.steps).toBeGreaterThanOrEqual(LIMIT / STEP)
      expect(r.steps).toBeLessThanOrEqual(LIMIT / STEP + 2)
      expect(['draw', 0, 1]).toContain(r.winner)
    }
  })

  it('bots catch stars on both sides', () => {
    const r = play(9, 'normal', 'normal')
    expect(r.scores[0]).toBeGreaterThan(5)
    expect(r.scores[1]).toBeGreaterThan(5)
  })

  it('hard catchers beat easy ones most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 20; seed++) {
      if (play(600 + seed, 'hard', 'easy').winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(12)
  })

  it('hard catchers beat normal ones most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 12; seed++) {
      const r = play(700 + seed, seed % 2 ? 'hard' : 'normal', seed % 2 ? 'normal' : 'hard')
      if (r.winner === (seed % 2 ? 0 : 1)) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(8)
  })

  it('the planner skips a plain star for a golden one it cannot catch both of', () => {
    const star: Item = { id: 1, kind: STAR, x: 150, y: BASKET_Y - 300, vy: 300, rot: 0 }
    const gold: Item = { id: 2, kind: GOLD, x: 850, y: BASKET_Y - 330, vy: 300, rot: 0 }
    expect(route([star, gold], 500, 1500)?.id).toBe(2)
    // With time to catch both, it takes the first one first.
    const late: Item = { ...gold, y: BASKET_Y - 1200 }
    expect(route([star, late], 500, 1500)?.id).toBe(1)
  })
})

describe('streaks and the shower', () => {
  it('catches build a streak; a star that falls past breaks it, once', () => {
    const s = skyWith(STAR, 500, BASKET_Y - 10)
    skyStep(s, STEP, 1, NONE, null)
    expect(s.streak).toBe(1)
    s.items.push({ id: 9, kind: STAR, x: 900, y: BASKET_Y + 35, vy: 600, rot: 0 })
    const ev = [...skyStep(s, STEP, 1.1, NONE, null), ...skyStep(s, STEP, 1.2, NONE, null)]
    expect(ev.filter((e) => e.k === 'miss')).toHaveLength(1)
    expect(s.streak).toBe(0)
  })

  it('the last stretch rains harder than the start', () => {
    const sched = schedule(3, 60)
    const early = sched.filter((d) => d.t < 60 * SHOWER).length
    const late = sched.filter((d) => d.t >= 60 * (1 - SHOWER)).length
    expect(late).toBeGreaterThan(early * 1.3)
  })
})
