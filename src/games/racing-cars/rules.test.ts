import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { RaceBot } from './bot.ts'
import {
  buildTrack,
  type Car,
  controlPoints,
  COUNT,
  type Drive,
  type Ev,
  gridCar,
  GRASS,
  CHARGE_MIN,
  lapOf,
  nearest,
  type Pt,
  sampleAt,
  stepRace,
  TOP,
  TRACK_W,
  type Track,
  winnerOf,
} from './rules.ts'
import type { Difficulty } from '../../core/game.ts'

const NO_DRIVE: Drive = { jx: 0, jy: 0, m: 0, mul: 1 }

function trackFor(seed: number): Track {
  return buildTrack(controlPoints(new Rng(seed)))
}

function car(c: Car): Car {
  return c
}

/** Race two bots over `laps` laps. Returns the time and the winner's side, or null if nobody finished. */
function race(seed: number, a: Difficulty, b: Difficulty, laps = 3) {
  const rng = new Rng(seed)
  const tr = buildTrack(controlPoints(rng))
  const cars = [gridCar(tr, 0, 36), gridCar(tr, 1, 36)] as const
  const bots = [RaceBot.of(rng.fork(), a), RaceBot.of(rng.fork(), b)]
  const goal = laps * tr.len
  let t = 0
  for (let i = 0; i < 60 * 400; i++) {
    t += STEP
    const drives = cars.map((c, k) =>
      (bots[k] as RaceBot).drive(c, tr, Math.hypot(c.vx, c.vy), STEP),
    )
    stepRace([...cars], tr, drives, STEP, t, COUNT, goal, [])
    const w = winnerOf([...cars])
    if (w) return { t, side: w.side }
  }
  return null
}

describe('track', () => {
  it('is a simple loop that covers most of the table and stays inside it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const tr = trackFor(seed)
      expect(tr.len).toBeGreaterThan(2500)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of tr.pts) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
      // Clear of the table edge, with room for the kerb.
      expect(minX - TRACK_W / 2).toBeGreaterThan(40)
      expect(maxX + TRACK_W / 2).toBeLessThan(960)
      expect(minY - TRACK_W / 2).toBeGreaterThan(40)
      expect(maxY + TRACK_W / 2).toBeLessThan(1760)
      // No part of the road lies on another part further along the lap.
      for (let i = 0; i < tr.n; i += 3) {
        const p = tr.pts[i] as Pt
        for (let j = 0; j < tr.n; j += 3) {
          const along = Math.abs((tr.cum[i] ?? 0) - (tr.cum[j] ?? 0))
          const gap = Math.min(along, tr.len - along)
          if (gap < 500) continue
          const q = tr.pts[j] as Pt
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(TRACK_W)
        }
      }
    }
  })

  it('normalises curvature to 0..1, with its sharpest bend at 1', () => {
    const tr = trackFor(3)
    expect(Math.max(...tr.kap)).toBeCloseTo(1, 9)
    expect(Math.min(...tr.kap)).toBeGreaterThanOrEqual(0)
  })

  it('finds the nearest sample and the position along the lap', () => {
    const tr = trackFor(5)
    const p = tr.pts[100] as Pt
    expect(nearest(tr, p.x, p.y).i).toBe(100)
    expect(sampleAt(tr, tr.cum[100] ?? 0)).toBe(100)
    expect(sampleAt(tr, tr.len + (tr.cum[50] ?? 0))).toBe(50)
  })

  it('is the same for the same seed', () => {
    expect(trackFor(8).pts).toEqual(trackFor(8).pts)
  })
})

describe('driving', () => {
  it('waits for the countdown', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 36)]
    const before = { x: cars[0]?.x, y: cars[0]?.y }
    const drives: Drive[] = [{ jx: 1, jy: 0, m: 1, mul: 1 }, NO_DRIVE]
    for (let i = 0; i < 60; i++) stepRace(cars, tr, drives, STEP, i * STEP, COUNT, 1e9, [])
    expect(cars[0]?.x).toBe(before.x)
    expect(cars[0]?.y).toBe(before.y)
  })

  it('accelerates on its own towards the top speed', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 36), gridCar(tr, 1, 36)]
    const go = 0
    for (let i = 0; i < 60 * 8; i++) {
      // Hold the nose along the track: the bot's job, but here a plain pursuit.
      const c = cars[0] as Car
      const target = tr.pts[sampleAt(tr, c.arc + 200)] as Pt
      const drives: Drive[] = [{ jx: target.x - c.x, jy: target.y - c.y, m: 1, mul: 1 }, NO_DRIVE]
      stepRace(cars, tr, drives, STEP, i * STEP, go, 1e9, [])
    }
    const c = cars[0] as Car
    const forward = c.vx * Math.cos(c.h) + c.vy * Math.sin(c.h)
    expect(forward).toBeGreaterThan(TOP * 0.7)
    expect(forward).toBeLessThanOrEqual(TOP + 1e-6)
  })

  it('turns toward the stick', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 36)]
    const c = cars[0] as Car
    c.h = 0
    const up = -Math.PI / 2
    for (let i = 0; i < 30; i++)
      stepRace(
        cars,
        tr,
        [{ jx: Math.cos(up), jy: Math.sin(up), m: 1, mul: 1 }, NO_DRIVE],
        STEP,
        i * STEP,
        0,
        1e9,
        [],
      )
    // Turned left (negative) from heading 0 toward -90°, and not past it.
    expect(c.h).toBeLessThan(0)
    expect(c.h).toBeGreaterThan(up - 0.01)
  })

  it('a car at speed that steers hard slides: its velocity lags its nose', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 36)]
    const c = cars[0] as Car
    c.h = 0
    c.vx = TOP
    c.vy = 0
    c.onTrack = true
    stepRace(cars, tr, [{ jx: 0, jy: 1, m: 1, mul: 1 }, NO_DRIVE], STEP, 0, 0, 1e9, [])
    stepRace(cars, tr, [{ jx: 0, jy: 1, m: 1, mul: 1 }, NO_DRIVE], STEP, STEP, 0, 1e9, [])
    const heading = Math.atan2(Math.sin(c.h), Math.cos(c.h))
    const vel = Math.atan2(c.vy, c.vx)
    expect(Math.abs(heading - vel)).toBeGreaterThan(0.05)
  })

  it('on the grass the car tops out at the grass speed', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 36)]
    const c = cars[0] as Car
    // Park it well off the road, heading away from the track.
    c.x = 30
    c.y = 900
    c.h = Math.PI
    for (let i = 0; i < 60 * 6; i++) {
      stepRace(cars, tr, [NO_DRIVE, NO_DRIVE], STEP, i * STEP, 0, 1e9, [])
      c.x = Math.max(c.x, 41)
    }
    expect(c.onTrack).toBe(false)
    expect(Math.hypot(c.vx, c.vy)).toBeLessThanOrEqual(TOP * GRASS + 1)
  })

  it('reports leaving the road once', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 36)]
    const c = cars[0] as Car
    c.x = 30
    c.y = 900
    const ev: Ev[] = []
    stepRace(cars, tr, [NO_DRIVE, NO_DRIVE], STEP, 0, 0, 1e9, ev)
    stepRace(cars, tr, [NO_DRIVE, NO_DRIVE], STEP, STEP, 0, 1e9, ev)
    expect(ev.filter((e) => e.k === 'grass').length).toBeLessThanOrEqual(1)
  })

  it('bumping cars push apart', () => {
    const tr = trackFor(2)
    const cars = [gridCar(tr, 0, 0), gridCar(tr, 1, 0)]
    const a = cars[0] as Car
    const b = cars[1] as Car
    b.x = a.x + 10
    b.y = a.y
    // Coming at each other.
    a.vx = 300
    b.vx = -300
    const ev: Ev[] = []
    stepRace(cars, tr, [NO_DRIVE, NO_DRIVE], STEP, 0, 0, 1e9, ev)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(10)
    expect(ev.some((e) => e.k === 'bump')).toBe(true)
  })
})

describe('laps', () => {
  it('counts laps from the start line and finishes at the goal', () => {
    const tr = trackFor(4)
    const c = car(gridCar(tr, 0, 36))
    c.dist = tr.len * 0.99
    expect(lapOf(c, tr, 3)).toBe(1)
    c.dist = tr.len * 1.01
    expect(lapOf(c, tr, 3)).toBe(2)
    c.dist = tr.len * 9
    expect(lapOf(c, tr, 3)).toBe(3)
    c.dist = -20
    expect(lapOf(c, tr, 3)).toBe(1)
  })

  it('the first car across the goal wins, ties go to the one further on', () => {
    const tr = trackFor(4)
    const a = gridCar(tr, 0, 36)
    const b = gridCar(tr, 1, 36)
    a.finishT = 12
    b.finishT = 11.5
    expect(winnerOf([a, b])?.side).toBe(1)
    b.finishT = -1
    expect(winnerOf([a, b])?.side).toBe(0)
    a.finishT = -1
    expect(winnerOf([a, b])).toBeNull()
  })
})

describe('bots', () => {
  for (const d of ['easy', 'normal', 'hard'] as const satisfies readonly Difficulty[]) {
    it(`bots finish three laps in bounded time (${d})`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const r = race(seed, d, d)
        expect(r).not.toBeNull()
        expect(r?.t ?? 1e9).toBeLessThan(200)
      }
    })
  }

  it('the harder bot is not slower over a lap', () => {
    let easy = 0
    let hard = 0
    for (let seed = 1; seed <= 3; seed++) {
      const e = race(seed, 'easy', 'easy', 1)
      const h = race(seed, 'hard', 'hard', 1)
      easy += e?.t ?? 999
      hard += h?.t ?? 999
    }
    expect(hard).toBeLessThanOrEqual(easy)
  })
})

describe('fair progress and drift boost', () => {
  /** A car parked on the centre line `arc` units from the start, heading along the road. */
  function onLine(tr: Track, arc: number): Car {
    const c = gridCar(tr, 0, 0)
    const i = sampleAt(tr, arc)
    const p = tr.pts[i] as Pt
    c.x = p.x
    c.y = p.y
    c.h = tr.hd[i] ?? 0
    c.arc = tr.cum[i] ?? 0
    c.dist = c.arc
    return c
  }

  it('cutting across the infield earns no progress', () => {
    const tr = trackFor(5)
    const c = onLine(tr, tr.len * 0.2)
    const before = c.dist
    // Jump to the far side of the loop in one step, as a cut across the grass would.
    const far = tr.pts[sampleAt(tr, tr.len * 0.45)] as Pt
    c.x = far.x
    c.y = far.y
    stepRace([c], tr, [NO_DRIVE, NO_DRIVE], STEP, 0, 1e9, 1e9, [])
    expect(Math.abs(c.dist - before)).toBeLessThan(1)
  })

  it('a lap is cheered once, even when the car backs over the line and crosses again', () => {
    const tr = trackFor(5)
    const c = onLine(tr, tr.len - 20)
    c.dist = tr.len - 20
    const ev: Ev[] = []
    const move = (arc: number) => {
      const p = tr.pts[sampleAt(tr, arc)] as Pt
      c.x = p.x
      c.y = p.y
      stepRace([c], tr, [NO_DRIVE, NO_DRIVE], STEP, 0, 1e9, 1e9, ev)
    }
    for (const a of [tr.len - 5, 10, 30, 10, tr.len - 10, 10, 30]) move(a)
    expect(ev.filter((e) => e.k === 'lap')).toHaveLength(1)
    expect(c.laps).toBe(1)
  })

  it('a slide charges a drift; straightening up pays out a boost past the top speed', () => {
    const tr = trackFor(2)
    const c = onLine(tr, 300)
    c.vx = Math.cos(c.h) * TOP
    c.vy = Math.sin(c.h) * TOP
    // Steer hard across the nose for a few frames: the car slides and charges.
    const across = c.h + Math.PI / 2
    for (let i = 0; i < 4; i++)
      stepRace(
        [c],
        tr,
        [{ jx: Math.cos(across), jy: Math.sin(across), m: 1, mul: 1 }, NO_DRIVE],
        STEP,
        i * STEP,
        0,
        1e9,
        [],
      )
    expect(c.charge).toBeGreaterThan(0)
    // Pretend the drift lasted long enough, then let go of the stick.
    c.charge = CHARGE_MIN + 0.5
    const ev: Ev[] = []
    stepRace([c], tr, [NO_DRIVE, NO_DRIVE], STEP, 1, 0, 1e9, ev)
    expect(ev.some((e) => e.k === 'boost')).toBe(true)
    expect(c.boost).toBeGreaterThan(0)
    let top = 0
    for (let i = 0; i < 40; i++) {
      stepRace([c], tr, [NO_DRIVE, NO_DRIVE], STEP, 1 + i * STEP, 0, 1e9, [])
      top = Math.max(top, Math.hypot(c.vx, c.vy))
    }
    expect(top).toBeGreaterThan(TOP)
  })

  it('a short wiggle pays nothing', () => {
    const tr = trackFor(2)
    const c = onLine(tr, 300)
    c.charge = CHARGE_MIN / 2
    const ev: Ev[] = []
    stepRace([c], tr, [NO_DRIVE, NO_DRIVE], STEP, 1, 0, 1e9, ev)
    expect(c.boost).toBe(0)
    expect(c.charge).toBe(0)
  })

  it('hard beats easy head to head', () => {
    let hard = 0
    for (let seed = 1; seed <= 4; seed++) {
      const r = race(seed, seed % 2 ? 'hard' : 'easy', seed % 2 ? 'easy' : 'hard', 2)
      if (r && r.side === (seed % 2 ? 0 : 1)) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(3)
  })
})
