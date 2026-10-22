import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { RobotBot } from './bot.ts'
import {
  ARENA,
  ARENA_BOTTOM,
  type Drive,
  type Ev,
  HP,
  inArena,
  LUNGE,
  MAX_SPEED,
  newWorld,
  PITS,
  R,
  roundWinner,
  SAW,
  stepWorld,
  type World,
  ZAP_CD,
  ZAP_DMG,
} from './rules.ts'

const none = (w: World): (Drive | undefined)[] => w.robots.map(() => undefined)

/** Both robots in open floor, facing each other, away from hazards. */
function duel(): World {
  const w = newWorld()
  const [red, blue] = w.robots
  if (!red || !blue) throw new Error('two robots expected')
  red.x = 300
  red.y = 1200
  red.a = 0
  blue.x = 700
  blue.y = 600
  blue.a = Math.PI
  red.cd = 0
  blue.cd = 0
  return w
}

describe('robot arena', () => {
  it('spawns both robots inside the arena and clear of the hazards', () => {
    const w = newWorld()
    for (const r of w.robots) {
      expect(inArena(r.x, r.y, R)).toBe(true)
      expect(Math.hypot(r.x - SAW.x, r.y - SAW.y)).toBeGreaterThan(SAW.r + R)
      for (const p of PITS) expect(Math.hypot(r.x - p.x, r.y - p.y)).toBeGreaterThan(p.r + R)
    }
  })

  it('the pits sit on the side walls, mirrored', () => {
    for (const p of PITS) {
      expect(p.x === ARENA.x0 + 80 || p.x === ARENA.x0 + ARENA.size - 80).toBe(true)
      expect(PITS.some((q) => q.x === 1000 - p.x && q.y === p.y)).toBe(true)
    }
    expect(ARENA_BOTTOM - ARENA.y0).toBe(ARENA.size)
  })

  it('drives at the stick speed and stops when released', () => {
    const w = duel()
    const red = w.robots[0] as NonNullable<World['robots'][number]>
    const x0 = red.x
    for (let i = 0; i < 60; i++) stepWorld(w, [{ jx: 1, jy: 0, zap: false }, undefined], STEP, [])
    expect(red.x - x0).toBeGreaterThan(200)
    expect(Math.hypot(red.vx, red.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-6)
    for (let i = 0; i < 120; i++) stepWorld(w, none(w), STEP, [])
    expect(Math.hypot(red.vx, red.vy)).toBeLessThan(1)
  })

  it('bounces off the walls and stays inside', () => {
    const w = duel()
    const red = w.robots[0] as NonNullable<World['robots'][number]>
    red.y = 1200
    red.x = 300
    const ev: Ev[] = []
    for (let i = 0; i < 900; i++)
      stepWorld(w, [{ jx: -1, jy: 0.2, zap: false }, undefined], STEP, ev)
    expect(inArena(red.x, red.y, R - 1e-6)).toBe(true)
    expect(ev.some((e) => e.k === 'wall')).toBe(true)
  })

  it('a zap hits a rival in the arc, deals damage and pushes it, then reloads', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    blue.x = red.x + 120
    blue.y = red.y
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: 0, zap: true }, undefined], STEP, ev)
    expect(blue.hp).toBe(HP - ZAP_DMG)
    expect(blue.vx).toBeGreaterThan(0)
    expect(red.cd).toBeCloseTo(ZAP_CD, 6)
    expect(ev.some((e) => e.k === 'zap')).toBe(true)
    // Second zap while reloading does nothing.
    stepWorld(w, [{ jx: 0, jy: 0, zap: true }, undefined], STEP, ev)
    expect(blue.hp).toBe(HP - ZAP_DMG)
  })

  it('a zap misses a rival behind the robot or out of reach', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    blue.x = red.x - 120
    blue.y = red.y
    stepWorld(w, [{ jx: 0, jy: 0, zap: true }, undefined], STEP, [])
    expect(blue.hp).toBe(HP)
    red.cd = 0
    blue.x = red.x + 400
    stepWorld(w, [{ jx: 0, jy: 0, zap: true }, undefined], STEP, [])
    expect(blue.hp).toBe(HP)
  })

  it('a fast ram hurts the robot that is hit, a slow touch does not', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    red.x = 400
    red.y = 1150
    red.vx = 0
    blue.x = 400 + 2 * R - 4
    blue.y = 1150
    blue.vx = -40
    blue.vy = 0
    stepWorld(w, none(w), STEP, [])
    expect(blue.hp).toBe(HP)
    red.vx = 320
    blue.vx = 0
    red.x = 400
    blue.x = 400 + 2 * R - 4
    stepWorld(w, none(w), STEP, [])
    expect(blue.hp).toBeLessThan(HP)
  })

  it('the rammer deals the blow whichever robot comes first in the list', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    // Blue drives into a parked red: red is hurt, blue is not.
    red.x = 400
    red.y = 1150
    red.vx = red.vy = 0
    blue.x = 400 + 2 * R - 4
    blue.y = 1150
    blue.vx = -320
    blue.vy = 0
    const ev: Ev[] = []
    stepWorld(w, none(w), STEP, ev)
    expect(red.hp).toBeLessThan(HP)
    expect(blue.hp).toBe(HP)
    const ram = ev.find((e) => e.k === 'ram')
    expect(ram?.k === 'ram' && ram.by).toBe(1)
  })

  it('a head-on crash hurts both robots alike', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    red.x = 400
    red.y = 1150
    red.vx = 300
    red.vy = 0
    blue.x = 400 + 2 * R - 4
    blue.y = 1150
    blue.vx = -300
    blue.vy = 0
    stepWorld(w, none(w), STEP, [])
    expect(red.hp).toBeLessThan(HP)
    expect(red.hp).toBeCloseTo(blue.hp, 6)
  })

  it('two zaps on the same step both land (no first-in-list advantage)', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    red.x = 400
    red.y = 1150
    red.a = 0
    blue.x = 560
    blue.y = 1150
    blue.a = Math.PI
    // One zap from either kills.
    red.hp = blue.hp = ZAP_DMG - 1
    const zap: Drive = { jx: 0, jy: 0, zap: true }
    stepWorld(w, [zap, zap], STEP, [])
    expect(red.alive).toBe(false)
    expect(blue.alive).toBe(false)
    expect(roundWinner(w)).toBe('draw')
  })

  it('a zap thrown while charging lands harder than one standing still', () => {
    const hitBy = (speed: number): number => {
      const w = duel()
      const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
      if (!red || !blue) throw new Error('robots')
      red.x = 400
      red.y = 1150
      red.a = 0
      red.vx = speed
      red.vy = 0
      blue.x = 560
      blue.y = 1150
      stepWorld(w, [{ jx: speed ? 1 : 0, jy: 0, zap: true }, undefined], STEP, [])
      return HP - blue.hp
    }
    expect(hitBy(0)).toBeCloseTo(ZAP_DMG, 6)
    expect(hitBy(MAX_SPEED)).toBeGreaterThan(ZAP_DMG * (1 + LUNGE * 0.9))
  })

  it('the saw wears robots down and throws them out', () => {
    const w = duel()
    const red = w.robots[0] as NonNullable<World['robots'][number]>
    red.x = SAW.x + SAW.r
    red.y = SAW.y
    const hp0 = red.hp
    stepWorld(w, none(w), STEP, [])
    expect(red.hp).toBeLessThan(hp0)
    expect(Math.hypot(red.x - SAW.x, red.y - SAW.y)).toBeGreaterThanOrEqual(SAW.r + R - 1e-6)
  })

  it('a robot that tips into a pit is out at once', () => {
    const w = duel()
    const red = w.robots[0] as NonNullable<World['robots'][number]>
    const p = PITS[0] as (typeof PITS)[number]
    red.x = p.x
    red.y = p.y
    const ev: Ev[] = []
    stepWorld(w, none(w), STEP, ev)
    expect(red.alive).toBe(false)
    expect(red.fell).toBe(true)
    expect(ev.some((e) => e.k === 'fall')).toBe(true)
    expect(roundWinner(w)).toBe(1)
  })

  it('the round is decided by the first knock-out; both out at once is a draw', () => {
    const w = duel()
    const [red, blue] = w.robots as NonNullable<World['robots'][number]>[]
    if (!red || !blue) throw new Error('robots')
    expect(roundWinner(w)).toBeNull()
    blue.hp = 0
    blue.alive = false
    expect(roundWinner(w)).toBe(0)
    red.alive = false
    expect(roundWinner(w)).toBe('draw')
  })
})

describe('robot bot vs bot', () => {
  it('hard beats easy and normal beats easy nearly every time, from either side', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
    ] as const) {
      let wins = 0
      let decided = 0
      for (let seed = 0; seed < 20; seed++) {
        const rng = new Rng(seed * 7 + 1)
        const w = newWorld()
        const side = seed % 2
        const bots = w.robots.map((r) => new RobotBot(rng.fork(), r.side === side ? strong : weak))
        for (let i = 0; i < 60 * 120 && roundWinner(w) === null; i++)
          stepWorld(
            w,
            w.robots.map((r, j) => bots[j]?.decide(w, r, STEP)),
            STEP,
            [],
          )
        const r = roundWinner(w)
        if (r === null || r === 'draw') continue
        decided++
        if (r === side) wins++
      }
      expect(decided).toBeGreaterThan(15)
      expect(wins / decided).toBeGreaterThan(0.8)
    }
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`a ${difficulty} round reaches a result within bounded steps`, () => {
      for (let seed = 0; seed < 4; seed++) {
        const rng = new Rng(seed * 13 + 3)
        const w = newWorld()
        const bots = w.robots.map(() => new RobotBot(rng.fork(), difficulty))
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * 120) {
          const drives = w.robots.map((r, i) => bots[i]?.decide(w, r, STEP))
          stepWorld(w, drives, STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
      }
    })
  }
})
