import { describe, expect, it } from 'vitest'
import type { Difficulty, Side } from '../../core/game.ts'
import { steer } from './bot.ts'
import {
  BASE_Y,
  BOUNCE,
  CRUMBLE,
  type Climber,
  CW,
  CENTRE_BONUS,
  fallDead,
  FOLLOW,
  GRAV,
  judge,
  metres,
  newClimber,
  OUT_BELOW,
  platformAt,
  platformsBetween,
  platX,
  PLAT_GAP,
  PLAT_W,
  ROUND_T,
  solidFor,
  stepClimber,
  wrapDelta,
  wrapX,
} from './rules.ts'

const DT = 1 / 60

/** First seed (from 1) whose platform `i` has the given kind. */
function seedWith(i: number, kind: string): number {
  for (let s = 1; s < 10_000; s++) if (platformAt(s, i).kind === kind) return s
  throw new Error('no seed')
}

/** A climber dropped onto platform `i` from just above it, at its centre. */
function dropOnto(seed: number, i: number, offset = 0): Climber {
  const p = platformAt(seed, i)
  const c = newClimber(p.x + offset)
  c.h = p.h + 120
  c.vh = -200
  c.cam = Math.max(0, p.h - 200)
  return c
}

describe('flappy jump course', () => {
  it('is a pure function of seed and index', () => {
    expect(platformAt(42, 9)).toEqual(platformAt(42, 9))
    expect(platformAt(42, 9)).not.toEqual(platformAt(43, 9))
  })

  it('starts on a solid platform at height 0', () => {
    for (let s = 1; s <= 10; s++) {
      const p = platformAt(s, 0)
      expect(p.h).toBe(0)
      expect(p.kind).toBe('solid')
    }
  })

  it('keeps platforms climbable: spaced and near each other sideways', () => {
    for (let s = 1; s <= 10; s++) {
      for (let i = 1; i < 80; i++) {
        const a = platformAt(s, i)
        const b = platformAt(s, i + 1)
        expect(b.h - a.h).toBeGreaterThan(0)
        expect(b.h - a.h).toBeLessThan(PLAT_GAP + 100)
        // Within reach of one bounce's sideways travel.
        expect(Math.abs(b.x - a.x)).toBeLessThan(330)
        expect(a.x).toBeGreaterThanOrEqual(180)
        expect(a.x).toBeLessThanOrEqual(820)
      }
    }
  })

  it('moving platforms sway around their centre; others stay put', () => {
    const s = seedWith(6, 'move')
    const p = platformAt(s, 6)
    expect(Math.abs(platX(p, 3) - p.x)).toBeLessThanOrEqual(p.amp + 1e-9)
    const still = platformAt(s, 1)
    expect(platX(still, 0)).toBe(platX(still, 9))
  })

  it('finds the platforms in a height band', () => {
    const s = 5
    const ps = platformsBetween(s, 500, 1000)
    expect(ps.length).toBeGreaterThan(0)
    for (const p of ps) {
      expect(p.h).toBeGreaterThanOrEqual(500)
      expect(p.h).toBeLessThanOrEqual(1000)
    }
  })

  it('wraps x and measures the short way round', () => {
    expect(wrapX(1010)).toBeCloseTo(10)
    expect(wrapX(-10)).toBeCloseTo(990)
    expect(wrapDelta(990, 10)).toBeCloseTo(-20)
    expect(wrapDelta(10, 990)).toBeCloseTo(20)
  })
})

describe('flappy jump climber', () => {
  it('bounces back up when it lands on a platform', () => {
    const s = seedWith(1, 'solid')
    const c = dropOnto(s, 1)
    const ev: string[] = []
    for (let t = DT; t < 3 && !ev.includes('bounce'); t += DT)
      ev.push(...stepClimber(s, c, DT, t, 0))
    expect(ev).toContain('bounce')
    expect(c.vh).toBeGreaterThan(0)
    expect(c.alive).toBe(true)
  })

  it('a dead-centre landing bounces higher than an edge landing', () => {
    const s = seedWith(1, 'solid')
    const p = platformAt(s, 1)
    const apex = (offset: number): number => {
      const c = dropOnto(s, 1, offset)
      for (let t = DT; t < 5; t += DT) {
        stepClimber(s, c, DT, t, 0)
        if (c.vh > 0 && c.h > p.h + 5) break
      }
      return c.vh
    }
    expect(apex(0)).toBeGreaterThan(apex(PLAT_W / 2 + CW - 5))
    expect(apex(0)).toBeLessThanOrEqual(BOUNCE * (1 + CENTRE_BONUS) + 1e-6)
  })

  it('misses a platform it passes beside', () => {
    const s = seedWith(1, 'solid')
    const c = dropOnto(s, 1, PLAT_W / 2 + CW + 40)
    for (let t = DT; t < 2; t += DT) stepClimber(s, c, DT, t, 0)
    expect(c.h).toBeLessThan(platformAt(s, 1).h)
  })

  it('a broken platform crumbles after its first bounce and then cannot be landed on', () => {
    const s = seedWith(4, 'break')
    const p = platformAt(s, 4)
    const c = dropOnto(s, 4)
    const ev: string[] = []
    for (let t = DT; t < 2; t += DT) ev.push(...stepClimber(s, c, DT, t, 0))
    expect(ev).toContain('crumble')
    const [, at] = c.crumble[0] ?? [0, -1]
    expect(solidFor(c, p, at + CRUMBLE / 2)).toBe(true)
    expect(solidFor(c, p, at + CRUMBLE + 0.01)).toBe(false)
  })

  it('the camera only rises, and follows the climber up', () => {
    const s = seedWith(1, 'solid')
    const c = dropOnto(s, 1)
    let lastCam = c.cam
    for (let t = DT; t < 8; t += DT) {
      stepClimber(s, c, DT, t, 0)
      expect(c.cam).toBeGreaterThanOrEqual(lastCam)
      lastCam = c.cam
    }
    expect(c.cam).toBeGreaterThan(0)
    expect(c.h - c.cam).toBeLessThanOrEqual(FOLLOW + 1e-6 + (c.top - c.h))
  })

  it('falls out once its feet are far below the camera floor', () => {
    const s = 3
    const c = newClimber()
    c.cam = 600
    c.h = 600 - OUT_BELOW - 10
    c.vh = 0
    const ev = stepClimber(s, c, DT, 1, 0)
    expect(ev).toContain('out')
    expect(c.alive).toBe(false)
    const before = c.h
    fallDead(c, DT)
    expect(c.h).toBeLessThan(before)
    expect(BASE_Y).toBeGreaterThan(0)
    expect(GRAV).toBeGreaterThan(0)
  })

  it('counts metres from the highest point', () => {
    const c = newClimber()
    c.top = 1234
    expect(metres(c)).toBe(123)
  })

  it('steering is bounded, and a dead climber does not steer', () => {
    const s = 9
    const c = newClimber()
    for (let t = DT; t < 1; t += DT) stepClimber(s, c, DT, t, 5)
    expect(Math.abs(c.vx)).toBeLessThanOrEqual(460 + 1e-9)
    expect(c.vx).toBeGreaterThan(0)
    c.alive = false
    expect(steer(s, c, 1, 'hard')).toBe(0)
  })
})

describe('flappy jump judging', () => {
  const alive = (top = 0): Climber => ({ ...newClimber(), top })
  const dead = (top = 0): Climber => ({ ...newClimber(), top, alive: false })

  it('the last one climbing wins at once', () => {
    expect(judge(alive(100), dead(900), 5)).toBe(0)
    expect(judge(dead(900), alive(100), 5)).toBe(1)
  })

  it('both out on the same step: the higher one wins', () => {
    expect(judge(dead(300), dead(500), 5)).toBe(1)
    expect(judge(dead(500), dead(500), 5)).toBe('draw')
  })

  it('when time is up, the highest climber wins', () => {
    expect(judge(alive(800), alive(900), ROUND_T)).toBe(1)
    expect(judge(alive(800), alive(800), ROUND_T)).toBe('draw')
    expect(judge(alive(800), alive(900), ROUND_T - 1)).toBeNull()
  })
})

/** One match between two bots. Returns the winner and the number of steps it took. */
function playMatch(
  seed: number,
  d: Difficulty,
): { winner: Side | 'draw' | null; steps: number; outs: number } {
  const cs: [Climber, Climber] = [newClimber(), newClimber()]
  let t = 0
  let outs = 0
  for (let n = 1; n <= ROUND_T * 60 + 60; n++) {
    t += DT
    for (const side of [0, 1] as Side[]) {
      const c = cs[side]
      const dir = steer(seed, c, t, d, side * 0x9e3779b1)
      for (const e of stepClimber(seed, c, DT, t, dir)) if (e === 'out') outs++
    }
    const w = judge(cs[0], cs[1], t)
    if (w !== null) return { winner: w, steps: n, outs }
  }
  return { winner: null, steps: Infinity, outs }
}

describe('flappy jump bot', () => {
  it('bot vs bot always reaches a result within the time limit, from either side', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const wins = new Set<Side | 'draw'>()
      for (let k = 1; k <= 6; k++) {
        const r = playMatch(k * 7919, d)
        expect(r.winner).not.toBeNull()
        expect(r.steps).toBeLessThanOrEqual(ROUND_T * 60 + 60)
        if (r.winner !== null) wins.add(r.winner)
      }
      expect(wins.size).toBeGreaterThan(0)
    }
  })

  it('an easy bot falls out sometimes, so it is beatable', () => {
    const outs = [1, 2, 3, 4, 5, 6].map((k) => playMatch(k * 97, 'easy').outs)
    expect(outs.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('the bot never leaves the lane: its steering stays within [-1, 1]', () => {
    const s = 17
    const c = newClimber()
    for (let t = DT; t < 20; t += DT) {
      const dir = steer(s, c, t, 'normal')
      expect(dir).toBeGreaterThanOrEqual(-1)
      expect(dir).toBeLessThanOrEqual(1)
      stepClimber(s, c, DT, t, dir)
      if (!c.alive) break
    }
    expect(PLAT_GAP).toBeGreaterThan(0)
  })
})
