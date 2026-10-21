import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { chooseX, PACE } from './bot.ts'
import {
  type Body,
  BONUS,
  DANGER_TIME,
  drop,
  geometry,
  type Geo,
  type Jar,
  KINDS,
  kindSequence,
  landingY,
  newJar,
  POINTS,
  previewY,
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
  const b: Body = { k, x, y, vx: 0, vy: 0, hi: 0, sq: 0, born: -10 }
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
