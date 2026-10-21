import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  advance,
  fire,
  GOAL_BOT,
  GOAL_TOP,
  GOAL_X,
  isOver,
  KICKS,
  newState,
  result,
  runKick,
  SPOT_DIST,
  type State,
  stepKick,
} from './rules.ts'
import { swipeShot } from './swipe.ts'

/** A full game with the computer on both sides; returns the state and the steps it took. */
function game(
  seed: number,
  a: Difficulty,
  b: Difficulty,
  regular = KICKS,
): { s: State; steps: number } {
  const rng = new Rng(seed)
  const wind = () => (rng.chance(0.25) ? 0 : rng.range(-100, 100))
  const s = newState(rng, rng.chance(0.5) ? 0 : 1, wind(), regular)
  let steps = 0
  while (!isOver(s) && steps < 60 * 60 * 30) {
    if (s.phase === 'aim') fire(s, choose(s, s.turn, s.turn === 0 ? a : b, rng))
    advance(s, STEP, wind)
    steps++
  }
  return { s, steps }
}

function kickAt(s: State, side: Side, shot: { dx: number; dy: number; power: number }, wind = 0) {
  return runKick(s, side, shot, wind)
}

describe('field goal spots', () => {
  it('each side walks its spots back from the goal it kicks at', () => {
    const s = newState(new Rng(4), 0, 0)
    const red = s.spots[0].slice(0, KICKS)
    const blue = s.spots[1].slice(0, KICKS)
    expect(red.map((p) => p.d)).toEqual(SPOT_DIST)
    for (const p of red) expect(p.y).toBe(GOAL_TOP + p.d)
    for (const p of blue) expect(p.y).toBe(GOAL_BOT - p.d)
  })
})

describe('field goal kicks', () => {
  it('a firm straight kick from the first spot is good; a weak one falls short', () => {
    const s = newState(new Rng(4), 0, 0)
    expect(kickAt(s, 0, { dx: 0, dy: -1, power: 0.8 }).outcome).toBe('good')
    expect(kickAt(s, 0, { dx: 0, dy: -1, power: 0.3 }).outcome).not.toBe('good')
  })

  it('a kick well off line is wide, and wind pushes a long kick sideways', () => {
    const s = newState(new Rng(4), 0, 0)
    expect(kickAt(s, 0, { dx: 0.6, dy: -0.8, power: 0.8 }).outcome).toBe('wide')
    // Wind matters most on the far spot, where the kick is in the air longest.
    const far = { ...s, kicks: [4, 0] as [number, number] }
    const calm = kickAt(far, 0, { dx: 0, dy: -1, power: 0.78 }, 0)
    const windy = kickAt(far, 0, { dx: 0, dy: -1, power: 0.78 }, 100)
    expect(windy.x).toBeGreaterThan(calm.x + 40)
  })

  it('the far spot needs a firmer kick than the near one', () => {
    const near = newState(new Rng(4), 0, 0)
    const far = { ...near, kicks: [4, 0] as [number, number] }
    expect(kickAt(near, 0, { dx: 0, dy: -1, power: 0.55 }).outcome).toBe('good')
    expect(kickAt(far, 0, { dx: 0, dy: -1, power: 0.55 }).outcome).not.toBe('good')
  })

  it('a kick that sails over the top is not good', () => {
    const s = newState(new Rng(4), 0, 0)
    expect(kickAt(s, 0, { dx: 0, dy: -1, power: 1 }).outcome).toBe('over')
  })

  it('stepKick reports a goal only on the goal line between the posts', () => {
    const s = newState(new Rng(4), 0, 0)
    const spot = s.spots[0][0] ?? { x: GOAL_X, y: 0, d: 0 }
    const k = {
      x: GOAL_X,
      y: spot.y,
      z: 260,
      vx: 0,
      vy: -600,
      vz: 200,
      t: 0,
      side: 0 as Side,
      py: spot.y,
    }
    let out = null
    for (let i = 0; i < 600 && !out; i++) out = stepKick(k, 0)
    expect(out).toBe('good')
  })
})

describe('field goal game', () => {
  it('a level score after five kicks each goes to sudden death', () => {
    const s = newState(new Rng(6), 0, 0)
    s.kicks = [KICKS, KICKS]
    s.points = [2, 2]
    s.phase = 'beat'
    s.beat = 0
    expect(result(s)).toBeNull()
    const ev = advance(s, STEP, () => 0)
    expect(s.sudden).toBe(true)
    expect(ev.some((e) => e.kind === 'sudden')).toBe(true)
    expect(isOver(s)).toBe(false)
  })

  it('the match length sets the kicks each before sudden death', () => {
    const s = newState(new Rng(6), 0, 0, 2)
    expect(s.regular).toBe(2)
    expect(s.spots[0].slice(0, 2).map((p) => p.d)).toEqual([SPOT_DIST[0], SPOT_DIST[4]])
    s.kicks = [2, 2]
    s.points = [2, 2]
    s.phase = 'beat'
    s.beat = 0
    advance(s, STEP, () => 0)
    expect(s.sudden).toBe(true)
    expect(result(s)).toBeNull()
  })

  it('a two-kick match is decided within bounded steps', () => {
    const r = game(9, 'normal', 'normal', 2)
    expect(isOver(r.s)).toBe(true)
    expect(r.steps).toBeLessThan(60 * 60 * 30)
    expect(r.s.kicks[0]).toBe(r.s.kicks[1])
    expect(r.s.kicks[0]).toBeGreaterThanOrEqual(2)
  })

  it('the side with more points after five kicks each wins', () => {
    const s = newState(new Rng(6), 0, 0)
    s.kicks = [KICKS, KICKS]
    s.points = [1, 3]
    expect(result(s)).toBe(1)
  })

  it('swipes: direction is the angle, length the power, and a swipe back is no kick', () => {
    expect(swipeShot(0, 0, -200)).toEqual({ dx: 0, dy: -1, power: 200 / 380 })
    expect(swipeShot(0, 0, 200)).toBeNull()
    expect(swipeShot(1, 0, 200)?.dy).toBe(1)
    expect(swipeShot(0, 10, -10)).toBeNull()
  })

  it('computer vs computer finishes within bounded steps, with a winner or a sudden death', () => {
    const r = game(21, 'normal', 'normal')
    expect(isOver(r.s)).toBe(true)
    expect(r.steps).toBeLessThan(60 * 60 * 30)
    expect(result(r.s)).not.toBeNull()
  })

  it('a hard computer beats an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) {
      const r = game(seed, 'hard', 'easy')
      if (result(r.s) === 0) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(3)
  })
})
