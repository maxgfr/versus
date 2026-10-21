import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { NeonBot } from './bot.ts'
import {
  type Board,
  COLS,
  COUNT,
  type Ev,
  foodDistance,
  newBoard,
  room,
  ROWS,
  roundWinner,
  type Snake,
  TICK,
  tick,
  want,
} from './rules.ts'

function snake(b: Board, side: 0 | 1): Snake {
  const s = b.snakes[side]
  if (!s) throw new Error('no snake')
  return s
}

/** Clear the dots and set snake `side` to a straight body from (x, y), with `len` cells going backwards. */
function place(b: Board, side: 0 | 1, x: number, y: number, dir: number, len = 3): void {
  const s = snake(b, side)
  const back = (dir + 2) % 4
  s.body = Array.from({ length: len }, (_, i) => ({
    x: x + (DXs[back] ?? 0) * i,
    y: y + (DYs[back] ?? 0) * i,
  }))
  s.dir = dir
  s.want = dir
  s.alive = true
  s.diedT = -1
}
const DXs = [0, 1, 0, -1]
const DYs = [-1, 0, 1, 0]

/** A board far from everything: no dots, snakes well apart. */
function quiet(seed = 1): Board {
  const b = newBoard(0, new Rng(seed))
  b.dots = []
  place(b, 0, 4, 20, 0)
  place(b, 1, 13, 7, 2)
  return b
}

describe('board', () => {
  it('starts two snakes of three cells, point symmetric, with dots on free cells', () => {
    const b = newBoard(0, new Rng(4))
    const [red, blue] = b.snakes
    expect(red.body.length).toBe(3)
    expect(blue.body.length).toBe(3)
    expect(COLS - 1 - (red.body[0]?.x ?? -1)).toBe(blue.body[0]?.x)
    expect(ROWS - 1 - (red.body[0]?.y ?? -1)).toBe(blue.body[0]?.y)
    expect(b.dots.length).toBe(3)
    for (const d of b.dots) {
      expect(b.snakes.some((s) => s.body.some((c) => c.x === d.x && c.y === d.y))).toBe(false)
    }
    expect(b.go).toBeCloseTo(COUNT, 9)
  })

  it('counts open space and the way to the nearest dot', () => {
    const b = quiet()
    b.dots = [{ x: 4, y: 17 }]
    expect(foodDistance(b, 4, 18)).toBe(1)
    expect(room(b, 1, 1)).toBeGreaterThan(100)
  })
})

describe('moving', () => {
  it('moves one cell per tick, keeping the length when no dot is eaten', () => {
    const b = quiet()
    const head = { ...snake(b, 0).body[0] }
    tick(b, 0, [], new Rng(1))
    expect(snake(b, 0).body[0]).toEqual({ x: head.x, y: (head.y ?? 0) - 1 })
    expect(snake(b, 0).body.length).toBe(3)
  })

  it('a reversal request is ignored', () => {
    const b = quiet()
    want(snake(b, 0), 2)
    expect(snake(b, 0).want).toBe(0)
    want(snake(b, 0), 1)
    expect(snake(b, 0).want).toBe(1)
  })

  it('eating a dot grows the snake and puts a new dot down', () => {
    const b = quiet()
    b.dots = [{ x: 4, y: 19 }]
    const ev: Ev[] = []
    tick(b, 0, ev, new Rng(2))
    expect(snake(b, 0).body.length).toBe(4)
    expect(snake(b, 0).eaten).toBe(1)
    expect(ev.some((e) => e.k === 'eat' && e.side === 0)).toBe(true)
    expect(b.dots.length).toBe(1)
    expect(b.dots.some((d) => d.x === 4 && d.y === 19)).toBe(false)
  })

  it('running off the board crashes the snake, and the other side wins', () => {
    const b = quiet()
    place(b, 0, 4, 0, 0)
    const ev: Ev[] = []
    expect(tick(b, 1, ev, new Rng(1))).toBe(1)
    expect(snake(b, 0).alive).toBe(false)
    expect(snake(b, 0).diedT).toBe(1)
    expect(ev.some((e) => e.k === 'crash' && e.side === 0)).toBe(true)
  })

  it('running into its own body crashes', () => {
    const b = quiet()
    // A tight loop: the head is about to step onto its own tail.
    const s = snake(b, 0)
    s.body = [
      { x: 5, y: 10 },
      { x: 6, y: 10 },
      { x: 6, y: 11 },
      { x: 5, y: 11 },
    ]
    s.dir = 2
    s.want = 2
    expect(tick(b, 0, [], new Rng(1))).toBe(1)
    expect(s.alive).toBe(false)
  })

  it('entering the other snake crashes only the one that entered', () => {
    const b = quiet()
    place(b, 1, 9, 10, 0)
    place(b, 0, 9, 12, 0)
    // Red runs up into blue's body at (9, 9)? Blue's body is (9,10),(9,11),(9,12): red's head moves to (9,11) first.
    const winner = tick(b, 0, [], new Rng(1))
    expect(snake(b, 0).alive).toBe(false)
    expect(snake(b, 1).alive).toBe(true)
    expect(winner).toBe(1)
  })

  it('two heads on the same cell crash together: a draw', () => {
    const b = quiet()
    place(b, 0, 8, 12, 2)
    place(b, 1, 8, 14, 0)
    expect(tick(b, 0, [], new Rng(1))).toBe('draw')
    expect(snake(b, 0).alive).toBe(false)
    expect(snake(b, 1).alive).toBe(false)
  })

  it('the round is decided only once a snake is out', () => {
    const b = quiet()
    expect(roundWinner(b)).toBeNull()
    snake(b, 1).alive = false
    expect(roundWinner(b)).toBe(0)
  })

  it('a dead snake no longer moves', () => {
    const b = quiet()
    snake(b, 0).alive = false
    const head = snake(b, 0).body[0]
    tick(b, 0, [], new Rng(1))
    expect(snake(b, 0).body[0]).toEqual(head)
  })

  it('ticks are a fixed interval', () => {
    expect(TICK).toBeGreaterThan(STEP)
  })
})

describe('bots', () => {
  it('avoids the dead-end corridor when open space is available', () => {
    const b = quiet()
    // Walls everywhere except a big room on the left and a 2-cell dead end on the right.
    b.dots = []
    b.snakes[0].alive = true
    place(b, 0, 9, 14, 0, 3)
    const taken = new Set<number>()
    for (const s of b.snakes) for (const c of s.body) taken.add(c.y * COLS + c.x)
    b.snakes[1].alive = false
    // Block everything except the cells we want open.
    const open = new Set<number>()
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) open.add(y * COLS + x)
    for (const i of [6 * COLS + 0]) open.add(i)
    open.add(14 * COLS + 10)
    open.add(14 * COLS + 11)
    // Enclose the snake: head at (9,14) heading north, corridor east at (10,14),(11,14).
    b.snakes[0].body = [
      { x: 9, y: 14 },
      { x: 9, y: 15 },
      { x: 9, y: 16 },
    ]
    b.snakes[0].dir = 0
    b.snakes[0].want = 0
    const blocked = new Set<number>(open)
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x
        if (!blocked.has(i) && !taken.has(i)) {
          // Walls: occupy by a body segment of the dead snake.
          b.snakes[1].body.push({ x, y })
        }
      }
    b.snakes[1].body = b.snakes[1].body.slice(0, 1)
    const bot = NeonBot.of(new Rng(1), 'normal')
    const d = bot.choose(b, 0)
    // Only north (9,13) and west/east (8,14),(10,14) are candidates; east is the corridor.
    expect(d).not.toBe(1)
  })

  for (const d of ['easy', 'normal', 'hard'] as const satisfies readonly Difficulty[]) {
    it(`bots finish a round in bounded time (${d})`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const rng = new Rng(seed)
        const b = newBoard(0, rng)
        const bots = [NeonBot.of(rng.fork(), d), NeonBot.of(rng.fork(), d)]
        let t = 0
        let winner: ReturnType<typeof tick> = null
        for (let i = 0; i < 60 * 400 && winner === null; i++) {
          t += STEP
          if (t < COUNT) continue
          b.acc += STEP
          while (b.acc >= TICK && winner === null) {
            b.acc -= TICK
            for (const side of [0, 1] as const) {
              const dir = (bots[side] as NeonBot).choose(b, side)
              if (dir !== null) want(snake(b, side), dir)
            }
            winner = tick(b, t, [], rng)
          }
        }
        expect(winner).not.toBeNull()
      }
    })
  }
})
