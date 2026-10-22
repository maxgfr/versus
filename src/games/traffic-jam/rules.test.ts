import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { CrossBot } from './bot.ts'
import {
  AVENUES,
  BUFFER,
  canLaunch,
  COL_BAND,
  carWindow,
  crossAt,
  crossWindow,
  crossX,
  type Ev,
  FAST,
  GO_GAP,
  LAUNCH_Y,
  launchSafe,
  newWorld,
  ROAD_X,
  SPEED,
  STALL,
  stepWorld,
  winnerOf,
  type World,
} from './rules.ts'

const STEP = 1 / 60

/** A world with no cross traffic at all (schedules pushed past any test). */
function emptyRoad(seed = 1): World {
  const w = newWorld(seed)
  w.next = AVENUES.map(() => 1e9)
  return w
}

const NONE: [boolean, boolean] = [false, false]

/** Run `seconds` of steps; the presses land on the first step only (a tap). */
function run(w: World, seconds: number, presses: [boolean, boolean] = NONE): Ev[] {
  const ev: Ev[] = []
  const n = Math.round(seconds / STEP)
  for (let i = 0; i < n; i++) stepWorld(w, STEP, i === 0 ? presses : NONE, ev)
  return ev
}

describe('cross traffic', () => {
  it('is a pure function of the seed, monotonic in time, with bounded speeds', () => {
    for (let lane = 0; lane < AVENUES.length; lane++) {
      let prev = -Infinity
      for (let k = 0; k < 200; k++) {
        const a = crossAt(42, lane, k)
        expect(crossAt(42, lane, k)).toEqual(a)
        expect(a.t0).toBeGreaterThan(prev)
        expect(a.v).toBeGreaterThanOrEqual(300)
        // The traffic speeds up over the match, by at most 50.
        expect(a.v).toBeLessThanOrEqual(430)
        prev = a.t0
      }
    }
    expect(crossAt(1, 0, 3)).not.toEqual(crossAt(2, 0, 3))
    // And the gaps close up: the last ten cars come closer together than the first ten.
    const gap = (k: number) => crossAt(42, 0, k + 10).t0 - crossAt(42, 0, k).t0
    expect(gap(30)).toBeLessThan(gap(0) * 0.85)
  })

  it('moves straight along its avenue from just off the edge', () => {
    const c = { lane: 0, t0: 1, v: 300, dir: 1 as const }
    expect(crossX(c, 1)).toBeLessThan(-100)
    expect(crossX(c, 2)).toBeCloseTo(-124 + 300, 6)
    const back = { lane: 1, t0: 0, v: 300, dir: -1 as const }
    expect(crossX(back, 0.5)).toBeLessThan(1000 + 124)
    expect(crossX(back, 0.5)).toBeGreaterThan(700)
  })

  it('opens a window while it overlaps a street', () => {
    const c = { lane: 0, t0: 0, v: 300, dir: 1 as const }
    const [a, b] = crossWindow(c, ROAD_X[0])
    expect(a).toBeLessThan(b)
    const mid = (a + b) / 2
    expect(Math.abs(crossX(c, mid) - ROAD_X[0])).toBeLessThan(100)
  })
})

describe('launching', () => {
  it('a car cruises up red street and counts as across at the far edge', () => {
    const w = emptyRoad()
    w.racers[0].queue = 2
    const ev = run(w, 0.05, [true, false])
    expect(ev.some((e) => e.k === 'launch' && e.side === 0)).toBe(true)
    expect(w.racers[0].queue).toBe(1)
    expect(w.racers[0].cars.length).toBe(1)
    const more = run(w, 5)
    expect(more.filter((e) => e.k === 'across' && e.side === 0).length).toBeGreaterThanOrEqual(1)
    expect(w.racers[0].across).toBe(1)
    expect(w.racers[0].cars.length).toBe(0)
  })

  it('blue launches from the top and moves down to the bottom edge', () => {
    const w = emptyRoad()
    w.racers[1].queue = 1
    run(w, 0.05, [false, true])
    const car = w.racers[1].cars[0]
    expect(car).toBeDefined()
    expect(car?.y).toBeGreaterThan(LAUNCH_Y[1])
    run(w, 5)
    expect(w.racers[1].across).toBe(1)
  })

  it('a tap while the street is blocked waits, then launches when the lane clears', () => {
    const w = emptyRoad()
    w.racers[0].queue = 3
    w.racers[0].cars.push({ id: 99, y: LAUNCH_Y[0] - (GO_GAP - 40), prog: GO_GAP - 40 })
    expect(canLaunch(w, 0)).toBe(false)
    const ev = run(w, 0.25, [true, false])
    expect(ev.some((e) => e.k === 'refuse')).toBe(false)
    expect(ev.some((e) => e.k === 'launch')).toBe(true)
  })

  it('a tap that cannot launch within the buffer is refused', () => {
    const w = emptyRoad()
    w.racers[0].queue = 3
    w.racers[0].cars.push({ id: 99, y: LAUNCH_Y[0], prog: 0 })
    const ev = run(w, BUFFER + 0.1, [true, false])
    expect(ev.some((e) => e.k === 'refuse' && e.side === 0)).toBe(true)
    expect(w.racers[0].queue).toBe(3)
  })

  it('with the queue empty nothing launches', () => {
    const w = emptyRoad()
    w.racers[0].queue = 0
    const ev = run(w, 0.5, [true, false])
    expect(ev.some((e) => e.k === 'launch')).toBe(false)
    expect(canLaunch(w, 0)).toBe(false)
  })
})

describe('crashes', () => {
  it('a car hit by a cross car is lost and the side stalls for a second', () => {
    const w = emptyRoad()
    w.racers[0].queue = 2
    // A fast car on the middle avenue, timed to meet red's car where it crosses y=900.
    const v = 300
    const t = (LAUNCH_Y[0] - AVENUES[1]!) / 430
    w.cross.push({ lane: 1, t0: t - (ROAD_X[0] + 124) / v, v, dir: 1 })
    w.racers[0].cars.push({ id: 1, y: LAUNCH_Y[0], prog: 0 })
    // Step until the crash lands (it happens around 1.4 s), then look right after it.
    const ev: Ev[] = []
    for (let i = 0; i < 3 * 60 && !ev.some((e) => e.k === 'crash'); i++)
      stepWorld(w, STEP, NONE, ev)
    const crash = ev.find((e) => e.k === 'crash')
    expect(crash).toBeDefined()
    expect(crash?.side).toBe(0)
    expect(w.racers[0].crashes).toBe(1)
    expect(w.racers[0].across).toBe(0)
    expect(w.racers[0].cars.length).toBe(0)
    // Right after the crash the side is stalled for STALL seconds.
    expect(w.racers[0].stallUntil - w.t).toBeCloseTo(STALL, 1)
    expect(canLaunch(w, 0)).toBe(false)
  })

  it('while stalled a tap is refused, and launching resumes after the stall', () => {
    const w = emptyRoad()
    w.racers[0].queue = 4
    w.racers[0].stallUntil = w.t + STALL
    const early = run(w, 0.2, [true, false])
    expect(early.some((e) => e.k === 'launch')).toBe(false)
    run(w, STALL)
    const late = run(w, 0.1, [true, false])
    expect(late.some((e) => e.k === 'launch')).toBe(true)
  })
})

describe('safety', () => {
  it('an empty crossing is safe; a cross car arriving as red passes is not', () => {
    const w = emptyRoad()
    expect(launchSafe(w, 0, 0)).toBe(true)
    // A cross car timed to be in red's street exactly when red's car passes y=900.
    const v = 300
    const passAt = (LAUNCH_Y[0] - AVENUES[1]!) / 430
    w.cross.push({ lane: 1, t0: passAt - (ROAD_X[0] + 124) / v, v, dir: 1 })
    expect(launchSafe(w, 0, 0)).toBe(false)
    // Launched well after the car has gone by, the same crossing is clear again.
    expect(launchSafe(w, 0, passAt + 5)).toBe(true)
  })

  it('a negative margin accepts a near miss the normal margin rejects', () => {
    const w = emptyRoad()
    const v = 300
    // A cross car that reaches red's street 0.05 s after red has left the avenue.
    const leaves = carWindow(0, AVENUES[1] as number, 0)[1]
    const enters = crossWindow({ lane: 1, t0: 0, v, dir: 1 }, ROAD_X[0])[0]
    w.cross.push({ lane: 1, t0: leaves + 0.05 - enters, v, dir: 1 })
    expect(launchSafe(w, 0, 0, 0.1)).toBe(false)
    expect(launchSafe(w, 0, 0, -0.2)).toBe(true)
  })
})

describe('bot', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d} bots launch only into gaps and finish a 45 s crossing`, () => {
      const w = newWorld(7)
      const bots = [new CrossBot(new Rng(11), d), new CrossBot(new Rng(12), d)]
      const ev: Ev[] = []
      let steps = 0
      while (w.t < 45 && steps < 60 * 90) {
        const presses: [boolean, boolean] = [
          bots[0]?.decide(w, 0, STEP) ?? false,
          bots[1]?.decide(w, 1, STEP) ?? false,
        ]
        stepWorld(w, STEP, presses, ev)
        steps++
      }
      expect(w.t).toBeGreaterThanOrEqual(45)
      expect(winnerOf(w)).toBeDefined()
      expect(w.racers[0].across + w.racers[0].crashes).toBeGreaterThan(0)
      expect(w.racers[1].across + w.racers[1].crashes).toBeGreaterThan(0)
    })
  }

  it('the hard bot crosses more cars than the easy one', () => {
    const count = (d: 'easy' | 'hard') => {
      let total = 0
      for (let seed = 1; seed <= 4; seed++) {
        const w = newWorld(seed)
        const bot = new CrossBot(new Rng(seed * 3), d)
        while (w.t < 45) {
          const press = bot.decide(w, 0, STEP)
          stepWorld(w, STEP, [press, false], [])
        }
        total += w.racers[0].across
      }
      return total
    }
    expect(count('hard')).toBeGreaterThanOrEqual(count('easy'))
  })

  it('hard beats normal and easy head to head from either street', () => {
    for (const weak of ['easy', 'normal'] as const) {
      let wins = 0
      for (let seed = 1; seed <= 6; seed++) {
        const hs = seed % 2 ? 0 : 1
        const w = newWorld(seed * 5)
        const bots = [
          new CrossBot(new Rng(seed), hs === 0 ? 'hard' : weak),
          new CrossBot(new Rng(seed + 7), hs === 1 ? 'hard' : weak),
        ]
        while (w.t < 45) {
          const presses: [boolean, boolean] = [
            bots[0]!.decide(w, 0, STEP),
            bots[1]!.decide(w, 1, STEP),
          ]
          const gas: [boolean, boolean] = [bots[0]!.gas(w, 0), bots[1]!.gas(w, 1)]
          stepWorld(w, STEP, presses, [], true, gas)
        }
        if (winnerOf(w) === hs) wins++
      }
      expect(wins).toBeGreaterThanOrEqual(weak === 'easy' ? 5 : 4)
    }
  })
})

describe('the gas pedal', () => {
  it('holding Go speeds your cars up to FAST; letting go eases them back', () => {
    const w = emptyRoad()
    run(w, 0.05, [true, false])
    const car = w.racers[0].cars[0]!
    for (let i = 0; i < 40; i++) stepWorld(w, STEP, NONE, [], true, [true, false])
    expect(car.v).toBeCloseTo(FAST, 0)
    for (let i = 0; i < 60; i++) stepWorld(w, STEP, NONE, [], true, [false, false])
    expect(car.v).toBeCloseTo(SPEED, 0)
  })

  it('a gap too tight at cruising speed can be open at full throttle', () => {
    const w = emptyRoad()
    const v = 300
    // A cross car that reaches red's street just as a cruising car would reach the far avenue.
    const lane = 0
    const reach = carWindow(0, AVENUES[lane] as number, 0)[0]
    const enters = crossWindow({ lane, t0: 0, v, dir: 1 }, ROAD_X[0])[0]
    w.cross.push({ lane, t0: reach + 0.05 - enters, v, dir: 1 })
    expect(launchSafe(w, 0, 0, 0.05)).toBe(false)
    expect(launchSafe(w, 0, 0, 0.05, FAST)).toBe(true)
  })

  it('the bot judges only traffic already on the road', () => {
    const w = newWorld(3)
    // Nothing has spawned yet: the schedule says otherwise, but nobody can see it.
    expect(w.cross).toHaveLength(0)
    expect(launchSafe(w, 0, 0, 0.1, SPEED, true)).toBe(true)
  })

  it('a cross car that only just misses is a close shave, cheered once', () => {
    const w = emptyRoad()
    run(w, 0.05, [true, false])
    const car = w.racers[0].cars[0]!
    // Park the car on the middle avenue with a cross car right beside it, not touching.
    car.y = AVENUES[1] as number
    w.cross.push({ lane: 1, t0: w.t - 1, v: 0.0001, dir: 1 })
    const c = w.cross[0]!
    c.t0 = w.t - (ROAD_X[0] - (COL_BAND + 30) + 124) / c.v
    const ev: Ev[] = []
    stepWorld(w, 1e-6, NONE, ev)
    stepWorld(w, 1e-6, NONE, ev)
    expect(ev.filter((e) => e.k === 'close')).toHaveLength(1)
    expect(ev.some((e) => e.k === 'crash')).toBe(false)
  })
})
