import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { chooseX, PACE, placed, rate } from './bot.ts'
import {
  type Body,
  BONUS,
  DANGER_TIME,
  dangerTime,
  decided,
  drop,
  geometry,
  type Geo,
  type Jar,
  KINDS,
  kindSequence,
  landingY,
  MAX_THROW_X,
  MAX_THROW_Y,
  newJar,
  POINTS,
  previewY,
  RAMP_DROPS,
  radius,
  TIME_LIMIT,
  tick,
} from './rules.ts'

const HEADER = 96
const versus = (): Geo => geometry(1000, 900, false, HEADER)
const DT = 1 / 60

/** Run the jar for `seconds` of game time. */
function run(
  jar: Jar,
  geo: Geo,
  seconds: number,
  t0 = 0,
): { t: number; merges: number; hits: number } {
  let t = t0
  let merges = 0
  let hits = 0
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT
    const r = tick(jar, geo, DT, t)
    merges += r.merges.length
    hits += r.hits
  }
  return { t, merges, hits }
}

/** Put a fruit at rest on the jar floor, or on top of what is there, at x. */
function rest(jar: Jar, geo: Geo, k: number, x: number): Body {
  const y = landingY(jar, geo, x, k)
  const b: Body = { k, x, y, vx: 0, vy: 0, hi: 0, sq: 0, born: -10, a: 0 }
  jar.bodies.push(b)
  return b
}

describe('geometry', () => {
  it('places the versus jar in the panel with the danger line below its opening', () => {
    const g = versus()
    expect(g.left).toBe(160)
    expect(g.right).toBe(840)
    expect(g.top).toBe(266)
    expect(g.danger).toBeGreaterThan(g.top)
    expect(g.floor).toBe(840)
  })

  it('makes the solo jar a little bigger, still clear of the pause button', () => {
    const g = geometry(1000, 1800, true, HEADER)
    expect(g.sc).toBeGreaterThan(1)
    expect(g.left).toBeGreaterThan(110)
  })

  it('keeps every preview above the opening', () => {
    const g = versus()
    for (let k = 0; k < KINDS; k++) {
      expect(previewY(g, k) - radius(k, g)).toBeGreaterThanOrEqual(HEADER)
      expect(previewY(g, k)).toBeLessThan(g.top)
    }
  })
})

describe('physics', () => {
  it('drops a fruit that falls and comes to rest on the floor', () => {
    const g = versus()
    const jar = newJar()
    drop(jar, g, 500, 2, 0)
    run(jar, g, 3)
    const b = jar.bodies[0] as Body
    expect(b.y).toBeCloseTo(g.floor - radius(2, g), 0)
    expect(Math.abs(b.vy)).toBeLessThan(40)
    expect(jar.over).toBe(false)
  })

  it('keeps every fruit inside the walls and the floor, with no NaN, under a heavy pile', () => {
    const g = versus()
    const jar = newJar()
    const rng = new Rng(7)
    let t = 0
    for (let i = 0; i < 80; i++) {
      drop(jar, g, rng.range(g.left, g.right), rng.int(0, 4), t)
      for (let s = 0; s < 60; s++) {
        t += DT
        tick(jar, g, DT, t)
        for (const b of jar.bodies) {
          const r = radius(b.k, g)
          expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true)
          expect(b.x - r).toBeGreaterThanOrEqual(g.left - 1e-6)
          expect(b.x + r).toBeLessThanOrEqual(g.right + 1e-6)
          expect(b.y + r).toBeLessThanOrEqual(g.floor + 1e-6)
        }
      }
      if (jar.over) break
    }
  })

  it('fuses two touching fruit of the same kind into the next kind, scoring it', () => {
    const g = versus()
    const jar = newJar()
    rest(jar, g, 1, 400)
    jar.bodies.push({
      k: 1,
      x: 400,
      y: landingY(jar, g, 400, 1) - 8,
      vx: 0,
      vy: 0,
      hi: 0,
      sq: 0,
      born: 0,
      a: 0,
    })
    const out = run(jar, g, 2)
    expect(out.merges).toBe(1)
    expect(jar.bodies.filter((b) => b.k === 2)).toHaveLength(1)
    expect(jar.bodies.filter((b) => b.k === 1)).toHaveLength(0)
    expect(jar.score).toBe(POINTS[2])
  })

  it('does not fuse fruit of different kinds', () => {
    const g = versus()
    const jar = newJar()
    drop(jar, g, 400, 0, 0)
    drop(jar, g, 400, 1, 0)
    run(jar, g, 3)
    expect(jar.bodies.map((b) => b.k).sort()).toEqual([0, 1])
    expect(jar.score).toBe(0)
  })

  it('makes a bonus when two watermelons meet', () => {
    const g = versus()
    const jar = newJar()
    rest(jar, g, KINDS - 1, 300)
    jar.bodies.push({
      k: KINDS - 1,
      x: 300 + radius(KINDS - 1, g) * 1.9,
      y: landingY(jar, g, 300, KINDS - 1) - 10,
      vx: 0,
      vy: 0,
      hi: 0,
      sq: 0,
      born: 0,
      a: 0,
    })
    run(jar, g, 2)
    expect(jar.score).toBe(BONUS)
    expect(jar.bodies.every((b) => b.k !== KINDS)).toBe(true)
  })

  it('ends the jar when a fruit rests above the danger line for two seconds', () => {
    const g = versus()
    const jar = newJar()
    // A tall stack of alternating kinds (equal kinds would fuse), centred: the top fruit sits above the line.
    for (const k of [9, 8, 9]) rest(jar, g, k, (g.left + g.right) / 2)
    const top = jar.bodies[jar.bodies.length - 1] as Body
    expect(top.y - radius(top.k, g)).toBeLessThan(g.danger)
    run(jar, g, DANGER_TIME + 3)
    expect(jar.over).toBe(true)
  })

  it('does not end the jar for a fruit that only passes the line while falling', () => {
    const g = versus()
    const jar = newJar()
    drop(jar, g, 500, 0, 0)
    run(jar, g, 4)
    expect(jar.over).toBe(false)
  })

  it('freezes a finished jar', () => {
    const g = versus()
    const jar = newJar()
    jar.over = true
    drop(jar, g, 500, 0, 0)
    const out = run(jar, g, 1)
    expect(out.hits).toBe(0)
    expect((jar.bodies[0] as Body).vy).toBe(0)
  })
})

describe('sequence and bot', () => {
  it('gives both players the same sequence per seed, skewed to the small fruit', () => {
    expect(kindSequence(5)).toEqual(kindSequence(5))
    expect(kindSequence(5)).not.toEqual(kindSequence(6))
    const seq = kindSequence(99, 2000)
    const count = (k: number) => seq.filter((v) => v === k).length
    expect(count(0)).toBeGreaterThan(count(5))
    expect(seq.every((k) => k >= 0 && k <= 5)).toBe(true)
  })

  it('the bot drops inside the jar and prefers fuse candidates', () => {
    const g = versus()
    const jar = newJar()
    const rng = new Rng(3)
    const x0 = rest(jar, g, 2, 600).x
    let near = 0
    for (let i = 0; i < 50; i++) {
      const x = chooseX(jar, g, 2, 'hard', rng)
      expect(x).toBeGreaterThanOrEqual(g.left)
      expect(x).toBeLessThanOrEqual(g.right)
      if (Math.abs(x - x0) < 30) near++
    }
    expect(near).toBeGreaterThan(30)
  })

  it('bot vs bot: every difficulty ends with a score within the time limit, both jars at once', () => {
    const seconds: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0 }
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (const seed of [31, 32]) {
        const g = versus()
        const seq = kindSequence(seed)
        const rng = new Rng(seed)
        const jars = [newJar(), newJar()]
        const next = [seq[0] ?? 0, seq[0] ?? 0]
        const idx = [0, 0]
        const botT = [0, 0]
        const cool = [0, 0]
        let t = 0
        while (t < TIME_LIMIT - DT / 2) {
          t += DT
          for (const s of [0, 1] as const) {
            cool[s] = Math.max(0, (cool[s] ?? 0) - DT)
            const jar = jars[s] as Jar
            if (!jar.over) {
              botT[s] = (botT[s] ?? 0) + DT
              if ((botT[s] ?? 0) >= PACE[d] && (cool[s] ?? 0) <= 0) {
                botT[s] = 0
                const x = chooseX(jar, g, next[s] ?? 0, d, rng)
                drop(jar, g, x, next[s] ?? 0, t)
                cool[s] = 0.22
                idx[s] = (idx[s] ?? 0) + 1
                next[s] = seq[(idx[s] ?? 0) % seq.length] ?? 0
              }
            }
            tick(jar, g, DT, t)
            for (const b of jar.bodies) expect(Number.isFinite(b.y)).toBe(true)
          }
          if ((jars[0] as Jar).over && (jars[1] as Jar).over) break
        }
        seconds[d] = t
        expect(t).toBeLessThanOrEqual(TIME_LIMIT + DT)
        expect((jars[0] as Jar).score).toBeGreaterThan(0)
        expect((jars[1] as Jar).score).toBeGreaterThan(0)
      }
    }
    expect(Object.values(seconds).every((s) => s > 0)).toBe(true)
  })
})

describe('throws', () => {
  it('caps a flick and never throws a fruit upward', () => {
    const g = versus()
    const jar = newJar()
    drop(jar, g, 500, 1, 0, 99999, -5000)
    const b = jar.bodies[0] as Body
    expect(b.vx).toBe(MAX_THROW_X)
    expect(b.vy).toBe(0)
    drop(jar, g, 500, 1, 0, -99999, 99999)
    const c = jar.bodies[1] as Body
    expect(c.vx).toBe(-MAX_THROW_X)
    expect(c.vy).toBe(MAX_THROW_Y)
    drop(jar, g, 500, 1, 0, Number.NaN, Number.POSITIVE_INFINITY)
    const d = jar.bodies[2] as Body
    expect(d.vx).toBe(0)
    expect(d.vy).toBe(0)
  })

  it('a sideways throw bounces off the wall, stays inside and rolls', () => {
    const g = versus()
    const jar = newJar()
    drop(jar, g, 500, 2, 0, MAX_THROW_X, 0)
    let hits = 0
    for (let i = 0; i < 180; i++) {
      hits += tick(jar, g, DT, i * DT).hits
      const b = jar.bodies[0] as Body
      const r = radius(b.k, g)
      expect(b.x + r).toBeLessThanOrEqual(g.right + 1e-6)
    }
    expect(hits).toBeGreaterThan(0)
    expect((jar.bodies[0] as Body).a).not.toBe(0)
  })

  it('a slam into a pile neither tunnels through it nor flings fruit out of the jar', () => {
    const g = versus()
    const jar = newJar()
    const rng = new Rng(11)
    for (let i = 0; i < 10; i++) rest(jar, g, rng.int(2, 5), rng.range(g.left + 60, g.right - 60))
    run(jar, g, 3)
    const before = jar.score
    for (let i = 0; i < 6; i++) {
      const vx = rng.range(-MAX_THROW_X, MAX_THROW_X)
      drop(jar, g, rng.range(g.left, g.right), 0, i, vx, MAX_THROW_Y)
      for (let s = 0; s < 20; s++) {
        tick(jar, g, DT, i)
        for (const b of jar.bodies) {
          const r = radius(b.k, g)
          expect(b.y + r).toBeLessThanOrEqual(g.floor + 1e-6)
          expect(b.y).toBeGreaterThan(g.top - 110 * g.sc)
        }
      }
    }
    expect(jar.score).toBeGreaterThanOrEqual(before)
  })
})

describe('end of the game', () => {
  const j = (score: number, over: boolean) => ({ score, over })
  it('waits while both jars are live', () => {
    expect(decided(j(50, false), j(10, false))).toBeNull()
  })
  it('both jars full: the higher score wins, equal scores draw', () => {
    expect(decided(j(50, true), j(10, true))).toBe(0)
    expect(decided(j(5, true), j(10, true))).toBe(1)
    expect(decided(j(20, true), j(20, true))).toBe('draw')
  })
  it('one jar full and the live one already ahead: decided at once', () => {
    expect(decided(j(10, true), j(30, false))).toBe(1)
    expect(decided(j(30, false), j(10, true))).toBe(0)
  })
  it('one jar full but the live one behind or level: keeps playing', () => {
    expect(decided(j(30, true), j(10, false))).toBeNull()
    expect(decided(j(10, false), j(10, true))).toBeNull()
  })
})

describe('bot judgement', () => {
  it('prefers a fusion and keeps clear of the danger line', () => {
    const g = versus()
    const jar = newJar()
    rest(jar, g, 3, 300)
    expect(rate(jar, g, 300, 3, false)).toBeGreaterThan(rate(jar, g, 700, 3, false))
    // A tower on the right reaching the line: never drop on it.
    for (const k of [9, 8]) rest(jar, g, k, g.right - 110)
    expect(rate(jar, g, g.right - 110, 0, false)).toBeLessThan(rate(jar, g, g.left + 60, 0, false))
  })

  it('hard looks a fusion ahead: it takes the merge that chains', () => {
    const g = versus()
    const jar = newJar()
    rest(jar, g, 2, 300)
    rest(jar, g, 3, 300 + radius(2, g) + radius(3, g) + 4)
    rest(jar, g, 2, 760)
    expect(rate(jar, g, 300, 2, true)).toBeGreaterThan(rate(jar, g, 760, 2, true))
  })

  it('hard scores more than easy over the same fruit', () => {
    const total: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0 }
    for (const d of ['easy', 'hard'] as const) {
      for (const seed of [41, 42, 43]) {
        const g = versus()
        const seq = kindSequence(seed)
        const rng = new Rng(seed)
        const jar = newJar()
        let t = 0
        let i = 0
        // Same pace for both: only the judgement differs.
        while (t < 90 && !jar.over) {
          for (let s = 0; s < 60; s++) {
            t += DT
            tick(jar, g, DT, t)
          }
          const k = seq[i++ % seq.length] ?? 0
          drop(jar, g, chooseX(jar, g, k, d, rng), k, t)
        }
        total[d] += jar.score
      }
    }
    expect(total.hard).toBeGreaterThan(total.easy)
  })
})

describe('the match ramps', () => {
  it('the danger line grows less patient as the clock runs', () => {
    expect(dangerTime(0)).toBe(DANGER_TIME)
    expect(dangerTime(1)).toBeCloseTo(DANGER_TIME * 0.6, 6)
    expect(dangerTime(0.5)).toBeLessThan(dangerTime(0.2))
    expect(dangerTime(7)).toBe(dangerTime(1))
    expect(dangerTime(Number.NaN)).toBe(DANGER_TIME)
  })

  it('a jar ends sooner under the late patience', () => {
    const g = versus()
    const early = newJar()
    const late = newJar()
    for (const jar of [early, late]) for (const k of [9, 8, 9]) rest(jar, g, k, 500)
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      tick(early, g, DT, i * DT, dangerTime(0))
      tick(late, g, DT, i * DT, dangerTime(1))
    }
    expect(early.over).toBe(false)
    expect(late.over).toBe(true)
  })

  it('bigger fruit come more often later in the sequence, the same for both players', () => {
    const seq = kindSequence(77, RAMP_DROPS * 20)
    const big = (a: number[]) => a.filter((k) => k >= 3).length / a.length
    expect(big(seq.slice(RAMP_DROPS * 2))).toBeGreaterThan(big(seq.slice(0, 40)) + 0.03)
    expect(kindSequence(77)).toEqual(kindSequence(77))
  })
})

describe('bot strength', () => {
  it('placed() fuses a drop onto its twin and stacks anything else', () => {
    const g = versus()
    const jar = newJar()
    rest(jar, g, 2, 400)
    expect(placed(jar, g, 400, 2).bodies.map((b) => b.k)).toEqual([3])
    expect(
      placed(jar, g, 700, 1)
        .bodies.map((b) => b.k)
        .sort(),
    ).toEqual([1, 2])
    expect(jar.bodies).toHaveLength(1)
  })

  /** One jar for 120 s, each difficulty at its own pace, with the ramps on. */
  function solo(d: Difficulty, seed: number): number {
    const g = versus()
    const seq = kindSequence(seed)
    const rng = new Rng(seed * 7 + 1)
    const jar = newJar()
    let t = 0
    let i = 0
    let botT = 0
    while (t < TIME_LIMIT && !jar.over) {
      t += DT
      botT += DT
      if (botT >= PACE[d]) {
        botT = 0
        const k = seq[i % seq.length] ?? 0
        const next = seq[(i + 1) % seq.length]
        i++
        drop(jar, g, chooseX(jar, g, k, d, rng, next), k, t)
      }
      tick(jar, g, DT, t, dangerTime(t / TIME_LIMIT))
    }
    return jar.score
  }

  it('hard beats easy, and normal beats easy, on most seeded runs', () => {
    let hard = 0
    let normal = 0
    const seeds = [51, 52, 53, 54, 55]
    for (const seed of seeds) {
      const e = solo('easy', seed)
      if (solo('hard', seed) > e) hard++
      if (solo('normal', seed) > e) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(4)
    expect(normal).toBeGreaterThanOrEqual(4)
  })
})
