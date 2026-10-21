import { describe, expect, it } from 'vitest'
import type { Difficulty, Side } from '../../core/game.ts'
import { shouldJump } from './bot.ts'
import {
  BUFFER,
  type Chicken,
  CH_HALF,
  eggAt,
  fallDead,
  judge,
  newChicken,
  nextObstacle,
  obstacleAt,
  obstaclesIn,
  ROUND_CAP,
  RUN_X,
  speedAt,
  stepChicken,
  TARGET,
} from './rules.ts'

const DT = 1 / 60

/** First seed (from 1) whose first obstacle matches `kind`. */
function seedWith(kind: string): number {
  for (let s = 1; s < 10_000; s++) if (obstacleAt(s, 0).kind === kind) return s
  throw new Error('no seed')
}

/** Run one chicken at a fixed speed, jumping when `jump(c)` says so, until `until` or 30 s. */
function run(
  seed: number,
  c: Chicken,
  speed: number,
  jump: (c: Chicken) => boolean,
  until: (c: Chicken) => boolean,
): number {
  let t = 0
  while (t < 30) {
    t += DT
    stepChicken(seed, c, DT, speed, c.alive && jump(c), false, t)
    if (until(c) || !c.alive) return t
  }
  return t
}

describe('chicken jump course', () => {
  it('is a pure function of seed and index', () => {
    expect(obstacleAt(42, 7)).toEqual(obstacleAt(42, 7))
    expect(obstacleAt(42, 7)).not.toEqual(obstacleAt(43, 7))
  })

  it('keeps obstacles apart so that one jump can clear each', () => {
    for (let s = 1; s <= 20; s++) {
      for (let i = 0; i < 60; i++) {
        const a = obstacleAt(s, i)
        const b = obstacleAt(s, i + 1)
        expect(b.x - (a.x + a.w)).toBeGreaterThan(300)
      }
    }
  })

  it('finds the next obstacle that is not behind a point', () => {
    const o = obstacleAt(9, 0)
    expect(nextObstacle(9, o.x - 5).i).toBe(0)
    expect(nextObstacle(9, o.x + o.w + 1).i).toBeGreaterThan(0)
  })

  it('lists obstacles overlapping a window', () => {
    const o = obstacleAt(9, 0)
    expect(obstaclesIn(9, o.x + 1, o.x + 2).map((x) => x.i)).toContain(0)
    expect(obstaclesIn(9, 0, 10)).toEqual([])
  })

  it('egg ids grow with x', () => {
    for (let s = 1; s <= 5; s++) {
      let last = -Infinity
      for (let id = 0; id < 60 * 3; id++) {
        const e = eggAt(s, id)
        if (!e) continue
        expect(e.x).toBeGreaterThan(last)
        last = e.x
      }
    }
  })
})

describe('chicken jump motion', () => {
  it('a hold jump rises higher than a tap jump', () => {
    const peak = (held: boolean): number => {
      const c = newChicken()
      stepChicken(1, c, DT, 300, true, held, 0.1)
      let top = 0
      for (let t = 0.2; t < 2; t += DT) {
        stepChicken(1, c, DT, 300, false, held, t)
        top = Math.max(top, c.h)
      }
      return top
    }
    expect(peak(true)).toBeGreaterThan(peak(false) + 60)
  })

  it('lands back on the ground after a tap jump', () => {
    const c = newChicken()
    stepChicken(1, c, DT, 300, true, false, 0.1)
    expect(c.grounded).toBe(false)
    for (let t = 0.2; t < 2; t += DT) stepChicken(1, c, DT, 300, false, false, t)
    expect(c.grounded).toBe(true)
    expect(c.h).toBe(0)
  })

  it('a press just before landing still jumps', () => {
    const c = newChicken()
    stepChicken(1, c, DT, 300, true, false, 0.1)
    // Wait until it is coming down close to the ground, then press.
    let t = 0.1
    while (!(c.vh < 0 && c.h < 40)) {
      t += DT
      stepChicken(1, c, DT, 300, false, false, t)
    }
    expect(c.grounded).toBe(false)
    stepChicken(1, c, DT, 300, true, false, t)
    expect(c.buf).toBeCloseTo(BUFFER - DT, 2)
    let jumps = 0
    for (let k = 0; k < 120; k++) {
      t += DT
      for (const e of stepChicken(1, c, DT, 300, false, false, t)) if (e === 'jump') jumps++
    }
    expect(jumps).toBe(1)
  })

  it('a fence hits a chicken that stands in front of it', () => {
    const seed = seedWith('fence')
    const o = obstacleAt(seed, 0)
    const c = newChicken()
    run(
      seed,
      c,
      300,
      () => false,
      () => false,
    )
    expect(c.alive).toBe(false)
    expect(c.dist + RUN_X + CH_HALF).toBeGreaterThan(o.x)
  })

  it('a chicken that jumps at the right time clears a fence', () => {
    const seed = seedWith('fence')
    const o = obstacleAt(seed, 0)
    const c = newChicken()
    const at = (x: Chicken) => o.x - (x.dist + RUN_X + CH_HALF) <= 0.3 * 300
    run(
      seed,
      c,
      300,
      (x) => x.grounded && at(x),
      (x) => x.dist + RUN_X > o.x + o.w + 60,
    )
    expect(c.alive).toBe(true)
  })

  it('a pit swallows a chicken that walks into it', () => {
    const seed = seedWith('pit')
    const c = newChicken()
    run(
      seed,
      c,
      300,
      () => false,
      () => false,
    )
    expect(c.alive).toBe(false)
  })

  it('a chicken that jumps over a pit survives it', () => {
    const seed = seedWith('pit')
    const o = obstacleAt(seed, 0)
    const c = newChicken()
    const at = (x: Chicken) => o.x - (x.dist + RUN_X + CH_HALF) <= 0.23 * 300
    run(
      seed,
      c,
      300,
      (x) => x.grounded && at(x),
      (x) => x.dist + RUN_X > o.x + o.w + 60,
    )
    expect(c.alive).toBe(true)
  })

  it('a dead chicken tumbles into the pit it fell in', () => {
    const seed = seedWith('pit')
    const c = newChicken()
    run(
      seed,
      c,
      300,
      () => false,
      () => false,
    )
    // It pops up first, then drops through the pit.
    for (let k = 0; k < 120; k++) fallDead(seed, c, DT)
    expect(c.h).toBeLessThan(0)
  })

  it('collects an egg once, even when it stays in reach', () => {
    const seed = 1
    let id = 0
    while (!eggAt(seed, id)) id++
    const e = eggAt(seed, id)
    if (!e) throw new Error('no egg')
    const c = newChicken()
    c.dist = e.x - RUN_X
    c.h = e.h
    c.grounded = false
    let got = 0
    for (let k = 0; k < 30; k++) {
      for (const ev of stepChicken(seed, c, DT, 0, false, false, k * DT)) if (ev === 'egg') got++
      c.h = e.h
    }
    expect(got).toBe(1)
    expect(c.eggs).toBe(1)
  })

  it('the speed grows with the round, up to a cap', () => {
    expect(speedAt(0)).toBeLessThan(speedAt(30))
    expect(speedAt(1000)).toBe(620)
  })
})

describe('chicken jump judging', () => {
  const alive = (eggs = 0, dist = 0): Chicken => ({ ...newChicken(), eggs, dist })
  const dead = (): Chicken => ({ ...newChicken(), alive: false })

  it('the last one running wins the round', () => {
    expect(judge(alive(), dead(), 3)).toBe(0)
    expect(judge(dead(), alive(), 3)).toBe(1)
    expect(judge(dead(), dead(), 3)).toBe('draw')
  })

  it('still running at the cap, eggs decide, then distance', () => {
    expect(judge(alive(5), alive(3), ROUND_CAP)).toBe(0)
    expect(judge(alive(2), alive(3), ROUND_CAP)).toBe(1)
    expect(judge(alive(3, 900), alive(3, 800), ROUND_CAP)).toBe(0)
    expect(judge(alive(3), alive(3), ROUND_CAP)).toBe('draw')
    expect(judge(alive(5), alive(3), ROUND_CAP - 1)).toBeNull()
  })
})

/** One round: both bots play until the round is judged. */
function playRound(seed: number, d: Difficulty): { winner: Side | 'draw' | null; steps: number } {
  const cs: [Chicken, Chicken] = [newChicken(), newChicken()]
  let t = 0
  for (let n = 1; n <= ROUND_CAP * 60 + 60; n++) {
    t += DT
    const speed = speedAt(t)
    for (const side of [0, 1] as Side[]) {
      const c = cs[side]
      const jump = c.alive && shouldJump(seed, c, speed, d, side * 0x9e3779b1)
      stepChicken(seed, c, DT, speed, jump, false, t)
    }
    const w = judge(cs[0], cs[1], t)
    if (w !== null) return { winner: w, steps: n }
  }
  return { winner: null, steps: Infinity }
}

describe('chicken jump bot', () => {
  it('an easy bot loses rounds, so it is beatable', () => {
    const steps = [1, 2, 3, 4, 5, 6].map((s) => playRound(s * 97, 'easy').steps)
    expect(Math.min(...steps)).toBeLessThan(ROUND_CAP * 60)
  })

  it('bot vs bot finishes a match within bounded steps, with both sides winning', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const wins: [number, number] = [0, 0]
      let rounds = 0
      let steps = 0
      while (Math.max(...wins) < TARGET && rounds < 40) {
        const r = playRound(2000 + rounds * 37, d)
        expect(r.winner).not.toBeNull()
        steps += r.steps
        rounds++
        if (r.winner !== 'draw' && r.winner !== null) wins[r.winner]++
      }
      expect(Math.max(...wins)).toBe(TARGET)
      expect(rounds).toBeLessThan(40)
      expect(steps).toBeLessThan(rounds * (ROUND_CAP * 60 + 60))
    }
  })

  it('bots of both sides win rounds', () => {
    const won = new Set<Side | 'draw' | null>()
    for (let k = 0; k < 40 && won.size < 3; k++) {
      const r = playRound(7000 + k * 13, 'easy')
      won.add(r.winner)
    }
    expect(won.has(0)).toBe(true)
    expect(won.has(1)).toBe(true)
  })
})
