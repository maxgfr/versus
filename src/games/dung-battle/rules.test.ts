import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { DungBot, reachable } from './bot.ts'
import {
  BALL_R0,
  BALL_RMAX,
  BALL_VMAX,
  BEETLE_R,
  DASH_CD,
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
  rimK,
  tether,
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

describe('dung battle physics edge cases', () => {
  it('a ball shoved against the rim never ends a step poking through it', () => {
    // Bug: collisions ran after the rim check, so a beetle could shove a rival
    // ball past the lip for a frame.
    const w = quiet(newWorld(new Rng(1)))
    const [red, blue] = w.bugs
    blue.ball.x = FIELD.cx + FIELD.a - blue.ball.r - 0.5
    blue.ball.y = FIELD.cy
    blue.beetle.x = FIELD.cx - 200
    blue.beetle.y = FIELD.cy - 300
    red.beetle.x = blue.ball.x - blue.ball.r - BEETLE_R + 8
    red.beetle.y = FIELD.cy
    red.beetle.vx = 300
    red.beetle.a = 0
    red.ball.x = red.beetle.x
    red.ball.y = FIELD.cy + 200
    stepWorld(w, [{ jx: 1, jy: 0 }, still[1] as Drive], STEP, [])
    expect(rimK(blue.ball.x, blue.ball.y, blue.ball.r)).toBeLessThanOrEqual(1.0001)
    expect(rimK(red.beetle.x, red.beetle.y, BEETLE_R)).toBeLessThanOrEqual(1.0001)
  })

  it('two beetles dead on top of each other are parted', () => {
    // Bug: a zero-length contact normal left them stuck inside each other.
    const w = quiet(newWorld(new Rng(1)))
    const [red, blue] = w.bugs
    blue.beetle.x = red.beetle.x
    blue.beetle.y = red.beetle.y
    blue.ball.x = 200
    blue.ball.y = 700
    stepWorld(w, still, STEP, [])
    const d = Math.hypot(red.beetle.x - blue.beetle.x, red.beetle.y - blue.beetle.y)
    expect(d).toBeGreaterThanOrEqual(BEETLE_R * 2 - 0.01)
  })

  it('a knocked-back beetle keeps facing where its stick points', () => {
    // Bug: the heading chased the velocity, so a knock spun the beetle (and its ball) round.
    const w = quiet(newWorld(new Rng(1)))
    const red = w.bugs[0]
    red.beetle.vy = 500
    const a0 = red.beetle.a
    for (let i = 0; i < 12; i++) stepWorld(w, [{ jx: 0, jy: -1 }, still[1] as Drive], STEP, [])
    expect(Math.abs(red.beetle.a - a0)).toBeLessThan(0.05)
  })

  it('ignores a broken stick reading instead of poisoning the world', () => {
    const w = quiet(newWorld(new Rng(1)))
    stepWorld(w, [{ jx: Number.NaN, jy: 1, dash: Number.NaN }, still[1] as Drive], STEP, [])
    for (const bug of w.bugs) {
      expect(Number.isFinite(bug.beetle.x + bug.beetle.y + bug.ball.x + bug.ball.y)).toBe(true)
    }
  })

  it('nothing escapes the dish or tunnels under hard, repeated charges', () => {
    const w = quiet(newWorld(new Rng(12)))
    grow(w, 0, 6)
    for (let i = 0; i < 60 * 20; i++) {
      const a = i * 0.07
      const d: Drive[] = [
        { jx: Math.cos(a), jy: Math.sin(a), dash: 1 },
        { jx: -Math.cos(a * 1.3), jy: Math.sin(a * 0.9), dash: 1 },
      ]
      stepWorld(w, d, STEP, [])
      if (w.flattened !== null) break
      for (const bug of w.bugs) {
        expect(rimK(bug.beetle.x, bug.beetle.y, BEETLE_R)).toBeLessThanOrEqual(1.0001)
        expect(rimK(bug.ball.x, bug.ball.y, bug.ball.r)).toBeLessThanOrEqual(1.0001)
        expect(Math.hypot(bug.ball.vx, bug.ball.vy)).toBeLessThanOrEqual(BALL_VMAX + 1e-6)
      }
    }
  })

  it('a flatten on the last step beats the time limit', () => {
    const w = quiet(newWorld(new Rng(4)))
    grow(w, 0, 10)
    const [red, blue] = w.bugs
    w.t = ROUND_T - STEP / 2
    blue.ball.x = red.ball.x
    blue.ball.y = red.ball.y + 60
    stepWorld(w, still, STEP, [])
    expect(w.flattened).toBe(1)
    expect(roundWinner(w)).toBe(0)
  })

  it('a time-out with equal balls that grew on the same step is a draw', () => {
    const w = quiet(newWorld(new Rng(9)))
    grow(w, 0, 3)
    grow(w, 1, 3)
    w.bugs[0].ball.eat = 5
    w.bugs[1].ball.eat = 5
    w.t = ROUND_T
    expect(roundWinner(w)).toBe('draw')
  })
})

describe('dung battle charge', () => {
  /** Red charging up the dish from a standstill, with its ball square in front. */
  function charge(power: number): { w: World; ev: Ev[] } {
    const w = quiet(newWorld(new Rng(3)))
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: -1, dash: power }, still[1] as Drive], STEP, ev)
    return { w, ev }
  }

  it('a flick lunges the beetle and shoves its ball ahead, harder for a faster flick', () => {
    const soft = charge(0)
    const hard = charge(1)
    expect(soft.ev.some((e) => e.k === 'dash' && e.side === 0)).toBe(true)
    const sb = -soft.w.bugs[0].beetle.vy
    const hb = -hard.w.bugs[0].beetle.vy
    expect(sb).toBeGreaterThan(topSpeed(BALL_R0))
    expect(hb).toBeGreaterThan(sb + 300)
    expect(-hard.w.bugs[0].ball.vy).toBeGreaterThan(-soft.w.bugs[0].ball.vy + 300)
  })

  it('a charge then needs a cooldown before the next', () => {
    const { w } = charge(1)
    const ev: Ev[] = []
    for (let i = 0; i < Math.floor(DASH_CD * 60) - 2; i++)
      stepWorld(w, [{ jx: 0, jy: 1, dash: 1 }, still[1] as Drive], STEP, ev)
    expect(ev.some((e) => e.k === 'dash')).toBe(false)
    for (let i = 0; i < 4; i++)
      stepWorld(w, [{ jx: 0, jy: 1, dash: 1 }, still[1] as Drive], STEP, ev)
    expect(ev.filter((e) => e.k === 'dash').length).toBe(1)
  })

  it('a resting stick cannot charge', () => {
    const w = quiet(newWorld(new Rng(3)))
    const ev: Ev[] = []
    stepWorld(w, [{ jx: 0, jy: 0, dash: 1 }, still[1] as Drive], STEP, ev)
    expect(ev.some((e) => e.k === 'dash')).toBe(false)
  })

  it('a charged ball can flatten a smaller one from a distance', () => {
    const w = quiet(newWorld(new Rng(3)))
    grow(w, 0, 8)
    const [red, blue] = w.bugs
    // Blue sits still, its ball tucked in front of it, 120 units up the dish from red's.
    blue.ball.x = red.ball.x
    blue.ball.y = red.ball.y - red.ball.r - blue.ball.r - 120
    blue.beetle.x = blue.ball.x
    blue.beetle.y = blue.ball.y - tether(blue.ball.r)
    blue.beetle.a = Math.PI / 2
    let steps = 0
    stepWorld(w, [{ jx: 0, jy: -1, dash: 1 }, still[1] as Drive], STEP, [])
    while (w.flattened === null && steps++ < 30) stepWorld(w, still, STEP, [])
    expect(w.flattened).toBe(1)
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

  it('only aims at pellets its ball can actually reach', () => {
    const edge = { x: FIELD.cx + FIELD.a - 10, y: FIELD.cy }
    expect(reachable(edge, BALL_R0)).toBe(true)
    expect(reachable(edge, BALL_RMAX)).toBe(false)
    expect(reachable({ x: FIELD.cx, y: FIELD.cy }, BALL_RMAX)).toBe(true)
  })

  it('uses charges on normal and hard but not on easy', () => {
    for (const [d, any] of [
      ['easy', false],
      ['hard', true],
    ] as const) {
      const rng = new Rng(21)
      const w = newWorld(rng)
      const bots = [new DungBot(rng.fork(), d), new DungBot(rng.fork(), d)]
      let dashes = 0
      for (let i = 0; i < 60 * 20 && roundWinner(w) === null; i++) {
        const ev: Ev[] = []
        const drives = [0, 1].map((s) => bots[s]?.decide(w, s as 0 | 1, STEP) ?? still[0])
        stepWorld(w, drives as Drive[], STEP, ev)
        dashes += ev.filter((e) => e.k === 'dash').length
      }
      expect(dashes > 0).toBe(any)
    }
  })

  it('a clear spread: hard beats normal, which beats easy, over many rounds', () => {
    const rate = (a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard'): number => {
      let won = 0
      const N = 120
      for (let s = 0; s < N; s++) {
        const swap = s % 2 === 1
        const rng = new Rng(900 + s)
        const w = newWorld(rng)
        const bots = [new DungBot(rng.fork(), swap ? b : a), new DungBot(rng.fork(), swap ? a : b)]
        for (let i = 0; i < 60 * (ROUND_T + 1) && roundWinner(w) === null; i++) {
          const drives = [0, 1].map((x) => bots[x]?.decide(w, x as 0 | 1, STEP) ?? still[0])
          stepWorld(w, drives as Drive[], STEP, [])
        }
        if (roundWinner(w) === (swap ? 1 : 0)) won++
      }
      return won / N
    }
    expect(rate('hard', 'easy')).toBeGreaterThan(0.68)
    expect(rate('normal', 'easy')).toBeGreaterThan(0.6)
    expect(rate('hard', 'normal')).toBeGreaterThan(0.52)
  }, 30000)

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
