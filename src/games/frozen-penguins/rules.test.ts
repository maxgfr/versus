import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { PenguinBot } from './bot.ts'
import {
  DASH_CD,
  DASH_V,
  type Drive,
  type Ev,
  FLOE,
  floeR,
  newWorld,
  R0,
  roundWinner,
  stepWorld,
  type World,
} from './rules.ts'

const still: Drive = { jx: 0, jy: 0, press: false }

/** Put both penguins where we want them (red first). */
function place(w: World, red: [number, number], blue: [number, number]): void {
  w.p[0] = { ...w.p[0], x: red[0], y: red[1], vx: 0, vy: 0, fell: -1 }
  w.p[1] = { ...w.p[1], x: blue[0], y: blue[1], vx: 0, vy: 0, fell: -1 }
}

describe('frozen penguins: the ice', () => {
  it('the floe melts a little every second, and is gone in the end', () => {
    expect(floeR(0)).toBe(R0)
    expect(floeR(10)).toBeLessThan(R0)
    expect(floeR(10)).toBeGreaterThan(floeR(20))
    expect(floeR(10000)).toBe(0)
  })

  it('a penguin whose middle goes past the edge falls, and the other one wins', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy], [FLOE.cx + R0 + 60, FLOE.cy])
    const ev: Ev[] = []
    stepWorld(w, [still, still], STEP, ev)
    expect(ev.some((e) => e.k === 'fall' && e.side === 1)).toBe(true)
    expect(roundWinner(w)).toBe(0)
  })

  it('a penguin still inside the edge stays on the ice', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy], [FLOE.cx, FLOE.cy - 200])
    stepWorld(w, [still, still], STEP, [])
    expect(roundWinner(w)).toBeNull()
  })

  it('both falling in the same step is a draw', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy + R0 + 60], [FLOE.cx, FLOE.cy - R0 - 60])
    w.t = 0
    w.p[0].fell = 0
    w.p[1].fell = 0
    expect(roundWinner(w)).toBe('draw')
  })

  it('the melting edge takes a penguin that was safe a few seconds before', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy + 380], [FLOE.cx, FLOE.cy - 380])
    stepWorld(w, [still, still], STEP, [])
    expect(roundWinner(w)).toBeNull()
    while (roundWinner(w) === null && w.t < 200) stepWorld(w, [still, still], STEP, [])
    expect(roundWinner(w)).not.toBeNull()
    expect(w.t).toBeLessThan(120)
  })
})

describe('frozen penguins: sliding', () => {
  it('a penguin keeps sliding after the stick is let go (low friction)', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy], [FLOE.cx, FLOE.cy - 300])
    for (let i = 0; i < 30; i++) stepWorld(w, [{ jx: 1, jy: 0, press: false }, still], STEP, [])
    const v0 = Math.hypot(w.p[0].vx, w.p[0].vy)
    for (let i = 0; i < 60; i++) stepWorld(w, [still, still], STEP, [])
    expect(Math.hypot(w.p[0].vx, w.p[0].vy)).toBeGreaterThan(v0 * 0.4)
  })

  it('speed is capped', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy], [FLOE.cx, FLOE.cy - 300])
    for (let i = 0; i < 600; i++) stepWorld(w, [{ jx: 1, jy: 0, press: false }, still], STEP, [])
    expect(Math.hypot(w.p[0].vx, w.p[0].vy)).toBeLessThanOrEqual(600)
  })

  it('a dash bursts forward and cannot be repeated until the cooldown is over', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy], [FLOE.cx, FLOE.cy - 300])
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 1, jy: 0, press: true }, still], STEP, ev)
    expect(ev.some((e) => e.k === 'dash' && e.side === 0)).toBe(true)
    expect(w.p[0].vx).toBeGreaterThan(DASH_V * 0.9)
    expect(w.p[0].ready).toBeCloseTo(w.t + DASH_CD, 1)
    const again: Ev[] = []
    stepWorld(w, [{ jx: 1, jy: 0, press: true }, still], STEP, again)
    expect(again.some((e) => e.k === 'dash')).toBe(false)
  })
})

describe('frozen penguins: bumping', () => {
  it('two penguins that meet head on bounce apart and make a bump', () => {
    const w = newWorld()
    place(w, [FLOE.cx, FLOE.cy - 25], [FLOE.cx, FLOE.cy + 25])
    w.p[0].vy = 300
    w.p[1].vy = -300
    const ev: Ev[] = []
    stepWorld(w, [still, still], STEP, ev)
    expect(ev.some((e) => e.k === 'bump')).toBe(true)
    expect(w.p[0].vy).toBeLessThan(0)
    expect(w.p[1].vy).toBeGreaterThan(0)
  })
})

describe('frozen penguins: bot', () => {
  it('plays either side and stops once it has fallen', () => {
    const w = newWorld()
    const bot = new PenguinBot(new Rng(1), 'normal')
    for (const side of [0, 1] as const) {
      const d = bot.decide(w, side, STEP)
      expect(Number.isFinite(d.jx)).toBe(true)
      expect(Number.isFinite(d.jy)).toBe(true)
    }
    w.p[0].fell = 1
    expect(bot.decide(w, 0, STEP)).toEqual({ jx: 0, jy: 0, press: false })
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot ends the round in bounded time (${d})`, () => {
      for (let seed = 0; seed < 4; seed++) {
        const rng = new Rng(seed)
        const w = newWorld()
        const bots = [new PenguinBot(rng.fork(), d), new PenguinBot(rng.fork(), d)]
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * 120) {
          const drives = [0, 1].map((s) => bots[s]?.decide(w, s as 0 | 1, STEP) ?? still)
          stepWorld(w, drives as Drive[], STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
        expect(steps).toBeLessThan(60 * 120)
      }
    })
  }
})
