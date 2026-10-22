import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { KnightBot } from './bot.ts'
import {
  BOX,
  BODY,
  CHARGE_CD,
  CHARGE_SPEED,
  type Drive,
  type Ev,
  HEAT,
  HEAT_T,
  newWorld,
  REST,
  SPAWN,
  SPEED,
  stepWorld,
  type World,
} from './rules.ts'

const still: Drive = { jx: 0, jy: 0, press: false }

/** Place both knights (red first). */
function place(w: World, red: [number, number, number], blue: [number, number, number]): void {
  w.k[0] = { ...w.k[0], x: red[0], y: red[1], a: red[2], v: 0 }
  w.k[1] = { ...w.k[1], x: blue[0], y: blue[1], a: blue[2], v: 0 }
}

describe('fatal knights: points', () => {
  it('a lance tip in the rival’s back scores a point and both go back to their spawns', () => {
    const w = newWorld()
    // Red rides up from below; blue faces away (up), so red hits its back.
    place(w, [500, 700, -Math.PI / 2], [500, 560, -Math.PI / 2])
    const ev: Ev[] = []
    const scorer = stepWorld(w, [still, still], STEP, ev)
    expect(scorer).toBe(0)
    expect(w.pts).toEqual([1, 0])
    expect(ev.some((e) => e.k === 'point' && e.side === 0)).toBe(true)
    expect(w.k[0].x).toBe(SPAWN[0].x)
    expect(w.k[0].y).toBe(SPAWN[0].y)
    expect(w.rest).toBeGreaterThan(w.t)
  })

  it('a lance tip into the shield clashes: no point, both knocked back', () => {
    const w = newWorld()
    // Blue faces red, so the lance meets its shield.
    place(w, [500, 700, -Math.PI / 2], [500, 560, Math.PI / 2])
    const ev: Ev[] = []
    const scorer = stepWorld(w, [still, still], STEP, ev)
    expect(scorer).toBeNull()
    expect(w.pts).toEqual([0, 0])
    expect(ev.some((e) => e.k === 'clash')).toBe(true)
    expect(w.k[0].v).toBeLessThan(0)
    expect(w.k[1].v).toBeLessThan(0)
    expect(w.k[0].stun).toBeGreaterThan(w.t)
  })

  it('a hit from the side scores too', () => {
    const w = newWorld()
    // Blue faces up (its right is red's side): red's tip touches its flank.
    place(w, [500, 700, -Math.PI / 2], [546, 578, -Math.PI / 2])
    const scorer = stepWorld(w, [still, still], STEP, [])
    expect(scorer).toBe(0)
  })

  it('nothing moves during the pause after a point', () => {
    const w = newWorld()
    place(w, [500, 700, -Math.PI / 2], [500, 560, -Math.PI / 2])
    stepWorld(w, [still, still], STEP, [])
    const x0 = w.k[0].x
    const y0 = w.k[0].y
    stepWorld(w, [{ jx: 1, jy: 0, press: false }, still], STEP, [])
    expect(w.k[0].x).toBeCloseTo(x0, 6)
    expect(w.k[0].y).toBeCloseTo(y0, 6)
    while (w.t < w.rest) stepWorld(w, [still, still], STEP, [])
    stepWorld(w, [{ jx: 1, jy: 0, press: false }, still], STEP, [])
    expect(w.k[0].x).toBeGreaterThan(x0)
  })
})

describe('fatal knights: riding', () => {
  it('the horse steers with the stick and goes at the stick speed', () => {
    const w = newWorld()
    place(w, [500, 900, 0], [200, 400, -Math.PI / 2])
    for (let i = 0; i < 120; i++) stepWorld(w, [{ jx: 0, jy: 1, press: false }, still], STEP, [])
    expect(w.k[0].a).toBeCloseTo(Math.PI / 2, 1)
    expect(Math.abs(w.k[0].v)).toBeGreaterThan(SPEED * 0.9)
  })

  it('a charge bursts forward, and cannot be repeated until it has recharged', () => {
    const w = newWorld()
    place(w, [500, 1000, -Math.PI / 2], [200, 400, -Math.PI / 2])
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: -1, press: true }, still], STEP, ev)
    expect(ev.some((e) => e.k === 'charge' && e.side === 0)).toBe(true)
    for (let i = 0; i < 30; i++) stepWorld(w, [{ jx: 0, jy: -1, press: false }, still], STEP, [])
    expect(w.k[0].v).toBeGreaterThan(SPEED * 1.5)
    expect(w.k[0].v).toBeLessThanOrEqual(CHARGE_SPEED + 1)
    // Pressing again straight away does nothing.
    const again: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: -1, press: true }, still], STEP, again)
    expect(again.some((e) => e.k === 'charge')).toBe(false)
    expect(w.k[0].ready).toBeGreaterThan(w.t + CHARGE_CD / 2)
  })

  it('a clash stuns the knights for a moment, so they cannot steer', () => {
    const w = newWorld()
    place(w, [500, 700, -Math.PI / 2], [500, 560, Math.PI / 2])
    stepWorld(w, [still, still], STEP, [])
    const a0 = w.k[0].a
    stepWorld(w, [{ jx: 1, jy: 0, press: false }, still], STEP, [])
    expect(w.k[0].a).toBeCloseTo(a0, 6)
  })

  it('the fence bounces a knight back inside the lists', () => {
    const w = newWorld()
    place(w, [BOX.x1 - BODY - 40, 900, 0], [200, 400, -Math.PI / 2])
    for (let i = 0; i < 240; i++) stepWorld(w, [{ jx: 1, jy: 0, press: false }, still], STEP, [])
    expect(w.k[0].x).toBeLessThanOrEqual(BOX.x1 - BODY + 0.001)
    expect(w.k[0].x).toBeGreaterThanOrEqual(BOX.x0 + BODY - 0.001)
  })

  it('the pause ends after REST seconds', () => {
    const w = newWorld()
    place(w, [500, 700, -Math.PI / 2], [500, 560, -Math.PI / 2])
    stepWorld(w, [still, still], STEP, [])
    expect(w.rest).toBeCloseTo(w.t + REST, 1)
  })
})

describe('fatal knights: fairness and feel', () => {
  it('two lances landing on the same step are a double: no point for either', () => {
    const w = newWorld()
    // Red faces east with its tip on blue's flank; blue faces west with its tip
    // on red's flank. Judged in list order, red used to take the point.
    place(w, [400, 900, 0], [522, 930, Math.PI])
    const ev: Ev[] = []
    const scorer = stepWorld(w, [still, still], STEP, ev)
    expect(scorer).toBeNull()
    expect(w.pts).toEqual([0, 0])
    expect(ev.some((e) => e.k === 'double')).toBe(true)
  })

  it('riding into the rail turns the horse away instead of pinning it there', () => {
    const w = newWorld()
    place(w, [BOX.x1 - BODY - 4, 900, 0], [500, 500, Math.PI / 2])
    w.k[0].v = SPEED
    for (let i = 0; i < 40; i++) stepWorld(w, [still, still], STEP, [])
    // It bounced off once and rolls back into the field, not glued to the rail
    // with its heading flipping every step.
    expect(w.k[0].x).toBeLessThan(BOX.x1 - BODY - 10)
    expect(Math.abs(Math.cos(w.k[0].a) + 1)).toBeLessThan(1e-6)
  })

  it('a charge spurred from a gallop runs faster than one from a standstill', () => {
    const top = (gallop: boolean): number => {
      const w = newWorld()
      place(w, [500, 1300, -Math.PI / 2], [900, 420, Math.PI / 2])
      const go: Drive = { jx: 0, jy: gallop ? -1 : 0, press: false }
      for (let i = 0; i < 60; i++) stepWorld(w, [go, still], STEP, [])
      let best = 0
      for (let i = 0; i < 30; i++) {
        stepWorld(w, [{ ...go, press: i === 0 }, still], STEP, [])
        best = Math.max(best, w.k[0].v)
      }
      return best
    }
    expect(top(true)).toBeGreaterThan(top(false) + 30)
  })

  it('a pass that drags on heats up: horses ride faster', () => {
    const w = newWorld()
    place(w, [500, 1300, -Math.PI / 2], [900, 420, Math.PI / 2])
    w.t = w.last + HEAT_T + 1
    const go: Drive = { jx: 0, jy: -1, press: false }
    for (let i = 0; i < 120; i++) stepWorld(w, [go, still], STEP, [])
    expect(w.k[0].v).toBeGreaterThan(SPEED * (1 + HEAT * 0.8))
  })
})

describe('fatal knights: bot', () => {
  it('hard out-jousts normal and easy in most seeded matches', () => {
    for (const weak of ['easy', 'normal'] as const) {
      let wins = 0
      for (let seed = 0; seed < 10; seed++) {
        const rng = new Rng(seed)
        const w = newWorld()
        const side = seed % 2
        const bots = [0, 1].map((s) => new KnightBot(rng.fork(), s === side ? 'hard' : weak))
        for (let i = 0; i < 60 * 240 && Math.max(...w.pts) < 3; i++)
          stepWorld(
            w,
            [0, 1].map((s) => bots[s]?.decide(w, s as 0 | 1, STEP) ?? still),
            STEP,
            [],
          )
        if ((w.pts[side] ?? 0) >= 3) wins++
      }
      expect(wins).toBeGreaterThanOrEqual(7)
    }
  })

  it('plays either side and always returns finite drives', () => {
    const w = newWorld()
    const bot = new KnightBot(new Rng(1), 'normal')
    for (const side of [0, 1] as const) {
      const d = bot.decide(w, side, STEP)
      expect(Number.isFinite(d.jx)).toBe(true)
      expect(Number.isFinite(d.jy)).toBe(true)
    }
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot gets to three points in bounded time (${d})`, () => {
      for (let seed = 0; seed < 3; seed++) {
        const rng = new Rng(seed)
        const w = newWorld()
        const bots = [new KnightBot(rng.fork(), d), new KnightBot(rng.fork(), d)]
        let steps = 0
        while (Math.max(...w.pts) < 3 && steps < 60 * 240) {
          const drives = [0, 1].map((s) => bots[s]?.decide(w, s as 0 | 1, STEP) ?? still)
          stepWorld(w, drives as Drive[], STEP, [])
          steps++
        }
        expect(Math.max(...w.pts)).toBe(3)
      }
    })
  }
})
