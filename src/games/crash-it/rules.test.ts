import { describe, expect, it } from 'vitest'
import type { Difficulty, GameContext } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import makeGame from './index.ts'
import { drive, newBrain } from './bot.ts'
import {
  AIRTIME,
  CLIMB_OUT,
  GAP_RAMP,
  BOOST_MAX,
  CRUISE,
  FINISH,
  newTruck,
  obstacleAt,
  stepTruck,
  type Truck,
  WALL_V,
  wallAhead,
} from './rules.ts'

const DT = 1 / 60

/** First obstacle of the given kind on a seed's road. */
function firstOf(seed: number, kind: 'gap' | 'wall') {
  for (let i = 0; i < 50; i++) {
    const o = obstacleAt(seed, i)
    if (o.kind === kind) return { i, o }
  }
  throw new Error('no obstacle')
}

/** A truck already at speed, just short of an obstacle, on the ground. */
function approach(seed: number, i: number, dist: number, v = CRUISE): Truck {
  const t = newTruck()
  t.k = i
  t.v = v
  t.x = obstacleAt(seed, i).x - dist
  return t
}

describe('crash it course', () => {
  it('is a pure function of seed and index', () => {
    expect(obstacleAt(5, 3)).toEqual(obstacleAt(5, 3))
    expect(obstacleAt(5, 3)).not.toEqual(obstacleAt(6, 3))
  })

  it('mixes gaps and walls, with sane gap lengths', () => {
    const kinds = new Set<string>()
    for (let i = 0; i < 60; i++) {
      const o = obstacleAt(21, i)
      kinds.add(o.kind)
      if (o.kind === 'gap') {
        expect(o.len).toBeGreaterThanOrEqual(170)
        expect(o.len).toBeLessThanOrEqual(260 + GAP_RAMP)
      } else expect(o.len).toBe(0)
    }
    expect(kinds).toEqual(new Set(['gap', 'wall']))
  })

  it('places the next wall in front of the bumper', () => {
    const { i, o } = firstOf(3, 'wall')
    const t = approach(3, i, 500)
    expect(wallAhead(3, t)).toBeCloseTo(o.x - (t.x + 120), 6)
  })
})

describe('crash it jumps', () => {
  it('clears a gap pressed in the window before its edge', () => {
    const { i, o } = firstOf(3, 'gap')
    // Press where the air time carries the truck just past the far edge.
    const t = approach(3, i, AIRTIME * CRUISE - o.len - 60)
    const ev = stepTruck(t, 3, DT, true, false)
    expect(ev).toBe('jump')
    // Watch only this gap: the next one is a few steps further on.
    let fell = false
    for (let f = 0; f < 60 * 2 && t.k === i; f++) {
      if (stepTruck(t, 3, DT, false, false) === 'fall') fell = true
    }
    expect(fell).toBe(false)
    expect(t.k).toBeGreaterThan(i)
    expect(t.x).toBeGreaterThan(o.x + o.len)
  })

  it('falls into a gap it runs onto without jumping', () => {
    const { i } = firstOf(3, 'gap')
    const t = approach(3, i, 100)
    let ev: string | null = null
    for (let f = 0; f < 60 * 3 && !ev; f++) ev = stepTruck(t, 3, DT, false, false)
    expect(ev).toBe('fall')
    expect(t.state).toBe('fall')
  })

  it('climbs back out on the near side and carries on', () => {
    const { i, o } = firstOf(3, 'gap')
    const t = approach(3, i, 100)
    for (let f = 0; f < 60 * 3 && t.state !== 'rise'; f++) stepTruck(t, 3, DT, false, false)
    expect(t.state).toBe('rise')
    expect(t.x).toBeLessThan(o.x)
    for (let f = 0; f < 60 * 2 && t.state !== 'run'; f++) stepTruck(t, 3, DT, false, false)
    expect(t.state).toBe('run')
    expect(t.y).toBe(0)
  })

  it('climbing out leaves enough run-up to clear the widest gap without boost', () => {
    // From a standstill at the climb-out point, cruise to the edge and jump there.
    const len = 260 + GAP_RAMP
    const v = Math.sqrt(2 * 200 * CLIMB_OUT)
    expect(v * AIRTIME).toBeGreaterThan(len + 20)
    // And on a real course: a truck that fell in climbs out and makes it across.
    const { i, o } = firstOf(3, 'gap')
    const t = approach(3, i, 100)
    let rose = false
    for (let f = 0; f < 60 * 5 && !(rose && t.state === 'run'); f++) {
      stepTruck(t, 3, DT, false, false)
      if (t.state === 'rise') rose = true
    }
    expect(t.state).toBe('run')
    expect(t.x).toBe(o.x - CLIMB_OUT)
    let fell = false
    for (let f = 0; f < 60 * 4 && t.k === i; f++) {
      const press = t.y <= 0 && t.x + t.v * DT * 1.5 >= o.x && t.x < o.x
      if (stepTruck(t, 3, DT, press, false) === 'fall') fell = true
    }
    expect(fell).toBe(false)
    expect(t.k).toBeGreaterThan(i)
  })

  it('does not jump while already in the air', () => {
    const t = newTruck()
    t.v = CRUISE
    expect(stepTruck(t, 1, DT, true, false)).toBe('jump')
    expect(stepTruck(t, 1, DT, true, false)).toBeNull()
  })
})

describe('crash it walls', () => {
  it('smashes a wall at full speed', () => {
    const { i, o } = firstOf(4, 'wall')
    const t = approach(4, i, 40, WALL_V + 20)
    let ev: string | null = null
    for (let f = 0; f < 60 && !ev; f++) ev = stepTruck(t, 4, DT, false, false)
    expect(ev).toBe('smash')
    expect(t.smashed).toBe(1)
    expect(t.k).toBe(i + 1)
    expect(t.state).toBe('run')
    expect(o.kind).toBe('wall')
  })

  it('bumps off a wall driven slowly, stops, and backs off', () => {
    const { i, o } = firstOf(4, 'wall')
    const t = approach(4, i, 40, CRUISE)
    let ev: string | null = null
    for (let f = 0; f < 60 && !ev; f++) ev = stepTruck(t, 4, DT, false, false)
    expect(ev).toBe('bump')
    expect(t.state).toBe('bump')
    expect(t.v).toBe(0)
    expect(t.k).toBe(i)
    for (let f = 0; f < 60 * 2 && t.state === 'bump'; f++) stepTruck(t, 4, DT, false, false)
    expect(t.state).toBe('run')
    expect(t.x).toBeLessThan(o.x - 300)
  })

  it('a truck that hits a wall in mid-air drops back onto the road while it backs off', () => {
    const { i } = firstOf(4, 'wall')
    const t = approach(4, i, 40, CRUISE)
    t.y = 120
    t.vy = 200
    let ev: string | null = null
    for (let f = 0; f < 60 && !ev; f++) ev = stepTruck(t, 4, DT, false, false)
    expect(ev).toBe('bump')
    for (let f = 0; f < 60 * 2 && t.state === 'bump'; f++) stepTruck(t, 4, DT, false, false)
    expect(t.y).toBe(0)
    expect(t.vy).toBe(0)
  })

  it('a bumped truck can build enough speed from the back-off point to smash the wall', () => {
    const { i } = firstOf(4, 'wall')
    const t = approach(4, i, 40, CRUISE)
    for (let f = 0; f < 60 * 4; f++) {
      const hold = t.state === 'run' && t.k === i && t.smashed === 0
      const e = stepTruck(t, 4, DT, false, hold)
      if (e === 'smash') break
    }
    expect(t.smashed).toBe(1)
  })
})

describe('crash it boost and flag', () => {
  it('drains the meter while holding and refills it when released, within bounds', () => {
    const t = newTruck()
    t.v = CRUISE
    for (let f = 0; f < 60 * 10; f++) stepTruck(t, 1, DT, false, true)
    expect(t.boost).toBeGreaterThanOrEqual(0)
    expect(t.boost).toBeLessThan(BOOST_MAX)
    const low = t.boost
    for (let f = 0; f < 60 * 10; f++) stepTruck(t, 1, DT, false, false)
    expect(t.boost).toBeGreaterThan(low)
    expect(t.boost).toBeLessThanOrEqual(BOOST_MAX)
  })

  it('cannot boost on an empty meter', () => {
    const t = newTruck()
    t.v = CRUISE
    t.boost = 0
    stepTruck(t, 1, DT, false, true)
    expect(t.boosting).toBe(false)
  })

  it('finishes at the flag and stops counting', () => {
    const t = newTruck()
    t.x = FINISH - 1
    t.v = CRUISE
    expect(stepTruck(t, 1, DT, false, false)).toBe('finish')
    expect(t.finished).toBe(true)
    expect(stepTruck(t, 1, DT, true, true)).toBeNull()
  })
})

describe('crash it bot', () => {
  /** One truck alone on a course: seconds to the flag. */
  function race(seed: number, d: Difficulty): number {
    const t = newTruck()
    const rng = new Rng(seed)
    const brain = newBrain()
    let f = 0
    for (; f < 60 * 120 && !t.finished; f++) {
      const i = drive(t, seed, d, rng, brain)
      stepTruck(t, seed, DT, i.jump, i.boost)
    }
    return f / 60
  }

  it('plays by the finger rules: starting a boost on the road hops', () => {
    const rng = new Rng(1)
    for (let seed = 1; seed <= 6; seed++) {
      const t = newTruck()
      const brain = newBrain()
      let was = false
      for (let f = 0; f < 60 * 60 && !t.finished; f++) {
        const grounded = t.y <= 0 && t.vy <= 0 && t.state === 'run'
        const i = drive(t, seed, 'hard', rng, brain)
        if (i.boost && !was && grounded) expect(i.jump).toBe(true)
        was = i.boost
        stepTruck(t, seed, DT, i.jump, i.boost)
      }
      expect(t.finished).toBe(true)
    }
  })

  it('never gets stuck: every level reaches the flag on every course', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[])
      for (let seed = 1; seed <= 8; seed++) expect(race(seed * 31 + 5, d)).toBeLessThan(40)
  })

  it('hard beats easy to the flag on most courses', () => {
    const seeds = [5, 36, 67, 98, 129, 160, 191, 222]
    const wins = seeds.filter((s) => race(s, 'hard') < race(s, 'easy')).length
    expect(wins).toBeGreaterThanOrEqual(7)
  })
})

describe('crash it game', () => {
  function run(seed: number, d: Difficulty, target?: number) {
    const stage = {} as Stage
    const ctx: GameContext = {
      stage,
      input: new Input(stage, '2p', 0),
      fx: new Fx(),
      audio: { play: () => {} } as unknown as GameContext['audio'],
      rng: new Rng(seed),
      mode: '2p',
      difficulty: d,
      bots: [true, true],
      teams: false,
      names: ['Red', 'Blue'],
      local: 0,
      seed,
      target,
    }
    const game = makeGame()
    game.init(ctx)
    let steps = 0
    while (!game.result && steps < 60 * 900) {
      game.update(1 / 60)
      steps++
    }
    return { game, steps }
  }

  it('a bot-vs-bot race reaches a result within bounded steps on every seed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { game, steps } = run(seed, 'normal')
      expect(game.result).not.toBeNull()
      expect(steps).toBeLessThan(60 * 200)
    }
  })

  it('a match of the chosen length ends once one side has that many race wins', () => {
    const { game, steps } = run(5, 'hard', 3)
    expect(game.result).not.toBeNull()
    expect(steps).toBeLessThan(60 * 900)
    expect(game.result?.winner).not.toBe('draw')
    expect(game.result?.score).toHaveLength(2)
    const [a, b] = game.result?.score ?? [0, 0]
    expect(Math.max(a, b)).toBe(3)
    expect(Math.min(a, b)).toBeLessThan(3)
  })

  it('the hard bot reliably finishes', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const { game } = run(seed, 'hard')
      expect(game.result?.winner).not.toBeUndefined()
      expect(game.s.lanes.some((l) => l.finished)).toBe(true)
    }
  })
})
