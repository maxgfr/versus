import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { TileBot } from './bot.ts'
import {
  type Board,
  COLS,
  CRACK,
  DROP,
  type Ev,
  GONE,
  HOLES,
  INTACT,
  nearestTile,
  newBoard,
  REACH,
  ROWS,
  STAND,
  stepBoard,
  supported,
  TILE,
  tileAt,
  tileCentre,
  X0,
} from './rules.ts'

const NONE: [number, number][] = [
  [0, 0],
  [0, 0],
]

/** Put a side's body at tile `i`'s centre, the way a finger walking there would. */
function place(b: Board, side: 0 | 1, i: number): void {
  const c = tileCentre(i)
  const p = b.p[side]
  p.x = c.x
  p.y = c.y
}

/** Run `secs` of play with the given stick vectors; returns the events and the last winner. */
function run(
  b: Board,
  dirs: [number, number][],
  secs: number,
  from: number,
  ev: Ev[] = [],
): { ev: Ev[]; winner: ReturnType<typeof stepBoard>; t: number } {
  let t = from
  let winner: ReturnType<typeof stepBoard> = null
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    winner = stepBoard(b, dirs, STEP, t, ev)
    t += STEP
  }
  return { ev, winner, t }
}

describe('board geometry', () => {
  it('finds the tile under a point and nothing in the gaps', () => {
    for (let i = 0; i < COLS * ROWS; i++) {
      const c = tileCentre(i)
      expect(tileAt(c.x, c.y)).toBe(i)
      expect(nearestTile(c.x, c.y)).toBe(i)
    }
    // Halfway through the gap between tile 0 and tile 1.
    const gap = X0 + TILE + 7
    expect(tileAt(gap, tileCentre(0).y)).toBe(-1)
    expect(tileAt(X0 - 5, 900)).toBe(-1)
    expect(tileAt(500, -5)).toBe(-1)
  })

  it('starts with every tile but the two notches intact and both bodies alive on their own tile', () => {
    const b = newBoard(0)
    expect(b.st.every((s, i) => s === (HOLES.includes(i) ? GONE : INTACT))).toBe(true)
    expect(b.p.every((p) => p.alive && p.tile >= 0)).toBe(true)
    expect(b.p[0].tile).not.toBe(b.p[1].tile)
  })
})

describe('tiles', () => {
  it('cracks the tile you step off and drops it DROP seconds later', () => {
    const b = newBoard(0)
    const from = b.p[0].tile
    const to = from - 1
    place(b, 0, to)
    const ev: Ev[] = []
    const { t } = run(b, NONE, STEP, 0, ev)
    expect(b.p[0].tile).toBe(to)
    expect(b.st[from]).toBe(CRACK)
    expect(ev.some((e) => e.k === 'crack' && e.i === from && !e.stand)).toBe(true)
    // Still standing just before the deadline, gone right after it.
    const crackAt = b.t[from] ?? -1
    const drops: number[] = []
    let now = t
    for (let i = 0; i < 60; i++) {
      const e: Ev[] = []
      stepBoard(b, NONE, STEP, now, e)
      if (e.some((x) => x.k === 'drop' && x.i === from)) drops.push(now)
      now += STEP
    }
    expect(drops.length).toBe(1)
    expect((drops[0] ?? 0) - crackAt).toBeGreaterThanOrEqual(DROP - 1e-9)
    expect((drops[0] ?? 0) - crackAt).toBeLessThan(DROP + STEP * 2)
    expect(b.st[from]).toBe(GONE)
    // The body on the neighbour tile is fine.
    expect(b.p[0].alive).toBe(true)
  })

  it('does not crack a tile the other body still stands on', () => {
    const b = newBoard(0)
    const shared = b.p[0].tile
    // Blue walks onto red's tile and red steps off it.
    place(b, 1, shared)
    b.p[1].tile = shared
    place(b, 0, shared - 1)
    run(b, NONE, 0.2, 0)
    expect(b.st[shared]).toBe(INTACT)
  })

  it('cracks a tile under someone who stands still for STAND seconds, and they fall DROP later', () => {
    const b = newBoard(0)
    b.p[1].alive = false
    b.p[1].fallT = 0
    const tile = b.p[0].tile
    const ev: Ev[] = []
    const { t } = run(b, NONE, STAND - STEP, 0, ev)
    expect(b.st[tile]).toBe(INTACT)
    run(b, NONE, DROP + 0.2, t, ev)
    const crack = ev.find((e) => e.k === 'crack' && e.i === tile)
    expect(crack && crack.k === 'crack' && crack.stand).toBe(true)
    const fall = ev.find((e) => e.k === 'fall' && e.side === 0)
    expect(fall).toBeDefined()
    const fallT = b.p[0].fallT
    expect(fallT - STAND).toBeGreaterThan(DROP - 0.1)
    expect(fallT - STAND).toBeLessThan(DROP + 0.1)
  })

  it('keeps a body up while it hangs over a gap that a live tile reaches', () => {
    const b = newBoard(0)
    // Centre in the gap between two columns, reach still touches the tile beside it.
    const row = tileCentre(3 * COLS).y
    const gapX = X0 + 3 * (TILE + 14) + TILE + 7
    expect(tileAt(gapX, row)).toBe(-1)
    expect(supported(b, gapX, row)).toBe(true)
    // Beyond the grid's edge, further than REACH: nothing holds it.
    expect(supported(b, X0 - REACH - 1, row)).toBe(false)
  })
})

describe('falling', () => {
  it('walking off the grid loses the round', () => {
    const b = newBoard(0)
    b.p[0].x = X0 - 60
    b.p[0].y = tileCentre(b.p[0].tile).y
    const ev: Ev[] = []
    const w = stepBoard(b, NONE, STEP, 1, ev)
    expect(ev.some((e) => e.k === 'fall' && e.side === 0)).toBe(true)
    expect(b.p[0].alive).toBe(false)
    expect(w).toBe(1)
  })

  it('both bodies falling in the same step is a draw', () => {
    const b = newBoard(0)
    b.p[0].x = X0 - 80
    b.p[1].x = X0 - 80
    expect(stepBoard(b, NONE, STEP, 1, [])).toBe('draw')
  })

  it('a dropping tile takes the body on it down', () => {
    const b = newBoard(0)
    const tile = b.p[0].tile
    b.st[tile] = CRACK
    b.t[tile] = -DROP
    expect(stepBoard(b, NONE, STEP, 0, [])).toBe(1)
    expect(b.p[0].alive).toBe(false)
  })

  it('keeps moving at SPEED times the stick', () => {
    const b = newBoard(0)
    const x0 = b.p[0].x
    stepBoard(
      b,
      [
        [1, 0],
        [0, 0],
      ],
      0.1,
      0,
      [],
    )
    expect(b.p[0].x - x0).toBeCloseTo(33, 5)
  })
})

describe('bots', () => {
  // Plays one round until somebody falls. Bounded, so a bot that never finishes fails.
  function playRound(seed: number, a: Difficulty, b2: Difficulty) {
    const board = newBoard(0)
    const rng = new Rng(seed)
    const red = TileBot.of(rng.fork(), a)
    const blue = TileBot.of(rng.fork(), b2)
    let t = 0
    for (let i = 0; i < 60 * 240; i++) {
      const d0 = red.drive(board, 0, STEP)
      const d1 = blue.drive(board, 1, STEP)
      const w = stepBoard(
        board,
        [
          [d0.x, d0.y],
          [d1.x, d1.y],
        ],
        STEP,
        t,
        [],
      )
      t += STEP
      if (w !== null) return { w, t }
    }
    return { w: null, t }
  }

  it('bots finish a round in bounded time whichever side they play', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const pair = seed % 2 ? (['normal', 'hard'] as const) : (['easy', 'normal'] as const)
      const r = playRound(seed, pair[0], pair[1])
      expect(r.w).not.toBeNull()
      expect(r.t).toBeLessThan(240)
    }
  })

  it('a bot never stands still on one tile for longer than STAND', () => {
    const b = newBoard(0)
    const bot = TileBot.of(new Rng(3), 'normal')
    let t = 0
    let idle = 0
    let worst = 0
    for (let i = 0; i < 60 * 20; i++) {
      const d = bot.drive(b, 0, STEP)
      const before = b.p[0].tile
      const w = stepBoard(
        b,
        [
          [d.x, d.y],
          [0, 0],
        ],
        STEP,
        t,
        [],
      )
      t += STEP
      if (w !== null) break
      idle = b.p[0].tile === before && Math.hypot(d.x, d.y) < 0.01 ? idle + STEP : 0
      worst = Math.max(worst, idle)
    }
    expect(worst).toBeLessThan(STAND)
  })
})
