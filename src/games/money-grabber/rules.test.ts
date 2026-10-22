import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { CatchBot } from './bot.ts'
import {
  BAG,
  BASKET_HALF,
  BASKET_SPEED,
  BASKET_Y,
  BILL,
  BOMB,
  clampBasket,
  COIN,
  DIVE_BONUS,
  DIVE_SPEED,
  type Ev,
  type Drop,
  type Item,
  laneNew,
  laneStep,
  LIMIT,
  type Lane,
  schedule,
  STUN,
  winnerOf,
} from './rules.ts'

/** A lane with one item dropped by hand, and an empty schedule. */
function laneWith(kind: number, x: number, y: number, basket = 500): Lane {
  const l = laneNew()
  l.basket = basket
  const it: Item = { id: 1, kind, x, y, vy: 0, rot: 0, vr: 0 }
  l.items.push(it)
  return l
}

const NO_RAIN: Drop[] = []

describe('money grabber rules', () => {
  it('the basket follows the target, no faster than its speed', () => {
    const l = laneNew()
    l.basket = 500
    laneStep(l, STEP, 0, NO_RAIN, 900)
    expect(l.basket).toBeCloseTo(500 + BASKET_SPEED * STEP, 5)
    for (let i = 0; i < 600; i++) laneStep(l, STEP, i * STEP, NO_RAIN, 900)
    expect(l.basket).toBeCloseTo(900, 5)
  })

  it('without a target the basket stays where it is', () => {
    const l = laneNew()
    l.basket = 300
    laneStep(l, STEP, 0, NO_RAIN, null)
    expect(l.basket).toBe(300)
  })

  it('the basket stays inside the lane', () => {
    expect(clampBasket(-500)).toBe(BASKET_HALF)
    expect(clampBasket(5000)).toBe(1000 - BASKET_HALF)
  })

  it('a coin landing in the basket is caught and worth 1', () => {
    const l = laneWith(COIN, 500, BASKET_Y, 500)
    const evs = laneStep(l, STEP, 0, NO_RAIN, null)
    expect(evs.some((e) => e.k === 'catch')).toBe(true)
    expect(l.score).toBe(1)
    expect(l.items).toHaveLength(0)
  })

  it('a diving catch (basket sliding fast) earns a bonus; a still catch does not', () => {
    const sched = [{ t: 0, x: 600, vy: 300, kind: COIN }]
    const still = laneNew()
    still.basket = 600
    const dive = laneNew()
    dive.basket = 600 - DIVE_SPEED * STEP * 2
    let a: Ev[] = []
    let b: Ev[] = []
    for (let i = 0; i < 60 * 3; i++) {
      a = a.concat(laneStep(still, STEP, i * STEP, sched, 600))
      // The diving basket sweeps across under the coin right as it lands.
      const target = still.items.length === 0 && dive.items.length === 0 ? null : 1000
      const land = dive.items[0] && dive.items[0].y > BASKET_Y - 36
      b = b.concat(laneStep(dive, STEP, i * STEP, sched, land ? target : dive.basket))
    }
    expect(still.score).toBe(1)
    expect(a.some((e) => e.k === 'catch' && !e.dive)).toBe(true)
    expect(dive.score).toBe(1 + DIVE_BONUS)
    expect(b.some((e) => e.k === 'catch' && e.dive)).toBe(true)
  })

  it('a bill is worth 5 and a bag 10', () => {
    const bill = laneWith(BILL, 500, BASKET_Y, 500)
    laneStep(bill, STEP, 0, NO_RAIN, null)
    expect(bill.score).toBe(5)
    const bag = laneWith(BAG, 500, BASKET_Y, 500)
    laneStep(bag, STEP, 0, NO_RAIN, null)
    expect(bag.score).toBe(10)
  })

  it('money out of reach is not caught', () => {
    const l = laneWith(COIN, 900, BASKET_Y, 300)
    laneStep(l, STEP, 0, NO_RAIN, null)
    expect(l.score).toBe(0)
    expect(l.items).toHaveLength(1)
  })

  it('a bomb costs 3 and stuns the basket for a second', () => {
    const l = laneWith(BOMB, 500, BASKET_Y, 500)
    const evs = laneStep(l, STEP, 10, NO_RAIN, null)
    expect(evs.some((e) => e.k === 'bomb')).toBe(true)
    expect(l.score).toBe(-3)
    expect(l.stunUntil).toBeCloseTo(10 + STUN, 5)
    // The basket cannot move while stunned...
    laneStep(l, STEP, 10.5, NO_RAIN, 900)
    expect(l.basket).toBe(500)
    // ...and can again afterwards.
    laneStep(l, STEP, 11.1, NO_RAIN, 900)
    expect(l.basket).toBeGreaterThan(500)
  })

  it('a missed item falls away with no penalty', () => {
    const l = laneWith(COIN, 100, BASKET_Y + 200, 900)
    laneStep(l, STEP, 0, NO_RAIN, null)
    expect(l.items).toHaveLength(0)
    expect(l.score).toBe(0)
  })

  it('items spawn from the schedule at their time, not before', () => {
    const sched: Drop[] = [{ t: 2, x: 500, vy: 300, kind: COIN }]
    const l = laneNew()
    laneStep(l, STEP, 1.9, sched, null)
    expect(l.items).toHaveLength(0)
    laneStep(l, STEP, 2.01, sched, null)
    expect(l.items).toHaveLength(1)
  })

  it('both lanes get the same rain', () => {
    const sched = schedule(21)
    const a = laneNew()
    const b = laneNew()
    for (let i = 0; i < 60 * LIMIT; i++) {
      const t = i * STEP
      laneStep(a, STEP, t, sched, null)
      laneStep(b, STEP, t, sched, null)
    }
    expect(a.nid).toBe(b.nid)
    expect(a.caught).toEqual(b.caught)
  })

  it('the rain holds coins, bills, bags and bombs, with more bombs late', () => {
    const s = schedule(8)
    const kinds = new Set(s.map((d) => d.kind))
    expect(kinds).toEqual(new Set([COIN, BILL, BAG, BOMB]))
    const early = s.filter((d) => d.t < LIMIT / 3 && d.kind === BOMB).length
    const late = s.filter((d) => d.t >= (2 * LIMIT) / 3 && d.kind === BOMB).length
    const earlyTotal = s.filter((d) => d.t < LIMIT / 3).length
    const lateTotal = s.filter((d) => d.t >= (2 * LIMIT) / 3).length
    expect(late / lateTotal).toBeGreaterThan(early / earlyTotal - 0.05)
  })

  it('the most money wins; equal money draws', () => {
    expect(winnerOf([10, 4])).toBe(0)
    expect(winnerOf([4, 10])).toBe(1)
    expect(winnerOf([7, 7])).toBe('draw')
  })
})

/** A whole match between two catchers. Returns the scores and bombs each lane took. */
function play(seed: number, a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard') {
  const sched = schedule(seed)
  const rng = new Rng(seed)
  const lanes: [Lane, Lane] = [laneNew(), laneNew()]
  const bots = [new CatchBot(rng.fork(), a), new CatchBot(rng.fork(), b)]
  const bombs: [number, number] = [0, 0]
  let t = 0
  let steps = 0
  while (t < LIMIT) {
    t += STEP
    steps++
    for (const side of [0, 1] as const) {
      const lane = lanes[side]
      const target = bots[side]!.step(lane, STEP)
      const before = lane.score
      const evs = laneStep(lane, STEP, t, sched, target, bots[side]!.speed)
      for (const e of evs) if (e.k === 'bomb') bombs[side]++
      void before
    }
  }
  return {
    scores: [lanes[0].score, lanes[1].score] as [number, number],
    winner: winnerOf([lanes[0].score, lanes[1].score]),
    steps,
    bombs,
  }
}

describe('money grabber bot vs bot', () => {
  it('reaches a result within the match length, for either side', () => {
    for (let seed = 0; seed < 8; seed++) {
      const r = play(seed, 'normal', 'normal')
      expect(r.steps).toBeGreaterThanOrEqual(LIMIT / STEP)
      expect(r.steps).toBeLessThanOrEqual(LIMIT / STEP + 2)
      expect(['draw', 0, 1]).toContain(r.winner)
    }
  })

  it('bots collect money on both sides', () => {
    const r = play(17, 'normal', 'normal')
    expect(r.scores[0]).toBeGreaterThan(20)
    expect(r.scores[1]).toBeGreaterThan(20)
  })

  it('hard catchers beat easy ones most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 20; seed++) {
      if (play(400 + seed, 'hard', 'easy').winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(12)
  })

  it('hard beats normal and normal beats easy most of the time', () => {
    let hard = 0
    let normal = 0
    for (let seed = 0; seed < 10; seed++) {
      if (play(600 + seed, 'hard', 'normal').winner === 0) hard++
      if (play(600 + seed, 'normal', 'easy').winner === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(8)
    expect(normal).toBeGreaterThanOrEqual(8)
  })

  it('hard catchers dodge bombs; easy ones do not always', () => {
    let hardBombs = 0
    let easyBombs = 0
    for (let seed = 0; seed < 8; seed++) {
      hardBombs += play(500 + seed, 'hard', 'hard').bombs[0]
      easyBombs += play(500 + seed, 'easy', 'easy').bombs[0]
    }
    expect(hardBombs).toBeLessThan(easyBombs)
  })
})
