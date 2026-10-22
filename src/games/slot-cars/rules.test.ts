import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { STEP } from '../../core/game.ts'
import { SlotBot } from './bot.ts'
import {
  A_MAX,
  ACCEL,
  BACK,
  type Car,
  curvatureAt,
  DRAG,
  type Ev,
  LANE,
  newCar,
  pose,
  RESPAWN,
  stepCars,
  TOP,
  track,
  winnerOf,
} from './rules.ts'

const NO = [false, false]

/** Arc position of the flattest part of a side's lane (a lobe tip), so tests can cruise. */
function calmArc(side: 0 | 1): number {
  const tr = track()
  let best = 0
  let bestK = Infinity
  const lane = tr.lanes[side]
  for (let i = 0; i < lane.pts.length; i++) {
    const k = Math.abs(tr.kap[i] ?? 0)
    if (k < bestK) {
      bestK = k
      best = i
    }
  }
  return lane.cum[best] ?? 0
}

/** Run the race for `secs` with a fixed throttle for each car; returns the events. */
function run(cars: Car[], throttle: boolean[], secs: number, from = 0, go = 0, goal = 99): Ev[] {
  const ev: Ev[] = []
  let t = from
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    t += STEP
    stepCars(cars, throttle, STEP, t, go, goal, ev)
  }
  return ev
}

describe('the figure-eight', () => {
  it('gives both lanes the same length and keeps them on the table', () => {
    const tr = track()
    const [red, blue] = tr.lanes
    expect(Math.abs(red.len - blue.len) / red.len).toBeLessThan(0.01)
    for (const lane of [red, blue])
      for (const p of lane.pts) {
        expect(p.x).toBeGreaterThan(40)
        expect(p.x).toBeLessThan(960)
        expect(p.y).toBeGreaterThan(40)
        expect(p.y).toBeLessThan(1760)
      }
  })

  it('has bends that a lane can take (the lane offset is well inside the tightest turn)', () => {
    const tr = track()
    const tightest = 1 / Math.max(...tr.kap.map((k) => Math.abs(k)))
    expect(tightest).toBeGreaterThan(LANE * 2)
  })

  it('puts the lanes on opposite sides of the centre line, red outside', () => {
    const tr = track()
    const i = 0
    const c = pose(tr, 0, 0)
    const b = pose(tr, 1, 0)
    expect(
      Math.hypot(c.x - (tr.lanes[0].pts[i]?.x ?? 0), c.y - (tr.lanes[0].pts[i]?.y ?? 0)),
    ).toBeLessThan(1e-6)
    expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeCloseTo(2 * LANE, 0)
  })
})

describe('driving', () => {
  it('a car sits still until the race starts', () => {
    const cars = [newCar(0), newCar(1)]
    const x = cars[0]?.s
    run(cars, [true, true], 2, 0, 3)
    expect(cars[0]?.s).toBe(x)
    expect(cars[0]?.v).toBe(0)
  })

  it('the throttle speeds a car up along v = TOP (1 - e^(-DRAG t)) on a calm stretch', () => {
    const tr = track()
    const cars = [newCar(0), newCar(1)]
    const c = cars[0] as Car
    c.s = calmArc(0)
    const p = pose(tr, 0, c.s)
    c.x = p.x
    c.y = p.y
    c.h = p.h
    run(cars, [true, false], 1)
    expect(c.v).toBeGreaterThan(0)
    const exact = TOP * (1 - Math.exp(-DRAG * 1))
    expect(Math.abs(c.v - exact) / exact).toBeLessThan(0.01)
    expect(c.v).toBeLessThanOrEqual(TOP + 1e-6)
  })

  it('coasting loses speed by drag: v halves in about ln(2) / DRAG seconds', () => {
    const tr = track()
    const cars = [newCar(0), newCar(1)]
    const c = cars[0] as Car
    c.s = calmArc(0)
    c.v = 300
    const p = pose(tr, 0, c.s)
    c.x = p.x
    c.y = p.y
    run(cars, [false, false], Math.LN2 / DRAG)
    expect(c.v).toBeGreaterThan(140)
    expect(c.v).toBeLessThan(160)
  })

  it('the throttle is accelerating, not coasting, when it is held', () => {
    const cars = [newCar(0), newCar(1)]
    const c = cars[0] as Car
    c.s = calmArc(0)
    c.v = 100
    run(cars, [true, false], 0.1)
    expect(c.v).toBeGreaterThan(100)
    expect(c.v).toBeLessThanOrEqual(100 + ACCEL * 0.1 + 1e-9)
  })

  it('taking a bend too fast throws the car off: it flies, then comes back a bit behind', () => {
    const tr = track()
    const cars = [newCar(0), newCar(1)]
    const c = cars[0] as Car
    // Find the sharpest bend on red's lane and arrive at it at full speed.
    let sharp = 0
    let worst = 0
    for (let i = 0; i < tr.lanes[0].pts.length; i++) {
      const k = Math.abs(tr.kap[i] ?? 0)
      if (k > worst) {
        worst = k
        sharp = i
      }
    }
    c.s = (tr.lanes[0].cum[sharp] ?? 0) - 5
    const p = pose(tr, 0, c.s)
    c.x = p.x
    c.y = p.y
    c.h = p.h
    c.v = TOP
    const ev = run(cars, NO, 0.2, 0, 0)
    expect(ev.some((e) => e.k === 'crash' && e.side === 0)).toBe(true)
    expect(c.st).toBe('fly')
    const crashedAt = c.s
    run(cars, NO, RESPAWN + STEP * 2, 0.2, 0)
    expect(c.st).toBe('run')
    expect(c.v).toBe(0)
    expect(c.s).toBeCloseTo(Math.max(0, crashedAt - BACK), 0)
  })

  it('the speed a bend allows is sqrt(A_MAX / curvature)', () => {
    const tr = track()
    for (let i = 0; i < tr.lanes[0].pts.length; i += 60) {
      const s = tr.lanes[0].cum[i] ?? 0
      const k = Math.abs(curvatureAt(tr, 0, s))
      if (k < 1e-6) continue
      expect(Math.sqrt(A_MAX / k)).toBeLessThanOrEqual(TOP / 1 + 1e-6 + 1e9)
    }
  })

  it('crossing the start line counts a lap; the goal is the chosen number of laps', () => {
    const tr = track()
    const cars = [newCar(0), newCar(1)]
    const c = cars[0] as Car
    const len = tr.lanes[0].len
    c.s = len - 3
    const p = pose(tr, 0, c.s)
    c.x = p.x
    c.y = p.y
    c.h = p.h
    c.v = 200
    const ev = run(cars, NO, 0.1, 0, 0, 1)
    expect(c.laps).toBe(1)
    expect(ev.some((e) => e.k === 'lap' && e.lap === 1)).toBe(true)
    expect(c.finishT).toBeGreaterThanOrEqual(0)
    expect(winnerOf(cars)).toBe(0)
  })

  it('the first car to finish wins', () => {
    const cars = [newCar(0), newCar(1)]
    expect(winnerOf(cars)).toBeNull()
    const b = cars[1] as Car
    b.finishT = 12
    expect(winnerOf(cars)).toBe(1)
    const a = cars[0] as Car
    a.finishT = 11
    expect(winnerOf(cars)).toBe(0)
  })
})

describe('bots', () => {
  function race(a: Difficulty, b: Difficulty, laps: number) {
    const cars = [newCar(0), newCar(1)]
    const bots = [SlotBot.of(a), SlotBot.of(b)]
    const crashes = [0, 0]
    let t = 0
    for (let i = 0; i < 60 * 300; i++) {
      t += STEP
      const ev: Ev[] = []
      const th = cars.map((c, k) => (bots[k] as SlotBot).throttle(c))
      stepCars(cars, th, STEP, t, 3, laps, ev)
      for (const e of ev) if (e.k === 'crash') crashes[e.side] = (crashes[e.side] ?? 0) + 1
      if (winnerOf(cars) !== null) return { t, crashes }
    }
    return null
  }

  it('the hard and normal computer drivers finish five laps without leaving the track', () => {
    for (const d of ['normal', 'hard'] as const) {
      const r = race(d, d, 5)
      expect(r).not.toBeNull()
      expect(r?.crashes).toEqual([0, 0])
      expect(r?.t ?? 999).toBeLessThan(90)
    }
  })

  it('the easy driver overshoots now and then, so it crashes more', () => {
    const r = race('easy', 'easy', 5)
    expect(r).not.toBeNull()
    expect((r?.crashes[0] ?? 0) + (r?.crashes[1] ?? 0)).toBeGreaterThan(0)
    expect(r?.t ?? 0).toBeLessThan(200)
  })

  it('the throttle profile is held on a straight and lifted before a bend', () => {
    const tr = track()
    const bot = SlotBot.of('hard')
    const c = newCar(0)
    c.s = calmArc(0)
    c.v = 20
    const p = pose(tr, 0, c.s)
    c.x = p.x
    c.y = p.y
    c.h = p.h
    c.st = 'run'
    expect(bot.throttle(c)).toBe(true)
    // Right at the sharpest bend at top speed, it must be off.
    let worst = 0
    let at = 0
    for (let i = 0; i < tr.lanes[0].pts.length; i++) {
      const k = Math.abs(tr.kap[i] ?? 0)
      if (k > worst) {
        worst = k
        at = i
      }
    }
    c.s = (tr.lanes[0].cum[at] ?? 0) - 20
    c.v = TOP
    expect(bot.throttle(c)).toBe(false)
  })

  it('a half squeeze of the trigger tops out at half speed', () => {
    const half = newCar(0)
    const full = newCar(1)
    for (let i = 0; i < 60 * 14; i++) {
      stepCars([half], [0.5, 0], STEP, i * STEP, 0, 99, [])
      stepCars([full], [0, 1], STEP, i * STEP, 0, 99, [])
      // Park them back on the start so no bend throws them.
      half.s = full.s = 0
    }
    expect(half.v).toBeCloseTo(TOP / 2, 0)
    expect(full.v).toBeCloseTo(TOP, 0)
  })

  it('hard beats easy over five laps', () => {
    let hard = 0
    for (const hardSide of [0, 1] as const) {
      const cars = [newCar(0), newCar(1)]
      const bots = [
        SlotBot.of(hardSide === 0 ? 'hard' : 'easy'),
        SlotBot.of(hardSide === 1 ? 'hard' : 'easy'),
      ]
      let w: 0 | 1 | null = null
      for (let i = 0; i < 60 * 300 && w === null; i++) {
        const th = cars.map((c, k) => (bots[k] as SlotBot).throttle(c))
        stepCars(cars, th, STEP, i * STEP, 0, 5, [])
        w = winnerOf(cars)
      }
      if (w === hardSide) hard++
    }
    expect(hard).toBe(2)
  })
})
