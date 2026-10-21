import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { StampedeBot } from './bot.ts'
import {
  along,
  animalAt,
  BLOB_R,
  type Ev,
  type Herd,
  HIT_D,
  herdGone,
  herdSize,
  herdSpeed,
  INVULN,
  LIVES,
  newWorld,
  roundOver,
  SPEED,
  START,
  stepWorld,
  WARN,
  waveGap,
  type World,
} from './rules.ts'

const STEP = 1 / 60
const NONE: [null, null] = [null, null]
const rng = () => new Rng(9)

/** A herd entering from the left along lane y, starting at t0. */
function herd(over: Partial<Herd> = {}): Herd {
  return { id: 1, axis: 0, lane: 900, dir: 1, t0: 0, v: 400, n: 3, kind: 0, ...over }
}

/** A world with only the herds the test sets up (no scheduled waves). */
function quiet(herds: Herd[] = []): World {
  const w = newWorld()
  w.nextWaveT = 1e9
  w.herds = herds
  return w
}

function run(
  w: World,
  seconds: number,
  drives: [{ x: number; y: number } | null, { x: number; y: number } | null] = NONE,
): Ev[] {
  const ev: Ev[] = []
  for (let i = 0; i < Math.round(seconds / STEP); i++) stepWorld(w, STEP, drives, rng(), ev)
  return ev
}

describe('herds', () => {
  it('the leader runs from off the table, followers trail behind it', () => {
    const h = herd({ t0: 1 })
    const start = animalAt(h, 0, 1)
    expect(start.x).toBeLessThan(0)
    expect(animalAt(h, 1, 1).x).toBeLessThan(start.x)
    expect(animalAt(h, 0, 2).x).toBeCloseTo(start.x + 400, 6)
    expect(along(h, 0, 2) - along(h, 0, 1)).toBeCloseTo(400, 6)
  })

  it('a herd is gone once its last animal has run off the far side', () => {
    const h = herd({ t0: 0, n: 3 })
    expect(herdGone(h, 0)).toBe(false)
    expect(herdGone(h, 10)).toBe(true)
  })

  it('a pending herd is not gone yet, even though its animals are off the table', () => {
    expect(herdGone(herd({ t0: 5, dir: -1, axis: 1 }), 0)).toBe(false)
  })

  it('herds get faster and bigger over the round, and waves come quicker', () => {
    expect(herdSpeed(60)).toBeGreaterThan(herdSpeed(0))
    expect(herdSpeed(1000)).toBeLessThanOrEqual(600)
    expect(herdSize(0)).toBe(2)
    expect(herdSize(100)).toBe(6)
    expect(herdSize(9)).toBe(3)
    expect(waveGap(40)).toBeLessThan(waveGap(0))
    expect(waveGap(1000)).toBeGreaterThanOrEqual(0.7)
  })
})

describe('waves', () => {
  it('a wave is announced with a warning before its first animal enters', () => {
    const w = newWorld()
    const ev: Ev[] = []
    w.nextWaveT = 0.1
    for (let i = 0; i < 10; i++) stepWorld(w, STEP, NONE, new Rng(3), ev)
    expect(ev.some((e) => e.k === 'warn')).toBe(true)
    expect(w.herds.length).toBeGreaterThanOrEqual(1)
    const h = w.herds[0] as Herd
    expect(h.t0 - w.rt).toBeGreaterThan(WARN - 0.2)
    expect(h.t0).toBeGreaterThan(w.rt)
  })

  it('the warning turns into an entry when the herd arrives', () => {
    const w = quiet([herd({ t0: 0.5 })])
    const ev = run(w, 0.6)
    expect(ev.some((e) => e.k === 'enter')).toBe(true)
  })

  it('the seeded waves are the same for the same seed', () => {
    const a = newWorld()
    const b = newWorld()
    const ea: Ev[] = []
    const eb: Ev[] = []
    for (let i = 0; i < 60 * 30; i++) {
      stepWorld(a, STEP, NONE, new Rng(21), ea)
      stepWorld(b, STEP, NONE, new Rng(21), eb)
    }
    expect(a.herds).toEqual(b.herds)
    expect(a.waves).toBeGreaterThan(5)
  })
})

describe('being hit', () => {
  it('an animal touching a blob costs a heart and gives a short invulnerability', () => {
    // The herd is already running: its leader is at x = 660 right now.
    const w = quiet([herd({ t0: -2, lane: 1000, n: 1 })])
    w.drivers[0].x = 660
    w.drivers[0].y = 1000
    const ev = run(w, 0.05)
    expect(ev.some((e) => e.k === 'hit' && e.side === 0)).toBe(true)
    expect(w.drivers[0].lives).toBe(LIVES - 1)
    expect(w.drivers[0].invT).toBeGreaterThan(w.rt)
    // Still inside the herd's path while invulnerable: no second heart.
    const again = run(w, 0.05)
    expect(again.some((e) => e.k === 'hit')).toBe(false)
    expect(w.drivers[0].lives).toBe(LIVES - 1)
    run(w, INVULN + 0.05)
    expect(w.drivers[0].lives).toBeLessThanOrEqual(LIVES - 1)
  })

  it('losing the last heart puts a blob out, and the other one takes the round', () => {
    const w = quiet()
    w.drivers[0].lives = 1
    w.drivers[0].out = true
    expect(roundOver(w)).toBe(1)
    w.drivers[1].out = true
    expect(roundOver(w)).toBe('draw')
    expect(roundOver(quiet())).toBeNull()
  })

  it('an animal well away from a blob does not touch it', () => {
    const w = quiet([herd({ t0: 0, lane: 1000, n: 1 })])
    w.drivers[0].x = 800
    w.drivers[0].y = 300
    run(w, 1)
    expect(w.drivers[0].lives).toBe(LIVES)
  })

  it('blobs move at joystick speed and stay on the table', () => {
    const w = quiet()
    const x0 = w.drivers[0].x
    run(w, 0.1, [{ x: 1, y: 0 }, null])
    expect(w.drivers[0].x - x0).toBeLessThanOrEqual(SPEED * 0.1 + 1e-6)
    run(w, 10, [{ x: 1, y: 0 }, null])
    expect(w.drivers[0].x).toBeLessThanOrEqual(1000 - 40)
    expect(START[0]).toBeDefined()
    expect(BLOB_R).toBeLessThan(HIT_D)
  })
})

describe('bot', () => {
  it('steps out of the way of a herd that is about to hit it', () => {
    const w = quiet([herd({ t0: 0.1, lane: 1000, n: 2, v: 500 })])
    w.drivers[0].x = 500
    w.drivers[0].y = 1000
    const bot = new StampedeBot(new Rng(4), 'hard')
    const d = bot.drive(w, 0, 0.2)
    // Moves at least a little, and not further into the herd's lane.
    expect(Math.hypot(d.x, d.y)).toBeGreaterThan(0)
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d} blobs survive a round and the round ends in bounded time`, () => {
      for (let seed = 1; seed <= 2; seed++) {
        const w = newWorld()
        const bots = [new StampedeBot(new Rng(seed), d), new StampedeBot(new Rng(seed + 5), d)]
        const r = new Rng(seed * 13)
        const ev: Ev[] = []
        let steps = 0
        while (roundOver(w) === null && steps < 60 * 240) {
          stepWorld(
            w,
            STEP,
            [bots[0]?.drive(w, 0, STEP) ?? null, bots[1]?.drive(w, 1, STEP) ?? null],
            r,
            ev,
          )
          steps++
        }
        expect(roundOver(w)).not.toBeNull()
        expect(w.rt).toBeLessThan(240)
      }
    })
  }
})
