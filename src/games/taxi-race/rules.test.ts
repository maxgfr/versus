import { describe, expect, it } from 'vitest'
import { reachable, solidCell } from '../../engines/arena/index.ts'
import { Rng } from '../../core/rng.ts'
import { TaxiBot } from './bot.ts'
import {
  cornersOf,
  type Ev,
  type Fare,
  fareValue,
  gridOf,
  MAPS,
  MIN_STEPS,
  newWorld,
  type Pt,
  RUSH_WAITING,
  rushing,
  stepWorld,
  stepsBetween,
  winnerOf,
  type World,
} from './rules.ts'

const STEP = 1 / 60
const NONE: [Pt | null, Pt | null] = [null, null]

/** Put a waiting fare on a corner away from both taxis, flagged at a corner far enough away. */
function addFare(w: World, value = 40): Fare {
  const g = gridOf(w.map)
  const corners = cornersOf(g)
  const far = (p: Pt) => w.taxis.every((t) => Math.hypot(t.x - p.x, t.y - p.y) > 200)
  const from = corners.find(far) as Pt
  const to = corners.find((c) => far(c) && stepsBetween(g, from, c) >= MIN_STEPS) as Pt
  const f: Fare = {
    id: w.nextId++,
    fx: from.x,
    fy: from.y,
    tx: to.x,
    ty: to.y,
    value,
    carried: -1,
  }
  w.fares.push(f)
  return f
}

function move(w: World, side: 0 | 1, x: number, y: number): void {
  w.taxis[side].x = x
  w.taxis[side].y = y
}

describe('city maps', () => {
  it('are point-symmetric, fully connected and have both taxi starts', () => {
    for (const rows of MAPS) {
      const g = gridOf(MAPS.indexOf(rows))
      let floor = 0
      for (let r = 0; r < g.rows; r++)
        for (let c = 0; c < g.cols; c++) {
          expect(solidCell(g, c, r)).toBe(solidCell(g, g.cols - 1 - c, g.rows - 1 - r))
          if (!solidCell(g, c, r)) floor++
        }
      expect(g.spawns.R).toBeDefined()
      expect(g.spawns.B).toBeDefined()
      const R = g.spawns.R as { x: number; y: number }
      expect(reachable(g, Math.floor(R.x / 100), Math.floor((R.y - 300) / 100))).toBe(floor)
    }
  })

  it('has plenty of corners to put passengers on, but not every street cell', () => {
    for (let m = 0; m < MAPS.length; m++) {
      const g = gridOf(m)
      let floor = 0
      for (let r = 0; r < g.rows; r++)
        for (let c = 0; c < g.cols; c++) if (!solidCell(g, c, r)) floor++
      const corners = cornersOf(g).length
      expect(corners).toBeGreaterThan(8)
      expect(corners).toBeLessThan(floor)
    }
  })

  it('fares pay for distance', () => {
    expect(fareValue(4)).toBeLessThan(fareValue(8))
    expect(fareValue(4)).toBe(40)
  })
})

describe('driving', () => {
  it('a joystick moves a taxi at its speed, and buildings stop it', () => {
    const w = newWorld(0)
    const t = w.taxis[0]
    const start = { x: t.x, y: t.y }
    stepWorld(w, STEP, [{ x: 1, y: 0 }, null], new Rng(1), [])
    expect(t.x - start.x).toBeGreaterThan(0)
    expect(Math.abs(t.x - start.x)).toBeLessThanOrEqual(300 * STEP + 1e-6)
    // Drive straight into the top-left building block, then keep pushing: it must not get inside.
    move(w, 0, 150, 350)
    for (let i = 0; i < 300; i++) stepWorld(w, STEP, [{ x: 0, y: 1 }, null], new Rng(2), [])
    const g = gridOf(w.map)
    const c = Math.floor((w.taxis[0].x - g.x0) / g.cell)
    const r = Math.floor((w.taxis[0].y - g.y0) / g.cell)
    expect(solidCell(g, c, r)).toBe(false)
  })
})

describe('passengers', () => {
  it('a taxi that reaches a waiting passenger picks them up', () => {
    const w = newWorld(0)
    const f = addFare(w)
    move(w, 0, f.fx, f.fy)
    const ev: Ev[] = []
    stepWorld(w, STEP, NONE, new Rng(1), ev)
    expect(ev.some((e) => e.k === 'pick' && e.side === 0)).toBe(true)
    expect(w.taxis[0].carry).toBe(f.id)
    expect(f.carried).toBe(0)
  })

  it('delivering to the flag pays the fare and counts it', () => {
    const w = newWorld(0)
    const f = addFare(w, 60)
    f.carried = 1
    w.taxis[1].carry = f.id
    move(w, 1, f.tx, f.ty)
    const ev: Ev[] = []
    stepWorld(w, STEP, NONE, new Rng(1), ev)
    expect(ev.some((e) => e.k === 'deliver' && e.side === 1 && e.value === 60)).toBe(true)
    expect(w.taxis[1].fares).toBe(1)
    expect(w.taxis[1].points).toBe(60)
    expect(w.taxis[1].carry).toBe(-1)
    expect(w.fares.some((x) => x.id === f.id)).toBe(false)
  })

  it('a taxi carries one passenger at a time', () => {
    const w = newWorld(0)
    const first = addFare(w)
    const second = addFare(w)
    w.taxis[0].carry = 999
    move(w, 0, first.fx, first.fy)
    stepWorld(w, STEP, NONE, new Rng(1), [])
    expect(second.carried).toBe(-1)
    expect(first.carried).toBe(-1)
  })

  it('a rival who bumps a carrier at speed makes them drop the passenger, with a pause', () => {
    const w = newWorld(0)
    const f = addFare(w, 50)
    f.carried = 0
    w.taxis[0].carry = f.id
    // Red carries; blue rams into red along the top street.
    move(w, 0, 450, 350)
    move(w, 1, 300, 350)
    const ev: Ev[] = []
    for (let i = 0; i < 60 && !ev.some((e) => e.k === 'drop'); i++)
      stepWorld(w, STEP, [null, { x: 1, y: 0 }], new Rng(3), ev)
    expect(ev.some((e) => e.k === 'bump')).toBe(true)
    expect(ev.some((e) => e.k === 'drop' && e.side === 0)).toBe(true)
    expect(w.taxis[0].carry).toBe(-1)
    // The passenger is back on a corner: waiting, or snapped up by the bumper (never by the dropper).
    expect(f.carried).not.toBe(0)
    expect(w.taxis[0].calmT).toBeGreaterThan(w.t)
  })

  it('a bumped taxi cannot pick up again straight away', () => {
    const w = newWorld(0)
    const f = addFare(w)
    w.taxis[0].calmT = w.t + 1.5
    move(w, 0, f.fx, f.fy)
    stepWorld(w, STEP, NONE, new Rng(1), [])
    expect(f.carried).toBe(-1)
    for (let i = 0; i < 100; i++) stepWorld(w, STEP, NONE, new Rng(1), [])
    stepWorld(w, STEP, NONE, new Rng(1), [])
    expect(f.carried).toBe(0)
  })

  it('passengers keep coming, up to the cap on the map', () => {
    const w = newWorld(1)
    const rng = new Rng(5)
    for (let i = 0; i < 60 * 40; i++) stepWorld(w, STEP, NONE, rng, [])
    const waiting = w.fares.filter((f) => f.carried < 0).length
    expect(waiting).toBeGreaterThan(0)
    expect(waiting).toBeLessThanOrEqual(3)
  })
})

describe('the result', () => {
  it('most fares wins, points break a tie, equal both is a draw', () => {
    const w = newWorld(0)
    w.taxis[0].fares = 3
    w.taxis[1].fares = 2
    expect(winnerOf(w)).toBe(0)
    w.taxis[1].fares = 3
    w.taxis[1].points = 10
    expect(winnerOf(w)).toBe(1)
    w.taxis[0].points = 10
    expect(winnerOf(w)).toBe('draw')
  })
})

describe('bot', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d} bots both deliver passengers in a 60 s city`, () => {
      for (let seed = 1; seed <= 2; seed++) {
        const w = newWorld(seed % MAPS.length)
        const g = gridOf(w.map)
        const bots = [new TaxiBot(new Rng(seed), d), new TaxiBot(new Rng(seed + 9), d)]
        const rng = new Rng(seed * 7)
        const ev: Ev[] = []
        while (w.t < 60) {
          const drives: [Pt, Pt] = [
            bots[0]?.drive(w, g, 0, STEP) ?? { x: 0, y: 0 },
            bots[1]?.drive(w, g, 1, STEP) ?? { x: 0, y: 0 },
          ]
          stepWorld(w, STEP, drives, rng, ev)
        }
        expect(w.taxis[0].fares + w.taxis[1].fares).toBeGreaterThan(0)
        expect(ev.some((e) => e.k === 'pick')).toBe(true)
      }
    })
  }

  it('the hard bot beats normal and easy head to head over seeded cities', () => {
    for (const weak of ['easy', 'normal'] as const) {
      let wins = 0
      for (let seed = 1; seed <= 6; seed++) {
        const hs = seed % 2 ? 0 : 1
        const w = newWorld(seed % MAPS.length, 60)
        const g = gridOf(w.map)
        const bots = [
          new TaxiBot(new Rng(seed), hs === 0 ? 'hard' : weak),
          new TaxiBot(new Rng(seed + 9), hs === 1 ? 'hard' : weak),
        ]
        const rng = new Rng(seed * 3)
        while (w.t < 60) {
          const drives: [Pt, Pt] = [
            bots[0]?.drive(w, g, 0, STEP) ?? { x: 0, y: 0 },
            bots[1]?.drive(w, g, 1, STEP) ?? { x: 0, y: 0 },
          ]
          stepWorld(w, STEP, drives, rng, [])
        }
        if (winnerOf(w) === hs) wins++
      }
      expect(wins).toBeGreaterThanOrEqual(weak === 'easy' ? 5 : 4)
    }
  })

  it('the hard bot earns more fares than the easy one', () => {
    const run = (d: 'easy' | 'hard') => {
      let total = 0
      for (let seed = 1; seed <= 3; seed++) {
        const w = newWorld(seed % MAPS.length)
        const g = gridOf(w.map)
        const bot = new TaxiBot(new Rng(seed), d)
        const rng = new Rng(seed)
        while (w.t < 60) stepWorld(w, STEP, [bot.drive(w, g, 0, STEP), null], rng, [])
        total += w.taxis[0].fares
      }
      return total
    }
    expect(run('hard')).toBeGreaterThanOrEqual(run('easy'))
  })
})

describe('rush hour and drops', () => {
  it('the last stretch is rush hour: more passengers wait and fares pay more', () => {
    const w = newWorld(1, 60)
    const rng = new Rng(8)
    const ev: Ev[] = []
    for (let i = 0; i < 60 * 41; i++) stepWorld(w, STEP, NONE, rng, ev)
    expect(rushing(w)).toBe(false)
    for (let i = 0; i < 60 * 19; i++) stepWorld(w, STEP, NONE, rng, ev)
    expect(rushing(w)).toBe(true)
    expect(ev.filter((e) => e.k === 'rush')).toHaveLength(1)
    const waiting = w.fares.filter((f) => f.carried < 0)
    expect(waiting.length).toBeGreaterThan(3)
    expect(waiting.length).toBeLessThanOrEqual(RUSH_WAITING)
    const g = gridOf(w.map)
    const late = waiting[waiting.length - 1] as Fare
    const steps = stepsBetween(g, { x: late.fx, y: late.fy }, { x: late.tx, y: late.ty })
    expect(late.value).toBeGreaterThan(fareValue(steps))
  })

  it('a dropped passenger never lands on its own flag', () => {
    const w = newWorld(0)
    const f = addFare(w, 50)
    f.carried = 0
    w.taxis[0].carry = f.id
    // Red is parked right at the flag when blue rams it.
    move(w, 0, f.tx, f.ty)
    move(w, 1, f.tx - 60, f.ty)
    const ev: Ev[] = []
    stepWorld(w, STEP, [null, { x: 1, y: 0 }], new Rng(3), ev)
    expect(ev.some((e) => e.k === 'drop')).toBe(true)
    expect(Math.hypot(f.fx - f.tx, f.fy - f.ty)).toBeGreaterThan(56)
  })
})
