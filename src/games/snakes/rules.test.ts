import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { SnakeBot } from './bot.ts'
import {
  type Bike,
  type Board,
  COLS,
  COUNT,
  type Ev,
  floodFrom,
  free,
  newBoard,
  QUEUE,
  queueTurn,
  ROWS,
  roundWinner,
  TICK,
  tick,
  WALL,
} from './rules.ts'

const idx = (x: number, y: number) => y * COLS + x

function bike(b: Board, id: number): Bike {
  const k = b.bikes[id]
  if (!k) throw new Error(`no bike ${id}`)
  return k
}

/** Put bike `id` on cell (x, y) heading `dir`, marking the cell as its trail. */
function put(b: Board, id: number, x: number, y: number, dir: number): void {
  const k = bike(b, id)
  k.x = x
  k.y = y
  k.dir = dir
  k.alive = true
  b.cells[idx(x, y)] = id + 1
}

/** A board with no trails on it, every cell free. */
function empty(teams = false): Board {
  const b = newBoard(teams, 0)
  b.cells.fill(0)
  return b
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard']

describe('board', () => {
  it('spawns red at the bottom and blue at the top, facing each other', () => {
    const b = newBoard(false, 0)
    const red = bike(b, 0)
    const blue = bike(b, 1)
    expect(red.side).toBe(0)
    expect(red.y).toBeGreaterThan(ROWS / 2)
    expect(red.dir).toBe(0)
    expect(blue.side).toBe(1)
    expect(blue.y).toBeLessThan(ROWS / 2)
    expect(blue.dir).toBe(2)
    // Point symmetric through the middle of the board.
    expect(COLS - 1 - red.x).toBe(blue.x)
    expect(ROWS - 1 - red.y).toBe(blue.y)
    expect(b.cells[idx(red.x, red.y)]).toBe(red.id + 1)
    expect(b.go).toBeCloseTo(COUNT, 9)
  })

  it('spawns four bikes in teams, two per side, lane by lane', () => {
    const b = newBoard(true, 0)
    expect(b.bikes.length).toBe(4)
    expect(b.bikes.filter((k) => k.side === 0).map((k) => k.lane)).toEqual([0, 1])
    expect(b.bikes.filter((k) => k.side === 1).map((k) => k.lane)).toEqual([0, 1])
    expect(new Set(b.cells.filter((c) => c > 0 && c !== WALL)).size).toBe(4)
  })

  it('floods through free cells, and counts a blocked cell as taken', () => {
    const b = empty()
    // A wall of trail across row 5, open only at x = 0.
    for (let x = 1; x < COLS; x++) b.cells[idx(x, 5)] = 99
    const free_cells = 5 * COLS + 1 + (ROWS - 6) * COLS
    expect(floodFrom(b, 3, 4, 10_000)).toBe(free_cells)
    expect(floodFrom(b, 3, 6, 10_000)).toBe(free_cells)
    // Block the gap: below the wall no longer reaches the top.
    expect(floodFrom(b, 3, 6, 10_000, idx(0, 5))).toBe((ROWS - 6) * COLS)
    expect(floodFrom(b, 3, 4, 10_000, idx(0, 5))).toBe(5 * COLS)
  })

  it('stops counting at the cap', () => {
    expect(floodFrom(empty(), 0, 0, 25)).toBe(25)
  })

  it('treats the outside of the board as a wall', () => {
    const b = empty()
    expect(free(b, -1, 0)).toBe(false)
    expect(free(b, COLS, 0)).toBe(false)
    expect(free(b, 0, 0)).toBe(true)
  })
})

describe('moving and turning', () => {
  it('moves one cell per tick in the heading, leaving a trail', () => {
    const b = empty()
    put(b, 0, 10, 20, 0)
    tick(b, 0, [])
    expect(bike(b, 0).y).toBe(19)
    expect(b.cells[idx(10, 19)]).toBe(1)
    expect(b.cells[idx(10, 20)]).toBe(1)
  })

  it('applies a queued turn on the next tick, then keeps going', () => {
    const b = empty()
    put(b, 0, 10, 20, 0)
    queueTurn(bike(b, 0), 1)
    const ev: Ev[] = []
    tick(b, 0, ev)
    expect(bike(b, 0).dir).toBe(1)
    expect(bike(b, 0).x).toBe(11)
    expect(ev.some((e) => e.k === 'turn' && e.side === 0)).toBe(true)
  })

  it('holds at most QUEUE turns', () => {
    const b = empty()
    put(b, 0, 10, 20, 0)
    for (let i = 0; i < 5; i++) queueTurn(bike(b, 0), 1)
    expect(bike(b, 0).q.length).toBe(QUEUE)
  })

  it('crashes into the outer wall, and the other side wins', () => {
    const b = empty()
    put(b, 0, 10, 0, 0)
    put(b, 1, 3, 15, 2)
    const ev: Ev[] = []
    expect(tick(b, 1, ev)).toBe(1)
    expect(bike(b, 0).alive).toBe(false)
    expect(bike(b, 0).diedT).toBe(1)
    expect(ev.some((e) => e.k === 'crash' && e.side === 0)).toBe(true)
  })

  it('crashes into any trail', () => {
    const b = empty()
    put(b, 0, 10, 20, 0)
    b.cells[idx(10, 19)] = 9
    expect(tick(b, 0, [])).toBe(1)
    expect(bike(b, 0).alive).toBe(false)
  })

  it('turning back onto its own trail crashes the bike', () => {
    const b = empty()
    put(b, 0, 10, 20, 0)
    // North, then right, right, and right again: the last turn points west into its own trail.
    tick(b, 0, [])
    queueTurn(bike(b, 0), 1)
    tick(b, 0, [])
    queueTurn(bike(b, 0), 1)
    tick(b, 0, [])
    expect(bike(b, 0).alive).toBe(true)
    queueTurn(bike(b, 0), 1)
    expect(tick(b, 0, [])).toBe(1)
    expect(bike(b, 0).alive).toBe(false)
  })

  it('two bikes entering the same cell both crash: a draw', () => {
    const b = empty()
    put(b, 0, 10, 20, 0) // moves to (10, 19)
    put(b, 1, 9, 19, 1) // moves to (10, 19)
    expect(tick(b, 0, [])).toBe('draw')
    expect(b.bikes.every((k) => !k.alive)).toBe(true)
  })

  it('bikes swapping cells crash too', () => {
    const b = empty()
    put(b, 0, 10, 20, 0)
    put(b, 1, 10, 19, 2)
    // Red wants blue's head cell and blue wants red's: both run into a trail.
    expect(tick(b, 0, [])).toBe('draw')
  })

  it('a side is out when all of its bikes are dead', () => {
    const b = empty(true)
    expect(roundWinner(b)).toBeNull()
    bike(b, 0).alive = false
    expect(roundWinner(b)).toBeNull()
    bike(b, 1).alive = false
    expect(roundWinner(b)).toBe(1)
    bike(b, 2).alive = false
    expect(roundWinner(b)).toBe(1)
    bike(b, 3).alive = false
    expect(roundWinner(b)).toBe('draw')
  })
})

describe('bots', () => {
  it('will not turn into a dead end when open space is one turn away', () => {
    const b = empty()
    // Everything taken except a big open room on the left and a 2-cell dead-end corridor on the right.
    b.cells.fill(99)
    for (let y = 0; y <= 12; y++) for (let x = 0; x <= 6; x++) b.cells[idx(x, y)] = 0
    for (let x = 7; x <= 8; x++) b.cells[idx(x, 5)] = 0
    put(b, 0, 6, 5, 0)
    const bot = SnakeBot.of(new Rng(1), 'normal')
    // Straight (6,4) and left (5,5) lead into the room; right (7,5) into the corridor.
    expect(bot.choose(b, 0)).not.toBe(1)
  })

  it('never turns into a wall it is already facing', () => {
    const b = empty()
    put(b, 0, 10, 0, 0)
    for (const d of DIFFS) {
      const bot = SnakeBot.of(new Rng(3), d)
      for (let i = 0; i < 20; i++) expect(bot.choose(b, 0)).not.toBe(0)
    }
  })

  for (const d of DIFFS) {
    it(`bots finish a round in bounded time (${d})`, () => {
      for (let seed = 1; seed <= 4; seed++) {
        const b = newBoard(false, 0)
        const rng = new Rng(seed)
        const bots = b.bikes.map(() => SnakeBot.of(rng.fork(), d))
        let t = 0
        let winner: ReturnType<typeof tick> = null
        for (let i = 0; i < 60 * 300 && winner === null; i++) {
          t += STEP
          if (t < COUNT) continue
          b.acc += STEP
          while (b.acc >= TICK && winner === null) {
            b.acc -= TICK
            for (const k of b.bikes) {
              if (!k.alive) continue
              const turn = (bots[k.id] as SnakeBot).choose(b, k.id)
              if (turn !== 0) queueTurn(k, turn as 1 | -1)
            }
            winner = tick(b, t, [])
          }
        }
        expect(winner).not.toBeNull()
      }
    })
  }

  it('bots finish a teams round too', () => {
    const b = newBoard(true, 0)
    const rng = new Rng(9)
    const bots = b.bikes.map(() => SnakeBot.of(rng.fork(), 'normal'))
    let winner: ReturnType<typeof tick> = null
    for (let i = 0; i < 2000 && winner === null; i++) {
      for (const k of b.bikes) {
        if (!k.alive) continue
        const turn = (bots[k.id] as SnakeBot).choose(b, k.id)
        if (turn !== 0) queueTurn(k, turn as 1 | -1)
      }
      winner = tick(b, i * TICK, [])
    }
    expect(winner).not.toBeNull()
  })
})
