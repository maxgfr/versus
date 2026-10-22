import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { PiranhaBot } from './bot.ts'
import {
  atFar,
  atHome,
  BITE_R,
  type Ev,
  fishAt,
  HOME,
  inRiver,
  leaderAt,
  newWorld,
  RIVER_BOT,
  RIVER_TOP,
  type School,
  schoolsFor,
  SPEED,
  STUN,
  stepWorld,
  surge,
  DASH_BOOST,
  DASH_COOL,
  winnerOf,
  type World,
} from './rules.ts'

const STEP = 1 / 60
const NONE: [null, null] = [null, null]

/** One lazy school far away from the swimmers' columns, so tests control the water. */
function quietWorld(): World {
  const far: School = { y: 800, wiggle: 0, speed: 200, offset: 0, pause: 1e6 }
  // A school waiting off the table for ever: no fish at all.
  return newWorld([far])
}

function run(
  w: World,
  seconds: number,
  drives: [{ x: number; y: number } | null, { x: number; y: number } | null] = [null, null],
): Ev[] {
  const ev: Ev[] = []
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepWorld(w, STEP, drives, ev)
  return ev
}

describe('schools', () => {
  it('a school sweeps across the table, then waits off it', () => {
    const sc: School = { y: 900, wiggle: 0, speed: 200, offset: 0, pause: 2 }
    const first = leaderAt(sc, 0)
    expect(first).not.toBeNull()
    expect(first?.dir).toBe(1)
    const mid = leaderAt(sc, 3)
    expect(mid?.x).toBeGreaterThan(0)
    expect(mid?.x).toBeLessThan(1000)
  })

  it('schools are seeded: the same seed gives the same river', () => {
    expect(schoolsFor(new Rng(4))).toEqual(schoolsFor(new Rng(4)))
    expect(schoolsFor(new Rng(4))).not.toEqual(schoolsFor(new Rng(5)))
  })

  it('every piranha of a school trails its leader', () => {
    const sc: School = { y: 900, wiggle: 0, speed: 200, offset: 0, pause: 2 }
    const fish = fishAt([sc], 1)
    expect(fish.length).toBe(3)
    expect(fish[1]?.x).toBeLessThan(fish[0]?.x ?? 0)
  })
})

describe('crossing', () => {
  it('reaching the far bank and returning home counts one crossing', () => {
    const w = quietWorld()
    const ev: Ev[] = []
    // Red swims up to the far bank (y < 700), then back down to its own bank (y > 1100).
    w.swim[0].y = 1000
    w.swim[0].x = 500
    for (let i = 0; i < 60 * 8; i++) {
      const y = w.swim[0].y
      const drive = y > 600 && w.swim[0].phase === 0 ? { x: 0, y: -1 } : { x: 0, y: 1 }
      stepWorld(w, STEP, [drive, null], ev)
    }
    expect(ev.some((e) => e.k === 'far' && e.side === 0)).toBe(true)
    expect(ev.some((e) => e.k === 'cross' && e.side === 0)).toBe(true)
    expect(w.swim[0].crossings).toBe(1)
  })

  it('touching the far bank alone is not yet a crossing', () => {
    const w = quietWorld()
    w.swim[0].y = RIVER_TOP - 10
    w.swim[0].x = 500
    const ev = run(w, 0.1)
    expect(ev.some((e) => e.k === 'far')).toBe(true)
    expect(w.swim[0].crossings).toBe(0)
    expect(w.swim[0].phase).toBe(1)
  })

  it('the far-bank and home tests are per side', () => {
    expect(atFar(0, RIVER_TOP - 1)).toBe(true)
    expect(atFar(1, RIVER_BOT + 1)).toBe(true)
    expect(atHome(0, RIVER_BOT + 1)).toBe(true)
    expect(atHome(1, RIVER_TOP - 1)).toBe(true)
    expect(inRiver(900)).toBe(true)
    expect(inRiver(RIVER_TOP)).toBe(false)
  })

  it('a stick only moves the swimmer as far as it can in one step', () => {
    const w = quietWorld()
    // Eased in (no flick): plain swimming speed.
    w.swim[0].mag = 0.95
    w.swim[0].lowAt = -5
    const y0 = w.swim[0].y
    stepWorld(w, STEP, [{ x: 0, y: -1 }, null], [])
    expect(Math.abs(w.swim[0].y - y0)).toBeLessThanOrEqual(SPEED * STEP + 1e-9)
  })

  it('a flick from rest is a stroke: a surge that fades, once per flick, after a cooldown', () => {
    const w = quietWorld()
    const ev: Ev[] = []
    stepWorld(w, STEP, [{ x: 0, y: 0 }, null], ev)
    const y0 = w.swim[0].y
    stepWorld(w, STEP, [{ x: 0, y: -1 }, null], ev)
    expect(ev.filter((e) => e.k === 'dash')).toHaveLength(1)
    expect(y0 - w.swim[0].y).toBeGreaterThan(SPEED * STEP * 1.5)
    expect(y0 - w.swim[0].y).toBeLessThanOrEqual(SPEED * (1 + DASH_BOOST) * STEP + 1e-9)
    // Holding the stick down does not stroke again, and the surge fades.
    for (let i = 0; i < 60; i++) stepWorld(w, STEP, [{ x: 0, y: -1 }, null], ev)
    expect(ev.filter((e) => e.k === 'dash')).toHaveLength(1)
    expect(surge(w.swim[0], w.t)).toBe(1)
    // Let go and flick again: a second stroke once the cooldown is over.
    stepWorld(w, STEP, [{ x: 0, y: 0 }, null], ev)
    stepWorld(w, STEP, [{ x: 0, y: -1 }, null], ev)
    expect(ev.filter((e) => e.k === 'dash')).toHaveLength(w.t >= DASH_COOL ? 2 : 1)
  })

  it('a slow push from rest is not a stroke', () => {
    const w = quietWorld()
    const ev: Ev[] = []
    for (let i = 0; i <= 20; i++) stepWorld(w, STEP, [{ x: 0, y: -i / 20 }, null], ev)
    expect(ev.some((e) => e.k === 'dash')).toBe(false)
  })
})

describe('bites', () => {
  it('a piranha in the water sends the swimmer back to their bank and stuns them', () => {
    // Offset so the school is mid-table at the start (leader near x = 500).
    const sc: School = { y: 900, wiggle: 0, speed: 200, offset: 3.2, pause: 1e6 }
    const w = newWorld([sc])
    // Put red right on top of the first piranha.
    const fish = fishAt([sc], 0)[0]
    expect(fish).toBeDefined()
    w.swim[0].x = fish?.x ?? 500
    w.swim[0].y = fish?.y ?? 900
    w.swim[0].phase = 1
    const ev: Ev[] = []
    stepWorld(w, STEP, NONE, ev)
    expect(ev.some((e) => e.k === 'bite' && e.side === 0)).toBe(true)
    expect(w.swim[0].bites).toBe(1)
    expect(w.swim[0].x).toBe(HOME[0]?.x)
    expect(w.swim[0].y).toBe(HOME[0]?.y)
    expect(w.swim[0].phase).toBe(0)
    // Stunned: no movement and no more bites until it wears off.
    const y = w.swim[0].y
    run(w, STUN / 2, [{ x: 0, y: -1 }, null])
    expect(w.swim[0].y).toBe(y)
    run(w, STUN, [{ x: 0, y: -1 }, null])
    expect(w.swim[0].y).toBeLessThan(y)
  })

  it('a bite lands only when the piranha is close enough', () => {
    const sc: School = { y: 900, wiggle: 0, speed: 200, offset: 3.2, pause: 1e6 }
    const w = newWorld([sc])
    const fish = fishAt([sc], 0)[0]
    w.swim[0].x = (fish?.x ?? 0) + BITE_R + 30
    w.swim[0].y = fish?.y ?? 900
    const ev = run(w, 0.02)
    expect(ev.some((e) => e.k === 'bite')).toBe(false)
  })
})

describe('the result', () => {
  it('most crossings wins, equal is a draw', () => {
    const w = quietWorld()
    w.swim[0].crossings = 4
    w.swim[1].crossings = 2
    expect(winnerOf(w)).toBe(0)
    w.swim[1].crossings = 4
    expect(winnerOf(w)).toBe('draw')
  })
})

describe('pace', () => {
  it('two quicker schools join late, entering from off the table', () => {
    const schools = schoolsFor(new Rng(4), 60)
    const late = schools.filter((sc) => sc.from !== undefined)
    expect(late.map((sc) => sc.from)).toEqual([24, 42])
    for (const sc of late) {
      const from = sc.from ?? 0
      expect(fishAt([sc], from - 0.5)).toHaveLength(0)
      // At its start time the leader is just off the left edge, sweeping in.
      const lead = leaderAt(sc, from)
      expect(lead?.x).toBeLessThan(0)
    }
    // The late schools sweep in: some of their fish are on the table soon after joining.
    const seen = (sc: (typeof late)[number]) =>
      Array.from({ length: 40 }, (_, i) => fishAt([sc], (sc.from ?? 0) + i * 0.1).length).some(
        (n) => n > 0,
      )
    expect(late.every(seen)).toBe(true)
  })
})

describe('bot', () => {
  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d} bots cross the river in a 60 s game`, () => {
      let crossings = 0
      for (let seed = 1; seed <= 3; seed++) {
        const rng = new Rng(seed)
        const w = newWorld(schoolsFor(rng))
        const bots = [new PiranhaBot(new Rng(seed + 1), d), new PiranhaBot(new Rng(seed + 2), d)]
        const ev: Ev[] = []
        while (w.t < 60) {
          const a = bots[0]?.drive(w, 0, STEP) ?? { x: 0, y: 0 }
          const b = bots[1]?.drive(w, 1, STEP) ?? { x: 0, y: 0 }
          stepWorld(w, STEP, [a, b], ev)
        }
        crossings += w.swim[0].crossings + w.swim[1].crossings
      }
      expect(crossings).toBeGreaterThan(0)
    })
  }

  it('hard crosses more than normal, normal more than easy', () => {
    const count = (d: 'easy' | 'normal' | 'hard') => {
      let n = 0
      for (let seed = 1; seed <= 4; seed++) {
        const w = newWorld(schoolsFor(new Rng(seed), 60))
        const bot = new PiranhaBot(new Rng(seed), d)
        while (w.t < 60) stepWorld(w, STEP, [bot.drive(w, 0, STEP), null], [])
        n += w.swim[0].crossings
      }
      return n
    }
    const [easy, normal, hard] = [count('easy'), count('normal'), count('hard')]
    expect(hard).toBeGreaterThan(normal)
    expect(normal).toBeGreaterThan(easy)
  })
})
