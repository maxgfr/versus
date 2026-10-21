import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { decide, newMemory, TUNING, type BotMemory } from './bot.ts'
import {
  BAND_Y,
  BALL_R,
  CRAB_R,
  HOP_H,
  HOP_T,
  hopCrab,
  newWorld,
  REACH,
  span,
  step,
  winner,
  type World,
} from './rules.ts'

type Target = number | null

function none(w: World): Target[] {
  return w.crabs.map(() => null)
}

/** Put the ball mid-air at (x, y) moving (vx, vy) at height z with vertical speed vz. */
function toss(w: World, x: number, y: number, vx: number, vy: number, z: number, vz: number): void {
  w.ball = { x, y, z, vx, vy, vz }
  w.phase = 'rally'
  w.last = -1
  w.count = 0
}

/** Computer vs computer until `target` points (or the step budget runs out). */
function botMatch(a: Difficulty, b: Difficulty, seed: number, target: number, teams: boolean) {
  const rng = new Rng(seed)
  const w = newWorld(teams, rng.chance(0.5) ? 0 : 1, rng)
  const mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  let steps = 0
  while (winner(w, target) === null && steps < 60 * 60 * 10) {
    const p0 = decide(w, 0, a, rng, mem[0], STEP)
    const p1 = decide(w, 1, b, rng, mem[1], STEP)
    const x = w.crabs.map((c, i) => (c.side === 0 ? p0.x[i] : p1.x[i]) ?? null)
    const hop = w.crabs.map((c, i) => (c.side === 0 ? p0.hop[i] : p1.hop[i]) ?? false)
    step(w, STEP, x, hop, rng)
    steps++
  }
  return { w, steps }
}

describe('crabby volley rules', () => {
  it('crabs keep to their band and their span', () => {
    const rng = new Rng(1)
    const w = newWorld(true, 0, rng)
    const reds = w.crabs.filter((c) => c.side === 0)
    expect(reds.every((c) => c.y === BAND_Y[0])).toBe(true)
    const target: Target[] = w.crabs.map(() => 0) // scuttle hard to the left edge
    for (let i = 0; i < 60 * 4; i++)
      step(
        w,
        STEP,
        target,
        w.crabs.map(() => false),
        rng,
      )
    for (const c of w.crabs) {
      const sp = span(c.lane)
      expect(c.x).toBeGreaterThanOrEqual(sp.x0 - 1e-6)
      expect(c.x).toBeLessThanOrEqual(sp.x1 + 1e-6)
      expect(c.y).toBe(BAND_Y[c.side])
    }
    expect(w.crabs.find((c) => c.lane === 1)?.x).toBeGreaterThanOrEqual(W / 2 - 1e-6)
  })

  it('a hop lifts the crab and brings it back down', () => {
    const rng = new Rng(2)
    const w = newWorld(false, 0, rng)
    const c = w.crabs[0]
    if (!c) throw new Error('no crab')
    expect(hopCrab(c, c.x + 100)).toBe(true)
    let peak = 0
    for (let i = 0; i < 60 * (HOP_T + 0.2); i++) {
      step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      )
      peak = Math.max(peak, c.z)
    }
    expect(peak).toBeGreaterThan(HOP_H * 0.9)
    expect(c.z).toBe(0)
    expect(c.hop).toBe(-1)
    expect(c.hopTo).toBeGreaterThan(c.hopFrom)
  })

  it('a hopping crab can reach a ball that a grounded crab cannot', () => {
    const rng = new Rng(3)
    const w = newWorld(false, 0, rng)
    const c = w.crabs[0]
    if (!c) throw new Error('no crab')
    // Ball over the crab, falling, just above normal reach.
    toss(w, c.x, c.y, 0, 0, REACH + 400, -200)
    let bumped = false
    for (let i = 0; i < 60 * 0.3 && !bumped; i++) {
      for (const e of step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      ))
        if (e.kind === 'bump') bumped = true
    }
    expect(bumped).toBe(false)

    toss(w, c.x, c.y, 0, 0, REACH + 400, -200)
    expect(hopCrab(c, c.x)).toBe(true)
    for (let i = 0; i < 60 * 1.0 && !bumped; i++) {
      for (const e of step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      ))
        if (e.kind === 'bump') bumped = true
    }
    expect(bumped).toBe(true)
    expect(w.ball.vy).toBeLessThan(0) // red sends it up the table
  })

  it('a ball landing on red sand is a point for blue', () => {
    const rng = new Rng(4)
    const w = newWorld(false, 0, rng)
    toss(w, 300, 1500, 0, 0, 2, -10)
    for (let i = 0; i < 60 * 2 && w.score[1] === 0; i++)
      step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      )
    expect(w.score).toEqual([0, 1])
    expect(w.why).toBe('land')
  })

  it('a ball hit low into the net is a point for the rival of the last toucher', () => {
    const rng = new Rng(5)
    const w = newWorld(false, 0, rng)
    toss(w, 500, MID + 60, 0, -600, 40, 0)
    w.last = 0
    w.count = 1
    for (let i = 0; i < 60 * 2 && w.phase === 'rally'; i++)
      step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      )
    expect(w.score).toEqual([0, 1])
    expect(w.why).toBe('net')
  })

  it('a fourth touch in a row is a point for the rival', () => {
    const rng = new Rng(6)
    const w = newWorld(false, 0, rng)
    const c = w.crabs[0]
    if (!c) throw new Error('no crab')
    toss(w, c.x, c.y, 0, 0, 80, -50)
    w.last = 0
    w.count = 3
    for (let i = 0; i < 60 && w.phase === 'rally'; i++)
      step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      )
    expect(w.score).toEqual([0, 1])
    expect(w.why).toBe('touches')
  })

  it('a rally that runs too long is let drop, so it always ends', () => {
    const rng = new Rng(7)
    const w = newWorld(false, 0, rng)
    toss(w, 500, 900, 0, 0, 600, 0)
    for (let i = 0; i < 60 * 30 && w.phase === 'rally'; i++)
      step(
        w,
        STEP,
        none(w),
        w.crabs.map(() => false),
        rng,
      )
    expect(w.phase).toBe('point')
    expect(w.score[0] + w.score[1]).toBe(1)
  })

  it('the bot plays either side and its crabs scuttle to the landing spot', () => {
    const rng = new Rng(8)
    const w = newWorld(false, 0, rng)
    toss(w, 200, 1100, 0, 0, 500, -300)
    const p = decide(w, 0, 'hard', rng, newMemory(), 1)
    expect(p.x[0]).not.toBeNull()
    expect(Math.abs((p.x[0] ?? 0) - 200)).toBeLessThan(120)
    const w1 = newWorld(false, 1, rng)
    toss(w1, 700, 700, 0, 0, 500, 300)
    const q = decide(w1, 1, 'hard', rng, newMemory(), 1)
    expect(q.x[1]).not.toBeNull()
    expect(TUNING.hard.error).toBeLessThan(TUNING.easy.error)
    expect(CRAB_R).toBeGreaterThan(0)
    expect(BALL_R).toBeGreaterThan(0)
  })

  it('bot vs bot reaches the target within bounded steps', () => {
    const { w, steps } = botMatch('normal', 'normal', 31, 3, false)
    expect(winner(w, 3)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 60 * 10)
  })

  it('bot vs bot in 2 vs 2 finishes too, and the harder side usually wins', () => {
    const { w } = botMatch('hard', 'normal', 32, 3, true)
    expect(w.crabs).toHaveLength(4)
    expect(winner(w, 3)).not.toBeNull()
    let hard = 0
    for (let s = 1; s <= 4; s++)
      if (winner(botMatch('hard', 'easy', s, 3, false).w, 3) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })
})
