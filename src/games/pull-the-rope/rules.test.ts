import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MashBot, mashNew, mashStep, mashTap } from '../../engines/reflex/index.ts'
import { RopeBot } from './bot.ts'
import { haulPower, HAUL, OVERTIME, pull, pullFactor, ropeNew, ropeWinner } from './rules.ts'

describe('pull the rope rules', () => {
  it('moves the knot toward the side that taps more', () => {
    const r = ropeNew()
    for (let i = 0; i < 30; i++) pull(r, 1, 0, STEP)
    expect(r.pos).toBeGreaterThan(0)
    const b = ropeNew()
    for (let i = 0; i < 30; i++) pull(b, 0, 1, STEP)
    expect(b.pos).toBeLessThan(0)
  })

  it('stays put when both sides tap equally', () => {
    const r = ropeNew()
    for (let i = 0; i < 300; i++) pull(r, 1, 1, STEP)
    expect(r.pos).toBe(0)
  })

  it('declares the side whose line the knot reaches', () => {
    expect(ropeWinner({ pos: 1.01, vel: 0 })).toBe(0)
    expect(ropeWinner({ pos: -1.01, vel: 0 })).toBe(1)
    expect(ropeWinner({ pos: 0.5, vel: 0 })).toBeNull()
  })

  it('pulls harder in overtime', () => {
    expect(pullFactor(30)).toBeGreaterThan(pullFactor(5))
  })

  it('an even tug cannot deadlock: overtime leans to the faster pace', () => {
    // Same pulls both ways, but red keeps a slightly higher tap rate.
    const r = ropeNew()
    let t = 0
    while (ropeWinner(r) === null && t < 60) {
      t += STEP
      pull(r, 0, 0, STEP, pullFactor(t), 0.5, t)
    }
    expect(ropeWinner(r)).toBe(0)
    expect(t).toBeGreaterThan(OVERTIME)
  })

  it('pace does not count before overtime', () => {
    const r = ropeNew()
    for (let t = STEP; t < OVERTIME; t += STEP) pull(r, 0, 0, STEP, 1, 3, t)
    expect(r.pos).toBe(0)
  })
})

describe('hauls', () => {
  it('a short or slow drag is just a tap', () => {
    expect(haulPower(20, 0.1)).toBe(0)
    expect(haulPower(-300, 0.1)).toBe(0)
    expect(haulPower(300, 2)).toBeLessThan(0.15)
  })

  it('a long fast stroke toward your edge pulls up to HAUL extra', () => {
    expect(haulPower(400, 0.15)).toBeCloseTo(HAUL)
    expect(haulPower(400, 0.15)).toBeGreaterThan(haulPower(160, 0.15))
    expect(haulPower(320, 0.12)).toBeGreaterThan(haulPower(320, 0.4))
  })
})

describe('mash counter', () => {
  it('converges to the tap rate', () => {
    const m = mashNew()
    let t = 0
    for (let i = 0; i < 600; i++) {
      t += STEP
      if (i % 10 === 0) mashTap(m, t)
      mashStep(m, STEP, t)
    }
    expect(m.rate).toBeGreaterThan(4.5)
    expect(m.rate).toBeLessThan(7.5)
  })

  it('a bot mashes near its rate', () => {
    const b = new MashBot(new Rng(3), 6)
    let n = 0
    for (let i = 0; i < 600; i++) n += b.step(STEP)
    expect(n).toBeGreaterThan(45)
    expect(n).toBeLessThan(75)
  })
})

describe('pull the rope bot vs bot', () => {
  it('reaches a winner in bounded time', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rng = new Rng(seed)
      const red = new RopeBot(rng.fork(), 'normal', 0)
      const blue = new RopeBot(rng.fork(), 'normal', 1)
      const r = ropeNew()
      let t = 0
      while (ropeWinner(r) === null && t < 60) {
        t += STEP
        pull(r, red.step(STEP, r.pos), blue.step(STEP, r.pos), STEP, pullFactor(t))
      }
      expect(ropeWinner(r)).not.toBeNull()
    }
  })

  it('hard beats easy most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 20; seed++) {
      const rng = new Rng(100 + seed)
      const red = new RopeBot(rng.fork(), 'hard', 0)
      const blue = new RopeBot(rng.fork(), 'easy', 1)
      const r = ropeNew()
      let t = 0
      while (ropeWinner(r) === null && t < 60) {
        t += STEP
        pull(r, red.step(STEP, r.pos), blue.step(STEP, r.pos), STEP, pullFactor(t))
      }
      if (ropeWinner(r) === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(16)
  })
})
