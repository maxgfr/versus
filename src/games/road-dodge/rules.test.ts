import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { bestLane, botLateral, DodgeBot, farthestLane, laneScore } from './bot.ts'
import {
  CAR_Y,
  type Ev,
  INVULN,
  LANE_X,
  LATERAL,
  laneOf,
  LIVES,
  newWorld,
  type Obs,
  OVERTIME,
  ROAD_L,
  ROAD_R,
  ROW_GAP,
  doubleChance,
  roundOver,
  speedAt,
  VTOP,
  stepWorld,
  TEMPO,
  tempoOf,
  type World,
} from './rules.ts'

const STEP = 1 / 60
const NONE: [number | null, number | null] = [null, null]

/** Place an oncoming car in `lane` of both roads, just above the driver's car. */
function dropCar(w: World, lane: number, y = CAR_Y - 40): void {
  const o = (): Obs => ({ id: w.nextId, lane, y, near: false })
  w.obs[0].push(o())
  w.obs[1].push(o())
  w.nextId++
}

/** Keep the next scheduled spawn far in the future so tests control the traffic. */
function quiet(w: World): World {
  w.nextAt = 1e9
  return w
}

/** Put red's car in `lane`, and blue's out of the way in the left lane (cars are dropped on both roads). */
function park(w: World, lane: number): void {
  w.drivers[0].x = LANE_X[lane] as number
  w.drivers[0].tx = LANE_X[lane] as number
  w.drivers[1].x = LANE_X[0] as number
  w.drivers[1].tx = LANE_X[0] as number
}

function run(w: World, seconds: number, steer = NONE): Ev[] {
  const ev: Ev[] = []
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepWorld(w, STEP, steer, ev)
  return ev
}

describe('traffic', () => {
  it('both roads get the very same oncoming cars', () => {
    const w = newWorld(99)
    // Before anyone can crash (the first car needs ~1.5 s to reach the driver), the rosters match.
    run(w, 2, NONE)
    expect(w.obs[0].length).toBeGreaterThan(0)
    expect(w.obs[0].map((o) => [o.id, o.lane, Math.round(o.y)])).toEqual(
      w.obs[1].map((o) => [o.id, o.lane, Math.round(o.y)]),
    )
  })

  it('the lanes are seeded and every lane gets traffic over a round', () => {
    const lanes = new Set<number>()
    for (let k = 0; k < 60; k++) lanes.add(laneOf(12, k))
    expect(lanes.size).toBe(LANE_X.length)
    for (let k = 0; k < 60; k++) expect(laneOf(12, k)).toBe(laneOf(12, k))
  })

  it('speed ramps with round time, holds, then creeps on in overtime to a cap', () => {
    expect(speedAt(10)).toBeGreaterThan(speedAt(0))
    expect(speedAt(40)).toBe(900)
    expect(speedAt(OVERTIME)).toBe(900)
    expect(speedAt(OVERTIME + 20)).toBeGreaterThan(900)
    expect(speedAt(1000)).toBe(VTOP)
  })

  it('two-car rows come later in a round, always leave a lane open, with room around them', () => {
    expect(doubleChance(0)).toBe(0)
    expect(doubleChance(120)).toBeGreaterThan(0.2)
    const w = newWorld(77)
    // Record each car's spawn time and lane by watching the obstacle list grow.
    const rowsAt = new Map<number, number[]>()
    let seen = 0
    for (let i = 0; i < 60 * 150; i++) {
      stepWorld(w, STEP, NONE, [], false)
      for (const o of w.obs[0]) {
        if (o.id <= seen) continue
        seen = o.id
        const t = Math.round(w.rt * 1000)
        rowsAt.set(t, [...(rowsAt.get(t) ?? []), o.lane])
      }
    }
    const times = [...rowsAt.keys()].sort((a, b) => a - b)
    let rows = 0
    times.forEach((t, i) => {
      const lanes = rowsAt.get(t) ?? []
      expect(lanes.length).toBeLessThanOrEqual(2)
      if (lanes.length < 2) return
      rows++
      expect(new Set(lanes).size).toBe(2)
      const before = times[i - 1]
      const after = times[i + 1]
      if (before !== undefined) expect(t - before).toBeGreaterThanOrEqual(ROW_GAP * 1000 - 20)
      if (after !== undefined) expect(after - t).toBeGreaterThanOrEqual(ROW_GAP * 1000 - 20)
    })
    expect(rows).toBeGreaterThan(3)
  })

  it('a new car arrives on a schedule that tightens over the round', () => {
    const w = newWorld(5)
    run(w, 60, NONE)
    expect(w.k).toBeGreaterThan(40)
  })
})

describe('steering', () => {
  it('follows the wanted x at lateral speed and stays on the road', () => {
    const w = quiet(newWorld(1))
    const start = w.drivers[0].x
    run(w, 0.1, [LANE_X[0] as number, null])
    expect(Math.abs(w.drivers[0].x - start)).toBeLessThanOrEqual(LATERAL * 0.1 + 1e-6)
    run(w, 3, [-500, null])
    expect(w.drivers[0].x).toBeGreaterThanOrEqual(ROAD_L + 46)
    run(w, 3, [5000, null])
    expect(w.drivers[0].x).toBeLessThanOrEqual(ROAD_R - 46)
  })

  it('a null steer holds the car where it is', () => {
    const w = quiet(newWorld(1))
    run(w, 0.5, [LANE_X[0] as number, null])
    const x = w.drivers[0].x
    run(w, 1, NONE)
    expect(w.drivers[0].x).toBe(x)
  })
})

describe('crashes', () => {
  it('an oncoming car in your lane costs a life and removes that car', () => {
    const w = quiet(newWorld(2))
    park(w, 1)
    dropCar(w, 1)
    const ev = run(w, 0.05, [LANE_X[1] as number, null])
    expect(ev.some((e) => e.k === 'hit' && e.side === 0)).toBe(true)
    expect(w.drivers[0].lives).toBe(LIVES - 1)
    expect(w.obs[0].filter((o) => o.lane === 1).length).toBe(0)
    // Blue, out of the way, is untouched.
    expect(w.drivers[1].lives).toBe(LIVES)
  })

  it('after a crash the driver is invulnerable for a moment', () => {
    const w = quiet(newWorld(3))
    park(w, 1)
    dropCar(w, 1)
    run(w, 0.05, [LANE_X[1] as number, null])
    dropCar(w, 1)
    run(w, 0.05, [LANE_X[1] as number, null])
    expect(w.drivers[0].lives).toBe(LIVES - 1)
    run(w, INVULN + 0.1, [LANE_X[1] as number, null])
    dropCar(w, 1)
    run(w, 0.05, [LANE_X[1] as number, null])
    expect(w.drivers[0].lives).toBe(LIVES - 2)
  })

  it('three crashes and you are out, and the other driver wins the round', () => {
    const w = quiet(newWorld(4))
    park(w, 1)
    for (let i = 0; i < LIVES; i++) {
      dropCar(w, 1)
      run(w, 0.05, [LANE_X[1] as number, null])
      run(w, INVULN + 0.05, [LANE_X[1] as number, null])
    }
    expect(w.drivers[0].out).toBe(true)
    expect(roundOver(w)).toBe(1)
  })

  it('both out on the same step is a draw', () => {
    const w = quiet(newWorld(5))
    w.drivers[0].out = true
    w.drivers[1].out = true
    expect(roundOver(w)).toBe('draw')
  })

  it('no round over while both are still driving', () => {
    expect(roundOver(quiet(newWorld(6)))).toBeNull()
  })

  it("a close pass with a finger's width to spare reports a near miss, once", () => {
    const w = quiet(newWorld(7))
    // Red sits between lanes 1 and 2: the car in lane 1 misses it by a little.
    w.drivers[0].x = w.drivers[0].tx = 600
    w.drivers[1].x = w.drivers[1].tx = LANE_X[0] as number
    w.obs[0].push({ id: 50, lane: 1, y: CAR_Y - 260, near: false })
    w.obs[1].push({ id: 50, lane: 1, y: CAR_Y - 260, near: false })
    const ev = run(w, 1.5, [600, null])
    expect(ev.filter((e) => e.k === 'near' && e.side === 0).length).toBe(1)
    expect(ev.some((e) => e.k === 'hit')).toBe(false)
    expect(w.drivers[0].lives).toBe(LIVES)
  })
})

describe('bot', () => {
  it('steers into the lane whose nearest car is farthest away', () => {
    const w = quiet(newWorld(8))
    // Lanes 0 and 1 have cars close above the driver; lane 2 is empty.
    w.obs[0].push({ id: 1, lane: 0, y: CAR_Y - 200, near: false })
    w.obs[0].push({ id: 2, lane: 1, y: CAR_Y - 300, near: false })
    expect(farthestLane(w, 0, 1)).toBe(2)
    // A car far up lane 2 is still farther than a close one in lane 1.
    w.obs[0].push({ id: 3, lane: 2, y: CAR_Y - 900, near: false })
    expect(farthestLane(w, 0, 1)).toBe(2)
  })

  it('never swerves through a lane with a car alongside', () => {
    const w = quiet(newWorld(8))
    park(w, 0)
    // Lane 0 (here) is about to be hit; lane 1 has a car right alongside; lane 2 is open.
    w.obs[0].push({ id: 1, lane: 0, y: CAR_Y - 260, near: false })
    w.obs[0].push({ id: 2, lane: 1, y: CAR_Y - 60, near: false })
    // Crossing lane 1 now means a crash; the open lane 2 is not reachable safely.
    expect(laneScore(w, 0, LANE_X[0] as number, 2, 1000)).toBeLessThan(0)
    expect(laneScore(w, 0, LANE_X[0] as number, 1, 1000)).toBeLessThan(0)
    // Once that car has gone by, the bot gets out of the doomed lane.
    w.obs[0][1]!.y = CAR_Y + 200
    expect(bestLane(w, 0, LANE_X[0] as number, 0, 1000)).not.toBe(0)
    expect(laneScore(w, 0, LANE_X[0] as number, 2, 1000)).toBeGreaterThan(0)
  })

  it('a faster swerve makes a tight gap reachable', () => {
    const w = quiet(newWorld(8))
    park(w, 0)
    w.obs[0].push({ id: 1, lane: 1, y: CAR_Y - 330, near: false })
    expect(laneScore(w, 0, LANE_X[0] as number, 2, 700)).toBeLessThan(0)
    expect(laneScore(w, 0, LANE_X[0] as number, 2, 2600)).toBeGreaterThan(0)
  })

  it('a hard bot outlasts an easy one most of the time', () => {
    let hard = 0
    const n = 10
    for (let seed = 1; seed <= n; seed++) {
      const w = newWorld(seed * 13)
      const bots = [new DodgeBot(new Rng(seed), 'hard'), new DodgeBot(new Rng(seed + 50), 'easy')]
      const lat: [number, number] = [botLateral('hard'), botLateral('easy')]
      let steps = 0
      while (roundOver(w) === null && steps < 60 * 150) {
        const steer: [number, number] = [
          bots[0]?.decide(w, 0, STEP) ?? 0,
          bots[1]?.decide(w, 1, STEP) ?? 0,
        ]
        stepWorld(w, STEP, steer, [], true, lat)
        steps++
      }
      if (roundOver(w) === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(8)
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d} bots end a round in bounded time with a winner or a draw`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const w = newWorld(seed * 31)
        const bots = [new DodgeBot(new Rng(seed), d), new DodgeBot(new Rng(seed + 9), d)]
        const ev: Ev[] = []
        let steps = 0
        while (roundOver(w) === null && steps < 60 * 150) {
          const steer: [number, number] = [
            bots[0]?.decide(w, 0, STEP) ?? 0,
            bots[1]?.decide(w, 1, STEP) ?? 0,
          ]
          stepWorld(w, STEP, steer, ev)
          steps++
        }
        expect(roundOver(w)).not.toBeNull()
        expect(w.rt).toBeLessThan(150)
      }
    })
  }
})

describe('tempo', () => {
  /** Road covered in the first ten seconds of a round. */
  function covered(tempo?: number): number {
    const w = quiet(newWorld(3, tempo))
    for (let i = 0; i < 600; i++) stepWorld(w, STEP, NONE, [], false)
    return w.dist
  }

  it('normal keeps the traffic speed exactly as before', () => {
    expect(TEMPO.normal).toBe(1)
    expect(newWorld(1).tempo).toBe(1)
    expect(speedAt(0)).toBe(470)
    expect(speedAt(40, TEMPO.normal)).toBe(900)
    expect(covered(TEMPO.normal)).toBe(covered())
  })

  it('hard scrolls clearly faster, easy calmer', () => {
    expect(covered(TEMPO.hard) / covered()).toBeGreaterThan(1.2)
    expect(covered(TEMPO.easy) / covered()).toBeLessThan(0.9)
    expect(speedAt(40, TEMPO.hard)).toBeGreaterThan(1100)
  })

  it('only a match with a computer changes pace', () => {
    expect(tempoOf('hard', [false, true])).toBe(TEMPO.hard)
    expect(tempoOf('easy', [true, true])).toBe(TEMPO.easy)
    expect(tempoOf('hard', [false, false])).toBe(1)
  })

  it('at the hard tempo bots still end rounds, and hard still outlasts easy', () => {
    let hard = 0
    const n = 10
    for (let seed = 1; seed <= n; seed++) {
      const w = newWorld(seed * 13, TEMPO.hard)
      const bots = [new DodgeBot(new Rng(seed), 'hard'), new DodgeBot(new Rng(seed + 50), 'easy')]
      const lat: [number, number] = [botLateral('hard'), botLateral('easy')]
      let steps = 0
      while (roundOver(w) === null && steps < 60 * 150) {
        const steer: [number, number] = [
          bots[0]?.decide(w, 0, STEP) ?? 0,
          bots[1]?.decide(w, 1, STEP) ?? 0,
        ]
        stepWorld(w, STEP, steer, [], true, lat)
        steps++
      }
      expect(roundOver(w)).not.toBeNull()
      if (roundOver(w) === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(8)
  })
})
