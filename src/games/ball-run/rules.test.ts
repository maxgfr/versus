import { describe, expect, it } from 'vitest'
import type { Difficulty, GameContext } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import makeGame from './index.ts'
import { drive, newBrain } from './bot.ts'
import {
  type Arc,
  baseSpeed,
  freeSpan,
  inArc,
  newBall,
  ROW,
  rowAt,
  STEER,
  stepBall,
  TIME_CAP,
  wrap,
} from './rules.ts'

const DT = 1 / 60

/** First ring (from index 3) with a hole, on a seed. */
function ringWithHole(seed: number): { i: number; hole: Arc } {
  for (let i = 3; i < 200; i++) {
    const row = rowAt(seed, i)
    const hole = row.holes[0]
    if (hole) return { i, hole }
  }
  throw new Error('no hole')
}

function ringWithBar(seed: number): { i: number; bar: Arc } {
  for (let i = 3; i < 300; i++) {
    const bar = rowAt(seed, i).bars[0]
    if (bar) return { i, bar }
  }
  throw new Error('no bar')
}

describe('ball run tunnel', () => {
  it('is a pure function of seed and ring, and the first rings are clear', () => {
    expect(rowAt(4, 9)).toEqual(rowAt(4, 9))
    for (let i = 0; i < 3; i++) expect(rowAt(4, i)).toEqual({ holes: [], bars: [] })
  })

  it('keeps a free sector wide enough for the ball on every ring', () => {
    for (let seed = 1; seed <= 8; seed++) {
      for (let i = 0; i < 400; i++) {
        const row = rowAt(seed, i)
        expect(freeSpan([...row.holes, ...row.bars])).toBeGreaterThanOrEqual(1.3)
      }
    }
  })

  it('gets busier with depth', () => {
    const count = (from: number, to: number) => {
      let n = 0
      for (let seed = 1; seed <= 5; seed++)
        for (let i = from; i < to; i++)
          n += rowAt(seed, i).holes.length + rowAt(seed, i).bars.length
      return n
    }
    expect(count(60, 120)).toBeGreaterThan(count(3, 63))
  })

  it('treats arcs across the ±π seam correctly', () => {
    const seam: Arc = { c: Math.PI - 0.05, w: 0.4 }
    expect(inArc(-Math.PI + 0.05, seam)).toBe(true)
    expect(inArc(0, seam)).toBe(false)
    expect(wrap(3 * Math.PI)).toBeCloseTo(-Math.PI, 9)
  })

  it('speed rises with time and then levels off', () => {
    expect(baseSpeed(10)).toBeGreaterThan(baseSpeed(0))
    expect(baseSpeed(1000)).toBe(baseSpeed(2000))
  })
})

describe('ball run ball', () => {
  it('falls when it rolls onto a hole', () => {
    const { i, hole } = ringWithHole(6)
    const b = newBall()
    b.next = i
    b.dist = i * ROW - 0.5
    b.phi = hole.c
    b.phiT = hole.c
    expect(stepBall(b, 6, DT)).toBe('fall')
    expect(b.out).toBe(true)
    expect(stepBall(b, 6, DT)).toBeNull()
  })

  it('rolls past a hole it has steered clear of', () => {
    const { i, hole } = ringWithHole(6)
    const b = newBall()
    b.next = i
    b.dist = i * ROW - 0.5
    b.phi = hole.c + hole.w / 2 + 0.3
    b.phiT = b.phi
    expect(stepBall(b, 6, DT)).not.toBe('fall')
    expect(b.out).toBe(false)
  })

  it('bounces off a barrier, losing most of its speed', () => {
    const { i, bar } = ringWithBar(6)
    const b = newBall()
    b.next = i
    b.dist = i * ROW - 0.5
    b.phi = bar.c
    b.phiT = bar.c
    b.v = 500
    expect(stepBall(b, 6, DT)).toBe('bar')
    expect(b.v).toBeLessThan(500 * 0.6)
    expect(b.out).toBe(false)
  })

  it('turns at a limited rate toward its target', () => {
    const b = newBall()
    b.phiT = 3
    const before = b.phi
    stepBall(b, 1, DT)
    expect(Math.abs(wrap(b.phi - before))).toBeLessThanOrEqual(9 * DT + 1e-9)
  })

  it('loses speed when it turns, so steady lines go further', () => {
    const steady = newBall()
    const frantic = newBall()
    frantic.phiT = 2
    for (let f = 0; f < 60; f++) {
      stepBall(steady, 2, DT)
      stepBall(frantic, 2, DT)
      frantic.phiT = frantic.phiT > 0 ? -2 : 2
    }
    expect(frantic.v).toBeLessThan(steady.v)
    expect(frantic.dist).toBeLessThan(steady.dist)
  })

  it('drags the aim by STEER per unit of finger movement', () => {
    expect(STEER).toBeGreaterThan(0)
    expect(STEER * 220).toBeCloseTo(1, 1)
  })
})

describe('ball run bot', () => {
  it('a hard bot survives the first minute on most seeds', () => {
    let alive = 0
    for (let seed = 1; seed <= 8; seed++) {
      const b = newBall()
      const rng = new Rng(seed)
      const brain = newBrain()
      for (let f = 0; f < 60 * 60; f++) {
        b.phiT = drive(b, seed, 'hard', rng, brain)
        if (stepBall(b, seed, DT) === 'fall') break
      }
      if (!b.out) alive++
    }
    expect(alive).toBeGreaterThanOrEqual(6)
  })

  it('an easy bot falls sometimes, so matches end', () => {
    let falls = 0
    for (let seed = 1; seed <= 12; seed++) {
      const b = newBall()
      const rng = new Rng(seed)
      const brain = newBrain()
      for (let f = 0; f < 60 * TIME_CAP; f++) {
        b.phiT = drive(b, seed, 'easy', rng, brain)
        if (stepBall(b, seed, DT) === 'fall') break
      }
      if (b.out) falls++
    }
    expect(falls).toBeGreaterThan(0)
  })
})

describe('ball run game', () => {
  function bots(seed: number, difficulty: Difficulty) {
    const stage = {} as Stage
    const ctx: GameContext = {
      stage,
      input: new Input(stage, '2p', 0),
      fx: new Fx(),
      audio: { play: () => {} } as unknown as GameContext['audio'],
      rng: new Rng(seed),
      mode: '2p',
      difficulty,
      bots: [true, true],
      teams: false,
      names: ['Red', 'Blue'],
      local: 0,
      seed,
    }
    const game = makeGame()
    game.init(ctx)
    let steps = 0
    while (!game.result && steps < 60 * 120) {
      game.update(1 / 60)
      steps++
    }
    return { game, steps }
  }

  it('a bot-vs-bot match reaches a result within bounded steps on every seed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { game, steps } = bots(seed, 'normal')
      expect(game.result).not.toBeNull()
      expect(steps).toBeLessThan(60 * 120)
    }
  })

  it('the last ball rolling wins, and a timeout goes to the furthest ball', () => {
    const { game } = bots(3, 'easy')
    const [a, b] = game.s.balls
    if (a.out !== b.out) {
      // The one still rolling wins.
      expect(game.result?.winner).toBe(a.out ? 1 : 0)
    } else if (!a.out && !b.out) {
      expect(game.result?.winner).toBe(a.dist === b.dist ? 'draw' : a.dist > b.dist ? 0 : 1)
    }
    expect(game.result).not.toBeNull()
  })
})
