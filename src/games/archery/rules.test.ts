import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  advance,
  ARROWS,
  BOW,
  done,
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
function match(seed: number, a: Difficulty, b: Difficulty): { s: State; steps: number } {
  const rng = new Rng(seed)
  const wind = () => rng.range(-WIND_MAX, WIND_MAX)
  const s = newState(rng.chance(0.5) ? 0 : 1, wind())
  let t = 0
  let steps = 0
  while (!done(s) && steps < 60 * 60 * 5) {
    if (s.phase === 'aim') {
      const side = s.turn
      loose(s, choose(side, s.wind, side === 0 ? a : b, rng), t)
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

  it('a hard computer out-scores an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) if (result(match(seed, 'hard', 'easy').s) === 0) wins++
    expect(wins).toBeGreaterThanOrEqual(3)
  })
})
