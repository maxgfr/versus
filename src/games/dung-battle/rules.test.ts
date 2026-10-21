import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { DungBot } from './bot.ts'
import {
  BALL_R0,
  BALL_RMAX,
  BEETLE_R,
  type Drive,
  type Ev,
  FIELD,
  flattens,
  newWorld,
  PELLET_R,
  PELLETS,
  RESPAWN,
  ROUND_T,
  roundWinner,
  stepWorld,
  topSpeed,
  type World,
  ballRadius,
} from './rules.ts'

const still: Drive[] = [
  { jx: 0, jy: 0 },
  { jx: 0, jy: 0 },
]

/** Remove the pellets and start both balls at their smallest size. */
function quiet(w: World): World {
  for (const p of w.pellets) p.on = false
  for (const bug of w.bugs) bug.ball.n = 0
  return w
}

function grow(w: World, side: 0 | 1, n: number): void {
  const bug = w.bugs[side]
  bug.ball.n = n
  bug.ball.r = ballRadius(n)
}

describe('dung battle layout', () => {
  it('lays the same pellets for the same seed, spaced out and clear of the start', () => {
    const a = newWorld(new Rng(3))
    const b = newWorld(new Rng(3))
    expect(a.pellets).toEqual(b.pellets)
    expect(a.pellets.length).toBeGreaterThan(PELLETS * 0.8)
    for (const p of a.pellets) {
      const k = Math.hypot((p.x - FIELD.cx) / FIELD.a, (p.y - FIELD.cy) / FIELD.b)
      expect(k).toBeLessThan(0.9)
    }
    for (let i = 0; i < a.pellets.length; i++)
      for (let j = i + 1; j < a.pellets.length; j++) {
        const p = a.pellets[i]
        const q = a.pellets[j]
        if (!p || !q) continue
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(96)
      }
  })

  it('starts each ball in front of its beetle, facing the middle', () => {
    const w = newWorld(new Rng(1))
    const [red, blue] = w.bugs
    expect(red.beetle.a).toBeCloseTo(-Math.PI / 2)
    expect(blue.beetle.a).toBeCloseTo(Math.PI / 2)
    expect(red.ball.y).toBeLessThan(red.beetle.y)
    expect(blue.ball.y).toBeGreaterThan(blue.beetle.y)
    expect(red.ball.r).toBe(BALL_R0)
  })
})

describe('dung battle growth and size', () => {
  it('grows with each pellet and stops at the maximum', () => {
    expect(ballRadius(0)).toBe(BALL_R0)
    expect(ballRadius(1000)).toBe(BALL_RMAX)
    expect(ballRadius(2)).toBeGreaterThan(ballRadius(1))
  })

  it('a rolling ball eats a pellet under it and the pellet comes back later', () => {
    const w = quiet(newWorld(new Rng(2)))
    const red = w.bugs[0]
    const p = { x: red.ball.x, y: red.ball.y, on: true, back: 0 }
    w.pellets.push(p)
    const ev: Ev[] = []
    stepWorld(w, still, STEP, ev)
    expect(red.ball.n).toBe(1)
    expect(red.ball.r).toBeGreaterThan(BALL_R0)
    expect(p.on).toBe(false)
    expect(ev.some((e) => e.k === 'eat' && e.side === 0)).toBe(true)
    // Move it off the ball's path so it is not simply eaten again when it returns.
    p.x = 700
    p.y = 1100
    for (let t = 0; t < RESPAWN * 60 + 2; t++) stepWorld(w, still, STEP, [])
    expect(p.on).toBe(true)
  })

  it('a pellet beside the ball is left alone', () => {
    const w = quiet(newWorld(new Rng(2)))
    const red = w.bugs[0]
    w.pellets.push({ x: red.ball.x + red.ball.r + PELLET_R * 3, y: red.ball.y, on: true, back: 0 })
    stepWorld(w, still, STEP, [])
    expect(red.ball.n).toBe(0)
  })

  it('heavier balls drive their beetle more slowly', () => {
    expect(topSpeed(BALL_RMAX)).toBeLessThan(topSpeed(BALL_R0))
  })
})

describe('dung battle collisions', () => {
  it('a ball more than 15% bigger flattens the other beetle', () => {
    const w = quiet(newWorld(new Rng(4)))
    grow(w, 0, 10)
    const [red, blue] = w.bugs
    blue.ball.x = red.ball.x
    blue.ball.y = red.ball.y + 60
    const ev: Ev[] = []
    stepWorld(w, still, STEP, ev)
    expect(w.flattened).toBe(1)
    expect(ev.some((e) => e.k === 'flatten' && e.side === 1)).toBe(true)
    expect(roundWinner(w)).toBe(0)
  })

  it('the 15% line: exactly 15% is not enough, just over is', () => {
    expect(flattens(46, 40)).toBe(false)
    expect(flattens(46.01, 40)).toBe(true)
    expect(flattens(40, 46)).toBe(false)
  })

  it('balls of similar size bounce instead of flattening', () => {
    const w = quiet(newWorld(new Rng(5)))
    const [red, blue] = w.bugs
    red.ball.vx = 0
    red.ball.vy = 0
    blue.ball.x = red.ball.x
    blue.ball.y = red.ball.y + BALL_R0 * 1.2
    blue.ball.vy = -200
    const ev: Ev[] = []
    stepWorld(w, still, STEP, ev)
    expect(w.flattened).toBeNull()
    expect(ev.some((e) => e.k === 'clash')).toBe(true)
    expect(roundWinner(w)).toBeNull()
  })

  it('beetles never sit inside the dish walls', () => {
    const w = quiet(newWorld(new Rng(6)))
    for (let i = 0; i < 900; i++) {
      const dir: Drive = { jx: Math.cos(i * 0.05), jy: Math.sin(i * 0.031) }
      stepWorld(w, [dir, dir], STEP, [])
      if (w.flattened !== null) break
    }
    for (const bug of w.bugs) {
      const k = Math.hypot(
        (bug.beetle.x - FIELD.cx) / (FIELD.a - BEETLE_R),
        (bug.beetle.y - FIELD.cy) / (FIELD.b - BEETLE_R),
      )
      expect(k).toBeLessThanOrEqual(1.0001)
    }
  })

  it('the beetle walks where the stick points', () => {
    const w = quiet(newWorld(new Rng(8)))
    const red = w.bugs[0]
    const x0 = red.beetle.x
    for (let i = 0; i < 60; i++) stepWorld(w, [{ jx: 1, jy: 0 }, still[1] as Drive], STEP, [])
    expect(red.beetle.x - x0).toBeGreaterThan(150)
    expect(Math.abs(red.beetle.y - w.bugs[0].beetle.y)).toBeLessThan(1)
  })
})

describe('dung battle round end', () => {
  it('the bigger ball wins a time-out; a level dish goes to the ball that grew last', () => {
    const w = quiet(newWorld(new Rng(9)))
    w.t = ROUND_T
    expect(roundWinner(w)).toBe('draw')
    grow(w, 1, 4)
    expect(roundWinner(w)).toBe(1)
    grow(w, 0, 4)
    w.bugs[0].ball.eat = 3
    w.bugs[1].ball.eat = 2
    expect(roundWinner(w)).toBe(0)
  })

  it('no winner while both are still rolling', () => {
    const w = quiet(newWorld(new Rng(10)))
    expect(roundWinner(w)).toBeNull()
  })
})

describe('dung battle bot', () => {
  it('plays either side, and stops when the round is over', () => {
    const w = newWorld(new Rng(11))
    const bot = new DungBot(new Rng(1), 'normal')
    for (const side of [0, 1] as const) {
      const d = bot.decide(w, side, STEP)
      expect(Number.isFinite(d.jx)).toBe(true)
      expect(Number.isFinite(d.jy)).toBe(true)
    }
    w.flattened = 0
    w.flatT = 0
    expect(bot.decide(w, 1, STEP)).toEqual({ jx: 0, jy: 0 })
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot reaches a result within the time limit (${d})`, () => {
      for (let seed = 0; seed < 4; seed++) {
        const rng = new Rng(seed)
        const w = newWorld(rng)
        const bots = [new DungBot(rng.fork(), d), new DungBot(rng.fork(), d)]
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * (ROUND_T + 5)) {
          const drives = [0, 1].map((s) => bots[s]?.decide(w, s as 0 | 1, STEP) ?? still[0])
          stepWorld(w, drives as Drive[], STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
        expect(steps).toBeLessThan(60 * (ROUND_T + 1))
      }
    })
  }
})
