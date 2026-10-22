import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { shouldFlap } from './bot.ts'
import {
  BIRD_R,
  crashed,
  GAP_MIN,
  gapAt,
  GROUND,
  newBird,
  nextPipe,
  passed,
  pipe,
  ROUND_CAP,
  speedAt,
  stepBird,
  SUDDEN,
} from './rules.ts'

const DT = 1 / 60

/** Fly one bot until it crashes or the cap; returns seconds survived. */
function fly(seed: number, d: Difficulty): number {
  const b = newBird()
  let t = 0
  while (t < ROUND_CAP) {
    const r = stepBird(seed, b, DT, speedAt(t), shouldFlap(seed, b, t, d), t)
    t += DT
    if (r === 'crash') return t
  }
  return t
}

describe('happy birds course', () => {
  it('is a pure function of seed and index', () => {
    expect(pipe(42, 7)).toEqual(pipe(42, 7))
    expect(pipe(42, 7)).not.toEqual(pipe(43, 7))
  })

  it('keeps every gap inside the lane with room to spare', () => {
    for (let i = 0; i < 300; i++) {
      const p = pipe(9, i)
      expect(p.gapY - p.gapH / 2).toBeGreaterThan(80)
      expect(p.gapY + p.gapH / 2).toBeLessThan(GROUND - 60)
      expect(p.gapH).toBeGreaterThanOrEqual(GAP_MIN)
    }
  })

  it('keeps narrowing past a minute of flight, so two good birds cannot fly forever', () => {
    expect(gapAt(SUDDEN)).toBe(215)
    expect(gapAt(SUDDEN + 10)).toBeLessThan(215)
    expect(gapAt(SUDDEN + 200)).toBe(GAP_MIN)
    // Never shut: the bird still fits with room on both sides.
    expect(GAP_MIN).toBeGreaterThan(BIRD_R * 4)
    for (let i = 1; i < 200; i++) expect(gapAt(i)).toBeLessThanOrEqual(gapAt(i - 1))
  })

  it('counts passed pipes and finds the next one', () => {
    expect(passed(0)).toBe(0)
    expect(nextPipe(1, 0).i).toBe(0)
    const p0 = pipe(1, 0)
    expect(passed(p0.x + 200)).toBe(1)
    expect(nextPipe(1, p0.x + 200).i).toBe(1)
  })

  it('crashes on the ground and inside a pipe wall', () => {
    const b = newBird()
    b.y = GROUND
    expect(crashed(1, b)).toBe(true)
    const p = pipe(1, 0)
    const c = { ...newBird(), dist: p.x + 20 - 270, y: p.gapY - p.gapH / 2 - 60 }
    expect(crashed(1, c)).toBe(true)
    const ok = { ...newBird(), dist: p.x + 20 - 270, y: p.gapY }
    expect(crashed(1, ok)).toBe(false)
  })
})

describe('happy birds bot', () => {
  it('a hard bot clears many pipes', () => {
    const times = [1, 2, 3, 4, 5].map((s) => fly(s, 'hard'))
    const avg = times.reduce((a, b) => a + b) / times.length
    expect(avg).toBeGreaterThan(25)
  })

  it('two hard bots rarely reach the round cap: sudden death ends the round', () => {
    const times = [1, 2, 3, 4, 5, 6].map((s) => fly(s, 'hard'))
    expect(times.filter((t) => t >= ROUND_CAP).length).toBeLessThanOrEqual(1)
  })

  it('spreads the levels: easy crashes sooner than hard on average', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const avg = (d: Difficulty) =>
      seeds.map((s) => fly(s, d)).reduce((a, b) => a + b) / seeds.length
    expect(avg('easy')).toBeLessThan(avg('hard'))
  })

  it('an easy bot eventually crashes, so rounds end', () => {
    const times = [1, 2, 3, 4, 5].map((s) => fly(s, 'easy'))
    expect(times.some((t) => t < ROUND_CAP)).toBe(true)
    // ...but not instantly: it should look like it is trying.
    expect(Math.max(...times)).toBeGreaterThan(4)
  })
})
