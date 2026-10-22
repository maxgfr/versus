import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { TileBot } from './bot.ts'
import {
  type Board,
  COLS,
  CRACK,
  DASH_BOOST,
  DASH_CD,
  DROP,
  dash,
  type Ev,
  GONE,
  HOLES,
  INTACT,
  nearestTile,
  newBoard,
  nextQuake,
  QUAKE,
  QUAKE_MATCH_POINT,
  QUAKE_MIN,
  QUAKE_ORDER,
  quakeDelay,
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

describe('fixes', () => {
  it('two bodies swapping tiles in one step crack both tiles', () => {
    const b = newBoard(0)
    const x = b.p[0].tile
    const y = x - 1
    place(b, 1, y)
    b.p[1].tile = y
    // Swap: each lands on the other's tile in the same step.
    place(b, 0, y)
    place(b, 1, x)
    const ev: Ev[] = []
    stepBoard(b, NONE, STEP, 0.5, ev)
    expect(b.st[x]).toBe(CRACK)
    expect(b.st[y]).toBe(CRACK)
  })

  it('a body joining a tile the other leaves in the same step does not save it', () => {
    const b = newBoard(0)
    const x = b.p[0].tile
    place(b, 1, x - 1)
    b.p[1].tile = x - 1
    // Red steps up, blue steps onto red's old tile: it was red's alone, so it cracks.
    place(b, 0, x - COLS)
    place(b, 1, x)
    stepBoard(b, NONE, STEP, 0.5, [])
    expect(b.st[x]).toBe(CRACK)
  })

  it('the survivor never falls in the pause between rounds', () => {
    const b = newBoard(0)
    // Blue has fallen: red stands still on a tile that is already cracking.
    b.p[1].alive = false
    b.p[1].fallT = 0
    const tile = b.p[0].tile
    b.st[tile] = CRACK
    b.t[tile] = 0
    const ev: Ev[] = []
    let t = 0
    for (let i = 0; i < 60 * 5; i++) {
      stepBoard(
        b,
        [
          [1, 0],
          [0, 0],
        ],
        STEP,
        t,
        ev,
        false,
      )
      t += STEP
    }
    expect(b.p[0].alive).toBe(true)
    expect(b.st[tile]).toBe(CRACK)
    // Nobody moved, nothing cracked from standing.
    expect(b.p[0].x).toBe(tileCentre(tile).x)
    expect(ev.some((e) => e.k === 'crack' && e.stand)).toBe(false)
  })

  it('other cracked tiles still drop during the pause', () => {
    const b = newBoard(0)
    const far = 3
    b.st[far] = CRACK
    b.t[far] = 0
    let t = 0
    for (let i = 0; i < 60; i++) {
      stepBoard(b, NONE, STEP, t, [], false)
      t += STEP
    }
    expect(b.st[far]).toBe(GONE)
  })
})

describe('dash', () => {
  it('boosts the walk by up to DASH_BOOST and fades', () => {
    const b = newBoard(0)
    const ev: Ev[] = []
    expect(dash(b, 0, 1, 0, ev)).toBe(true)
    expect(ev.some((e) => e.k === 'dash' && e.side === 0 && e.force === 1)).toBe(true)
    const x0 = b.p[0].x
    stepBoard(
      b,
      [
        [1, 0],
        [0, 0],
      ],
      STEP,
      0,
      [],
    )
    const v1 = (b.p[0].x - x0) / STEP
    expect(v1).toBeGreaterThan(330 * (1 + DASH_BOOST * 0.85))
    expect(v1).toBeLessThanOrEqual(330 * (1 + DASH_BOOST) + 1e-6)
    run(
      b,
      [
        [0, 0],
        [0, 0],
      ],
      1,
      STEP,
    )
    expect(b.p[0].dash).toBe(0)
  })

  it('a dash never moves a body with an idle stick', () => {
    const b = newBoard(0)
    dash(b, 0, 1, 0, [])
    const x0 = b.p[0].x
    stepBoard(b, NONE, STEP, 0, [])
    expect(b.p[0].x).toBe(x0)
  })

  it('a soft flick still gives the minimum dash, and the cooldown refuses spam', () => {
    const b = newBoard(0)
    expect(dash(b, 0, 0, 1, [])).toBe(true)
    expect(b.p[0].dash).toBeGreaterThan(0.3)
    expect(dash(b, 0, 1, 1 + DASH_CD / 2, [])).toBe(false)
    expect(dash(b, 0, 1, 1 + DASH_CD + 1e-6, [])).toBe(true)
  })

  it('a fallen body cannot dash', () => {
    const b = newBoard(0)
    b.p[0].alive = false
    expect(dash(b, 0, 1, 0, [])).toBe(false)
  })

  it('dashing across a hole still falls in it', () => {
    const b = newBoard(0)
    const tile = b.p[0].tile
    const hole = tile + 1
    b.st[hole] = GONE
    dash(b, 0, 1, 0, [])
    const r = run(
      b,
      [
        [1, 0],
        [0, 0],
      ],
      0.6,
      0,
    )
    expect(r.winner).toBe(1)
    expect(b.p[0].alive).toBe(false)
  })

  it('a body never moves more than its reach in one step, even dashing (no tunnelling)', () => {
    expect(330 * (1 + DASH_BOOST) * STEP).toBeLessThan(REACH)
  })
})

describe('quake (the ramp)', () => {
  /** Both bodies parked in the middle column, out of the quake's way for a while. */
  function parked(): Board {
    const b = newBoard(0, 2)
    place(b, 0, 5 * COLS + 3)
    place(b, 1, 4 * COLS + 3)
    b.p[0].tile = 5 * COLS + 3
    b.p[1].tile = 4 * COLS + 3
    return b
  }

  it('crumbles nothing before it starts, then outer-ring tiles in mirrored pairs', () => {
    const b = parked()
    const ev: Ev[] = []
    // Keep the bodies' stand timers fresh so only the quake cracks anything.
    let t = 0
    for (; t < 2 - STEP; t += STEP) {
      b.p[0].since = b.p[1].since = t
      stepBoard(b, NONE, STEP, t, ev)
    }
    expect(ev.filter((e) => e.k === 'crack')).toEqual([])
    for (; t < 4; t += STEP) {
      b.p[0].since = b.p[1].since = t
      stepBoard(b, NONE, STEP, t, ev)
    }
    const edges = ev
      .filter((e) => e.k === 'crack' && e.edge)
      .map((e) => (e.k === 'crack' ? e.i : -1))
    expect(edges.length).toBeGreaterThanOrEqual(2)
    const n = COLS * ROWS
    // Each crumbling tile is followed by its point-mirror: neither half goes first.
    expect(edges[1]).toBe(n - 1 - (edges[0] as number))
    for (const i of edges) {
      const c = i % COLS
      const r = Math.floor(i / COLS)
      expect(Math.min(c, r, COLS - 1 - c, ROWS - 1 - r)).toBe(0)
    }
  })

  it('speeds up, but never faster than QUAKE_MIN', () => {
    const b = parked()
    const at: number[] = []
    let t = 0
    for (; t < 40; t += STEP) {
      b.p[0].since = b.p[1].since = t
      const ev: Ev[] = []
      stepBoard(b, NONE, STEP, t, ev)
      if (ev.some((e) => e.k === 'crack' && e.edge)) at.push(t)
    }
    const gaps = at.slice(1).map((x, i) => x - (at[i] as number))
    expect(gaps[0]).toBeGreaterThan((gaps[gaps.length - 1] as number) + 0.3)
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(QUAKE_MIN - STEP)
  })

  it('never takes a tile someone stands on, and nothing during the pause', () => {
    const b = parked()
    let t = 0
    for (; t < 60; t += STEP) {
      b.p[0].since = b.p[1].since = t
      stepBoard(b, NONE, STEP, t, [])
    }
    // Everything else is gone; the two occupied tiles still stand.
    expect(b.p[0].alive && b.p[1].alive).toBe(true)
    expect(nextQuake(b)).toBe(-1)
    const p = newBoard(0, 0)
    const ev: Ev[] = []
    for (let i = 0; i < 120; i++) stepBoard(p, NONE, STEP, i * STEP, ev, false)
    expect(ev.some((e) => e.k === 'crack')).toBe(false)
  })

  it('takes every tile exactly once in its order', () => {
    expect([...QUAKE_ORDER].sort((a, b) => a - b)).toEqual(
      Array.from({ length: COLS * ROWS }, (_, i) => i),
    )
  })

  it('comes sooner as the match goes on, and soonest at match point', () => {
    expect(quakeDelay([0, 0], 3)).toBe(QUAKE)
    expect(quakeDelay([1, 0], 3)).toBe(QUAKE - 1)
    expect(quakeDelay([2, 0], 3)).toBe(QUAKE_MATCH_POINT)
    expect(quakeDelay([0, 1], 2)).toBe(QUAKE_MATCH_POINT)
    expect(quakeDelay([3, 3], 9)).toBe(QUAKE_MATCH_POINT)
    expect(newBoard(1, 4).quake).toBe(5)
  })
})

describe('bots', () => {
  // Plays one round until somebody falls. Bounded, so a bot that never finishes fails.
  function playRound(seed: number, a: Difficulty, b2: Difficulty) {
    const board = newBoard(0)
    const rng = new Rng(seed)
    const bots = [TileBot.of(rng.fork(), a), TileBot.of(rng.fork(), b2)]
    let t = 0
    for (let i = 0; i < 60 * 240; i++) {
      const dirs: [number, number][] = [
        [0, 0],
        [0, 0],
      ]
      for (const side of [0, 1] as const) {
        const d = bots[side]?.drive(board, side, t) ?? { x: 0, y: 0, dash: 0 }
        if (d.dash > 0) dash(board, side, d.dash, t, [])
        dirs[side] = [d.x, d.y]
      }
      const w = stepBoard(board, dirs, STEP, t, [])
      t += STEP
      if (w !== null) return { w, t }
    }
    return { w: null, t }
  }

  /** Rounds won by `strong` over `weak` out of 2 × n, playing each side n times. */
  function score(strong: Difficulty, weak: Difficulty, n: number): number {
    let won = 0
    for (let seed = 1; seed <= n; seed++) {
      if (playRound(seed, strong, weak).w === 0) won++
      if (playRound(seed + 100, weak, strong).w === 1) won++
    }
    return won
  }

  it('hard clearly beats easy, from either side', () => {
    expect(score('hard', 'easy', 10)).toBeGreaterThanOrEqual(17)
  })

  it('hard clearly beats normal', () => {
    expect(score('hard', 'normal', 10)).toBeGreaterThanOrEqual(15)
  })

  it('normal clearly beats easy', () => {
    expect(score('normal', 'easy', 10)).toBeGreaterThanOrEqual(15)
  })

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
      const d = bot.drive(b, 0, t)
      if (d.dash > 0) dash(b, 0, d.dash, t, [])
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
      // Standing still is only a fault while a free neighbour is left to walk to.
      const free = [1, -1, COLS, -COLS].some((o) => {
        const n = before + o
        const sameRow =
          Math.abs(o) === 1 ? Math.floor(n / COLS) === Math.floor(before / COLS) : true
        return n >= 0 && n < COLS * ROWS && sameRow && b.st[n] === INTACT
      })
      idle = b.p[0].tile === before && Math.hypot(d.x, d.y) < 0.01 && free ? idle + STEP : 0
      worst = Math.max(worst, idle)
    }
    expect(worst).toBeLessThan(STAND)
  })

  it('a boxed-in bot stands its ground instead of walking into the void', () => {
    const b = newBoard(0)
    const here = b.p[0].tile
    for (let i = 0; i < b.st.length; i++) if (i !== here && i !== b.p[1].tile) b.st[i] = GONE
    const bot = TileBot.of(new Rng(1), 'hard')
    const d = bot.drive(b, 0, 0.5)
    expect(Math.hypot(d.x, d.y)).toBeLessThan(0.05)
  })

  it('once cut off, a smart bot makes each tile last instead of burning its island', () => {
    const b = newBoard(0, 1e9)
    // A trench across the middle row: red's island is the bottom half.
    const mid = Math.floor(ROWS / 2)
    for (let c = 0; c < COLS; c++) b.st[mid * COLS + c] = GONE
    const bot = TileBot.of(new Rng(2), 'hard')
    let t = 0
    const ev: Ev[] = []
    for (let i = 0; i < 60 * 20; i++) {
      const d = bot.drive(b, 0, t)
      stepBoard(
        b,
        [
          [d.x, d.y],
          [0, 0],
        ],
        STEP,
        t,
        ev,
      )
      t += STEP
    }
    expect(b.p[0].alive).toBe(true)
    // 20 s on, it has walked over far fewer tiles than rushing would (~3 a second).
    const cracked = ev.filter((e) => e.k === 'crack' && !e.stand).length
    expect(cracked).toBeGreaterThan(8)
    expect(cracked).toBeLessThan(25)
    // And standing never cracked a tile under it.
    expect(ev.some((e) => e.k === 'crack' && e.stand && e.i !== b.p[1].tile)).toBe(false)
  })
})
