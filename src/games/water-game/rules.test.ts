import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choosePumps, PULSE, push, thinkEvery } from './bot.ts'
import {
  BLAST,
  BUTTON,
  dropX,
  DROP_EVERY,
  FIRST_DROP,
  landedOf,
  LIMIT,
  NOZZLES,
  newTank,
  PEG_R,
  PEGS,
  RING_R,
  RING_STEP,
  RINGS,
  resting,
  REST_Y,
  ringWinner,
  SAND_Y,
  seatY,
  stepTank,
  TANK,
  type Tank,
  tankWinner,
  TIP,
} from './rules.ts'

const DT = 1 / 60

/** A tank with no more rings to release, so only the ring under test is in play. */
function quiet(seed = 1): Tank {
  const t = newTank(seed)
  t.released = RINGS
  return t
}

function drop(t: Tank, x: number, y: number, vy = 0): number {
  const id = t.nextId++
  t.rings.push({ id, x, y, vx: 0, vy })
  return id
}

/** Run `seconds` of game time with the given pumps; returns every event. */
function run(
  t: Tank,
  seconds: number,
  pump: [boolean, boolean] = [false, false],
  start = 0,
): ReturnType<typeof stepTank> {
  const rng = new Rng(9)
  const out: ReturnType<typeof stepTank> = []
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) out.push(...stepTank(t, DT, start + i * DT, pump, rng))
  return out
}

describe('water game rules', () => {
  it('starts a tank with no rings on the pegs and the first ring rolled', () => {
    const t = newTank(4)
    expect(t.released).toBe(0)
    expect(t.pegs).toEqual([0, 0])
    expect(t.nextAt).toBe(FIRST_DROP)
    expect(t.nextX).toBeGreaterThanOrEqual(320)
    expect(t.nextX).toBeLessThanOrEqual(680)
    expect(landedOf(t)).toBe(0)
  })

  it('releases one ring at a time, every DROP_EVERY seconds, until all are out', () => {
    const t = newTank(2)
    const drops = run(t, FIRST_DROP + DROP_EVERY * RINGS + 1).filter((e) => e.k === 'drop')
    expect(drops).toHaveLength(RINGS)
    expect(t.released).toBe(RINGS)
    // Nothing else comes out afterwards.
    expect(run(t, 5).filter((e) => e.k === 'drop')).toHaveLength(0)
  })

  it('lands a ring that falls straight onto a peg', () => {
    const t = quiet()
    drop(t, PEGS[0], TIP - 200)
    const ev = run(t, 6)
    expect(t.pegs).toEqual([1, 0])
    expect(t.stacks[0]).toHaveLength(1)
    const land = ev.find((e) => e.k === 'land')
    expect(land).toMatchObject({ k: 'land', peg: 0, n: 1 })
    expect(t.rings).toHaveLength(0)
  })

  it('stacks the next ring on top of the first one, from the sand up', () => {
    const t = quiet()
    drop(t, PEGS[1], TIP - 200)
    run(t, 6)
    drop(t, PEGS[1], TIP - 200)
    run(t, 6, [false, false], 6)
    expect(t.pegs).toEqual([0, 2])
    expect(t.stacks[1]).toEqual([1, 2])
    expect(landedOf(t)).toBe(2)
    expect(t.landAt[1]).toBeGreaterThan(6)
    // The second ring sits one ring-step above the first, and a full peg still fits under the tip.
    expect(seatY(0) - seatY(1)).toBe(RING_STEP)
    expect(seatY(RINGS - 1)).toBeGreaterThan(TIP)
    expect(seatY(0)).toBeLessThan(SAND_Y)
  })

  it('a ring that misses every peg settles on the sand and rolls into a nozzle well', () => {
    const t = quiet()
    drop(t, 470, TANK.surface + RING_R)
    const ev = run(t, 14)
    expect(t.missed).toBe(1)
    expect(ev.some((e) => e.k === 'miss')).toBe(true)
    // It stays in play, lying over the nearer nozzle, ready to be blown up again.
    expect(t.rings).toHaveLength(1)
    const r = t.rings[0]!
    expect(resting(r)).toBe(true)
    expect(r.y).toBeCloseTo(REST_Y)
    expect(Math.abs(r.x - NOZZLES[0])).toBeLessThan(4)
    expect(landedOf(t)).toBe(0)
  })

  it('a pump blows a ring off the sand again', () => {
    const t = quiet()
    drop(t, NOZZLES[1], REST_Y)
    run(t, 0.6, [false, true])
    expect(t.rings[0]!.y).toBeLessThan(REST_Y - 60)
  })

  it('rings on the sand queue beside a well instead of piling up', () => {
    const t = quiet()
    drop(t, NOZZLES[0] - 5, REST_Y)
    drop(t, NOZZLES[0] + 5, REST_Y)
    run(t, 3)
    const [a, b] = t.rings
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(RING_R * 1.5)
  })

  it('a ring resting on the sand under a peg does not thread it from below', () => {
    const t = quiet()
    drop(t, PEGS[0], REST_Y)
    run(t, 0.5)
    expect(landedOf(t)).toBe(0)
  })

  it('a ring beside a peg bounces off its rim instead of sliding through', () => {
    const t = quiet()
    // Just outside the catch band, dropping toward the peg's tip.
    drop(t, PEGS[0] + 40, TIP - 40, 60)
    run(t, 0.5)
    const r = t.rings[0]
    expect(r).toBeDefined()
    expect(Math.abs(r!.x - PEGS[0])).toBeGreaterThanOrEqual(RING_R + PEG_R - 0.01)
    expect(landedOf(t)).toBe(0)
  })

  it('a left pump blows rings toward the right, a right pump toward the left', () => {
    const left = quiet(3)
    drop(left, 420, 1300)
    run(left, 1.2, [true, false])
    expect(left.rings[0]!.x).toBeGreaterThan(420)

    const right = quiet(3)
    drop(right, 420, 1300)
    run(right, 1.2, [false, true])
    expect(right.rings[0]!.x).toBeLessThan(420)
  })

  it('bubbles lift a ring that would otherwise sink', () => {
    const idle = quiet(5)
    drop(idle, NOZZLES[0], 1350)
    run(idle, 1)
    const pumped = quiet(5)
    drop(pumped, NOZZLES[0], 1350)
    run(pumped, 1, [true, false])
    expect(pumped.rings[0]!.y).toBeLessThan(idle.rings[0]!.y - 40)
  })

  it('a ring cannot rise above the water surface', () => {
    const t = quiet()
    drop(t, 500, TANK.surface + RING_R + 20, -600)
    run(t, 0.2)
    expect(t.rings[0]!.y).toBeGreaterThan(TANK.surface)
  })

  it('rings stay inside the tank walls', () => {
    const t = quiet()
    drop(t, 500, 1200)
    t.rings[0]!.vx = 900
    run(t, 0.5)
    expect(t.rings[0]!.x).toBeLessThanOrEqual(TANK.x1 - RING_R + 0.01)
  })

  it('decides the match by landed rings, a tie being a draw', () => {
    expect(ringWinner(6, 3)).toBe(0)
    expect(ringWinner(2, 6)).toBe(1)
    expect(ringWinner(4, 4)).toBe('draw')
  })

  it('drops every ring at the same place for both players', () => {
    const a = newTank(77)
    const b = newTank(77)
    const xs = (t: Tank) =>
      run(t, FIRST_DROP + DROP_EVERY * RINGS + 1)
        .filter((e) => e.k === 'drop')
        .map((e) => e.x)
    expect(xs(a)).toEqual(xs(b))
    expect(new Set(xs(newTank(78))).size).toBeGreaterThan(1)
    expect(dropX(77, 2)).toBe(dropX(77, 2))
  })

  it('a fresh press blasts: pumping in strokes lifts a ring higher than holding', () => {
    const lift = (stroke: boolean): number => {
      const t = quiet()
      drop(t, NOZZLES[0], REST_Y)
      const rng = new Rng(3)
      // Mean height over the first second (the surface caps it).
      let sum = 0
      for (let i = 0; i < 60; i++) {
        const on = stroke ? i % 8 < 6 : true
        stepTank(t, DT, i * DT, [on, false], rng)
        sum += REST_Y - (t.rings[0]?.y ?? REST_Y)
      }
      return sum / 60
    }
    expect(lift(true)).toBeGreaterThan(lift(false))
    // The blast is a few big bubbles, not a flood.
    const t = quiet()
    stepTank(t, DT, 0, [true, false], new Rng(1))
    expect(t.bubbles.length).toBe(BLAST + 1)
  })

  it('a tie on rings at the whistle goes to whoever got there first', () => {
    const a = newTank(1)
    const b = newTank(1)
    a.pegs = [2, 1]
    b.pegs = [1, 2]
    a.landAt = [20, 31]
    b.landAt = [25, 28]
    expect(tankWinner(a, b)).toBe(1)
    b.landAt = [25, 40]
    expect(tankWinner(a, b)).toBe(0)
    b.landAt = [25, 31]
    expect(tankWinner(a, b)).toBe('draw')
    expect(tankWinner(newTank(1), newTank(1))).toBe('draw')
    b.pegs = [3, 1]
    expect(tankWinner(a, b)).toBe(1)
  })

  it('reads the default match length and bot skill for each level', () => {
    expect(LIMIT).toBeGreaterThan(0)
    expect(thinkEvery('easy')).toBeGreaterThan(thinkEvery('hard'))
  })
})

describe('water game bot', () => {
  it('rule of thumb: pushes a ring toward the nearer peg with the pump that blows that way', () => {
    const t = quiet()
    drop(t, 560, 1200)
    // Nearest peg is 660, to the right of the ring: the left pump blows right.
    expect(push(t, 0, new Rng(1))).toEqual([true, false])
    const u = quiet()
    drop(u, 440, 1200)
    expect(push(u, 0, new Rng(1))).toEqual([false, true])
  })

  it('rule of thumb: lets a ring drop when it is already over the peg', () => {
    const t = quiet()
    drop(t, PEGS[0] + 2, 1200)
    expect(push(t, 0, new Rng(1))).toEqual([false, false])
  })

  it('rule of thumb: with nothing in the water, blows a ring off the sand from its well', () => {
    const t = quiet()
    drop(t, NOZZLES[1], REST_Y)
    expect(push(t, 0, new Rng(1))).toEqual([false, true])
  })

  it('the planning computer blows a ring lying on the sand back up', () => {
    const t = quiet()
    drop(t, NOZZLES[1], REST_Y)
    expect(choosePumps(t, 'hard', new Rng(4))).not.toEqual([false, false])
  })

  it('plays either side: a tank is a tank, whichever colour it belongs to', () => {
    const red = quiet(8)
    const blue = quiet(8)
    drop(red, 560, 1200)
    drop(blue, 560, 1200)
    expect(choosePumps(red, 'normal', new Rng(2))).toEqual(choosePumps(blue, 'normal', new Rng(2)))
  })

  it('two computers play a whole match to a result within the time limit', () => {
    let finished = 0
    let landed = 0
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 1; seed <= 4; seed++) {
        const rng = new Rng(seed * 101)
        const tanks: [Tank, Tank] = [newTank(seed), newTank(seed)]
        const brng = [rng.fork(), rng.fork()] as const
        const trng = [rng.fork(), rng.fork()] as const
        const pumps: [[boolean, boolean], [boolean, boolean]] = [
          [false, false],
          [false, false],
        ]
        const next: [number, number] = [0, 0]
        let time = 0
        let done = false
        const steps = Math.round(LIMIT / DT)
        for (let i = 0; i < steps && !done; i++) {
          for (const s of [0, 1] as const) {
            if (time >= next[s]) {
              pumps[s] = choosePumps(tanks[s], d, brng[s], time)
              next[s] = time + thinkEvery(d)
            }
          }
          for (const s of [0, 1] as const) stepTank(tanks[s], DT, time, pumps[s], trng[s])
          time += DT
          done = landedOf(tanks[0]) >= RINGS || landedOf(tanks[1]) >= RINGS
        }
        finished++
        landed += landedOf(tanks[0]) + landedOf(tanks[1])
        expect(time).toBeLessThanOrEqual(LIMIT + DT)
      }
    }
    expect(finished).toBe(12)
    // The computers do land rings: a match is not a time-out with nothing scored.
    expect(landed).toBeGreaterThan(0)
  })
})

describe('water game levels', () => {
  /** A whole match, red at one level and blue at another, as the game drives it. */
  function duel(seed: number, red: 'easy' | 'normal' | 'hard', blue: typeof red): 0 | 1 | 'draw' {
    const levels = [red, blue] as const
    const rng = new Rng(seed * 101)
    const tanks: [Tank, Tank] = [newTank(seed), newTank(seed)]
    const brng = [rng.fork(), rng.fork()] as const
    const trng = [rng.fork(), rng.fork()] as const
    const plans: [[boolean, boolean], [boolean, boolean]] = [
      [false, false],
      [false, false],
    ]
    const next: [number, number] = [0, 0]
    let time = 0
    for (let i = 0; i < Math.round(LIMIT / DT); i++) {
      for (const s of [0, 1] as const) {
        const d = levels[s]
        if (time >= next[s]) {
          plans[s] = choosePumps(tanks[s], d, brng[s], time)
          next[s] = time + thinkEvery(d)
        }
        const pulse = PULSE[d]
        const on = pulse === 0 || i % pulse >= 2
        stepTank(tanks[s], DT, time, [plans[s][0] && on, plans[s][1] && on], trng[s])
      }
      time += DT
      if (landedOf(tanks[0]) >= RINGS || landedOf(tanks[1]) >= RINGS) break
    }
    const a = landedOf(tanks[0]) >= RINGS
    const b = landedOf(tanks[1]) >= RINGS
    if (a !== b) return a ? 0 : 1
    return tankWinner(tanks[0], tanks[1])
  }

  it('hard beats easy most matches, from either side', () => {
    let hard = 0
    for (let seed = 1; seed <= 4; seed++) {
      if (duel(seed, 'easy', 'hard') === 1) hard++
      if (duel(seed + 50, 'hard', 'easy') === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(7)
  })
})

describe('water game geometry', () => {
  it('keeps the pump buttons and nozzles inside their tank halves', () => {
    for (const x of BUTTON.x) expect(x).toBeGreaterThan(TANK.x0)
    for (const x of NOZZLES) expect(x).toBeLessThan(TANK.x1)
    expect(BUTTON.y).toBeGreaterThan(TANK.floor)
    expect(TIP).toBeGreaterThan(TANK.surface)
    expect(REST_Y).toBeLessThan(TANK.floor)
  })
})
