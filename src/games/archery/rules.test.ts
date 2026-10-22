import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose, steady } from './bot.ts'
import {
  advance,
  ARROWS,
  BOW,
  countBack,
  done,
  flightTime,
  landingOf,
  loose,
  newState,
  RANGE_MAX,
  result,
  scoreAt,
  type State,
  swayAt,
  TARGET,
  WIND_MAX,
} from './rules.ts'

/** Play a whole match with the computer on both sides; returns the state and the steps taken. */
function match(
  seed: number,
  a: Difficulty,
  b: Difficulty,
  arrows = ARROWS,
): { s: State; steps: number } {
  const rng = new Rng(seed)
  const wind = () => rng.range(-WIND_MAX, WIND_MAX)
  const s = newState(rng.chance(0.5) ? 0 : 1, wind(), arrows)
  let t = 0
  let steps = 0
  while (!done(s) && steps < 60 * 60 * 5) {
    if (s.phase === 'aim') {
      const side = s.turn
      const d = side === 0 ? a : b
      loose(s, steady(choose(side, s.wind, d, rng), side, t, d), t)
    }
    advance(s, STEP, wind)
    t += STEP
    steps++
  }
  return { s, steps }
}

/** The dead-straight shot from `side` at the target centre, with a given range fraction. */
const straight = (side: Side, power: number) => ({
  dx: side === 0 ? 0 : 0,
  dy: side === 0 ? -1 : 1,
  power,
})

describe('target', () => {
  it('ten rings from the outside in; the centre is ten, off the target is a miss', () => {
    expect(scoreAt(TARGET)).toMatchObject({ score: 10, label: 'Bullseye!' })
    expect(scoreAt({ x: TARGET.x + 39, y: TARGET.y }).score).toBe(9)
    expect(scoreAt({ x: TARGET.x + 379, y: TARGET.y }).score).toBe(1)
    expect(scoreAt({ x: TARGET.x + 382, y: TARGET.y })).toMatchObject({ score: 0, label: 'Miss' })
  })
})

describe('arrows', () => {
  it('a straight draw at the target lands near the centre, sway aside', () => {
    const side: Side = 0
    const power = (BOW[side].y - TARGET.y) / RANGE_MAX
    const at = landingOf(side, straight(side, power), 0, 0)
    expect(Math.hypot(at.x - TARGET.x, at.y - TARGET.y)).toBeLessThan(60)
  })

  it('wind drifts the arrow sideways in proportion to its strength', () => {
    const shot = straight(0, 0.7)
    const calm = landingOf(0, shot, 1.3, 0)
    const windy = landingOf(0, shot, 1.3, 300)
    expect(windy.x - calm.x).toBeCloseTo(300 * 0.2, 6)
    expect(windy.y).toBeCloseTo(calm.y, 6)
  })

  it('the draw sets the range: a short draw falls short of the target', () => {
    const side: Side = 0
    const short = landingOf(side, straight(side, 0.3), 0, 0)
    const right = landingOf(side, straight(side, 0.72), 0, 0)
    expect(scoreAt(short).score).toBe(0)
    expect(scoreAt(right).score).toBeGreaterThan(0)
  })

  it('the sway wobbles the aim over time and grows with the draw', () => {
    const samples = Array.from({ length: 200 }, (_, i) => swayAt(i * 0.05, 0, 1))
    expect(Math.max(...samples)).toBeGreaterThan(0.03)
    expect(Math.min(...samples)).toBeLessThan(-0.03)
    const steady = Array.from({ length: 200 }, (_, i) => Math.abs(swayAt(i * 0.05, 0, 0)))
    expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(Math.max(...steady))
  })

  it('an arrow is stuck and scored when it lands, and the turn passes to the other side', () => {
    const s = newState(0, 0)
    loose(s, straight(0, 0.72), 0)
    expect(s.phase).toBe('fly')
    for (let i = 0; i < 60 && s.phase !== 'beat'; i++) advance(s, STEP, () => 0)
    expect(s.stuck.length).toBe(1)
    expect(s.totals[0]).toBeGreaterThan(0)
    for (let i = 0; i < 120 && s.phase !== 'aim'; i++) advance(s, STEP, () => 0)
    expect(s.turn).toBe(1)
    expect(s.shot).toEqual([1, 0])
  })

  it('five arrows each; the highest total wins, equal totals draw', () => {
    const s = newState(0, 0)
    s.shot = [ARROWS, ARROWS]
    s.stuck = Array.from({ length: 2 * ARROWS }, () => ({
      x: 0,
      y: 0,
      side: 0 as Side,
      score: 0,
      label: '',
    }))
    s.totals = [40, 38]
    expect(done(s)).toBe(true)
    expect(result(s)).toBe(0)
    s.totals = [40, 40]
    expect(result(s)).toBe('draw')
    s.totals = [30, 41]
    expect(result(s)).toBe(1)
  })
})

describe('archery game', () => {
  it('computer vs computer shoots all ten arrows within bounded steps', () => {
    const r = match(8, 'normal', 'normal')
    expect(done(r.s)).toBe(true)
    expect(r.s.stuck.length).toBe(ARROWS * 2)
    expect(r.steps).toBeLessThan(60 * 60 * 5)
  })

  it('the match length sets the arrows each', () => {
    const r = match(14, 'normal', 'normal', 2)
    expect(r.s.arrows).toBe(2)
    expect(done(r.s)).toBe(true)
    expect(r.s.stuck.length).toBe(4)
  })

  it('a hard computer out-scores an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) if (result(match(seed, 'hard', 'easy').s) === 0) wins++
    expect(wins).toBeGreaterThanOrEqual(3)
  })
})

describe('archery: edge cases', () => {
  const arrow = (side: Side, score: number) => ({ x: 0, y: 0, side, score, label: '' })

  it('level totals go to the count-back: more 10s, then more 9s, else a draw', () => {
    const s = newState(0, 0, 2)
    s.stuck = [arrow(0, 10), arrow(0, 8), arrow(1, 9), arrow(1, 9)]
    s.totals = [18, 18]
    expect(result(s)).toBe(0)
    expect(countBack(s)).toContain('10s')
    s.stuck = [arrow(0, 9), arrow(0, 7), arrow(1, 8), arrow(1, 8)]
    s.totals = [16, 16]
    expect(result(s)).toBe(0)
    expect(countBack(s)).toContain('9s')
    s.stuck = [arrow(0, 8), arrow(0, 6), arrow(1, 7), arrow(1, 7)]
    s.totals = [14, 14]
    expect(result(s)).toBe('draw')
    expect(countBack(s)).toBeNull()
  })

  it('a harder draw flies faster', () => {
    const from = BOW[0]
    const to = TARGET
    expect(flightTime(from, to, 1)).toBeLessThan(flightTime(from, to, 0.5))
    expect(flightTime(from, to, 0.2)).toBeLessThanOrEqual(0.7)
  })

  it('the computer holds against the sway: steadied shots group tighter', () => {
    const power = (BOW[0].y - TARGET.y) / RANGE_MAX
    let raw = 0
    let held = 0
    for (let i = 0; i < 40; i++) {
      const t = i * 0.37
      const shot = straight(0, power)
      raw += Math.hypot(landingOf(0, shot, t, 0).x - TARGET.x, 0)
      held += Math.hypot(landingOf(0, steady(shot, 0, t, 'hard'), t, 0).x - TARGET.x, 0)
    }
    expect(held).toBeLessThan(raw * 0.2)
  })

  it('the difficulties are clearly apart in average score', () => {
    const avg = (d: Difficulty) => {
      let t = 0
      for (let seed = 1; seed <= 8; seed++) t += match(seed, d, d).s.totals[0]
      return t / 8
    }
    const [easy, normal, hard] = [avg('easy'), avg('normal'), avg('hard')]
    expect(normal).toBeGreaterThan(easy + 3)
    expect(hard).toBeGreaterThan(normal + 3)
  })
})
