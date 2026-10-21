import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { cellOf, parseMap } from '../../engines/arena/index.ts'
import { CatBot, flood } from './bot.ts'
import {
  CATCH,
  type Drive,
  type Ev,
  HIDE_T,
  type Level,
  levelOf,
  LOOT_R,
  MAPS,
  matchWinner,
  newWorld,
  ROUND_T,
  roundWinner,
  scoreAdd,
  scoreNew,
  sees,
  stepWorld,
  thiefOf,
  VIS,
  type World,
} from './rules.ts'

const idle: Drive = { jx: 0, jy: 0, press: false }

/** A plain open hall (no walls inside) for geometry tests. */
function hall(): Level {
  const rows = ['##########', ...Array.from({ length: 10 }, () => '#........#'), '##########']
  const grid = parseMap(rows)
  return {
    index: -1,
    grid,
    shadow: new Uint8Array(grid.cols * grid.rows),
    loot: [{ x: 500, y: 1000 }],
    spawn: [
      { x: 500, y: 350 },
      { x: 500, y: 1450 },
    ],
  }
}

/** Put the thief and the guard where we want them. */
function place(w: World, thief: 0 | 1, t: [number, number], g: [number, number]): void {
  const th = w.pawns[thief]
  const gu = w.pawns[thief === 0 ? 1 : 0]
  th.x = t[0]
  th.y = t[1]
  gu.x = g[0]
  gu.y = g[1]
}

describe('museum maps', () => {
  for (const [i, rows] of MAPS.entries()) {
    it(`map ${i} is well formed: rectangular, 5 loot, shadows, every loot reachable from both spawns`, () => {
      const lv = levelOf(i)
      expect(rows.length).toBe(12)
      for (const row of rows) expect(row.length).toBe(10)
      expect(lv.loot.length).toBe(5)
      expect(lv.shadow.reduce((n, v) => n + v, 0)).toBeGreaterThanOrEqual(3)
      for (const sp of lv.spawn) {
        const c = cellOf(lv.grid, sp.x, sp.y)
        const from = flood(lv.grid, c.r * lv.grid.cols + c.c).dist
        for (const l of lv.loot) {
          const k = cellOf(lv.grid, l.x, l.y)
          expect(from[k.r * lv.grid.cols + k.c]).toBeGreaterThanOrEqual(0)
        }
      }
    })
  }
})

describe('guard and thief rules', () => {
  it('the thief hides only on a shadow tile, and then only for a while', () => {
    const lv = hall()
    const sc = lv.grid
    // Turn the centre tile into a shadow.
    const shadowAt = (c: number, r: number) => r * sc.cols + c
    lv.shadow[shadowAt(5, 5)] = 1
    const w = newWorld(lv, 0)
    place(w, 0, [sc.x0 + 5.5 * sc.cell, sc.y0 + 5.5 * sc.cell], [900, 200])
    const ev: Ev[] = []
    stepWorld(w, lv, [{ jx: 0, jy: 0, press: true }, idle], STEP, ev)
    expect(ev.some((e) => e.k === 'hide')).toBe(true)
    expect(w.pawns[0].until).toBeGreaterThan(w.t)
    for (let i = 0; i < 30; i++) stepWorld(w, lv, [idle, idle], STEP, [])
    expect(w.pawns[0].until).toBeGreaterThan(w.t)
    // Hiding ends after HIDE_T; pressing again during the cooldown does nothing.
    for (let i = 0; i < Math.ceil(HIDE_T * 60); i++) stepWorld(w, lv, [idle, idle], STEP, [])
    expect(w.pawns[0].until).toBeLessThan(w.t)
    const again: Ev[] = []
    stepWorld(w, lv, [{ jx: 0, jy: 0, press: true }, idle], STEP, again)
    expect(again.some((e) => e.k === 'hide')).toBe(false)
  })

  it('a thief on plain floor cannot hide', () => {
    const lv = hall()
    const w = newWorld(lv, 0)
    place(w, 0, [150, 1550], [900, 200])
    const ev: Ev[] = []
    stepWorld(w, lv, [{ jx: 0, jy: 0, press: true }, idle], STEP, ev)
    expect(ev.some((e) => e.k === 'hide')).toBe(false)
    expect(w.pawns[0].until).toBeLessThan(0)
  })

  it('the guard catches a visible thief, and not a hidden one', () => {
    const lv = hall()
    const w = newWorld(lv, 0)
    place(w, 0, [500, 900], [500 + CATCH - 10, 900])
    const ev: Ev[] = []
    stepWorld(w, lv, [idle, idle], STEP, ev)
    expect(roundWinner(w)).toBe(1)
    expect(ev.some((e) => e.k === 'catch')).toBe(true)
    expect(w.winT).toBeCloseTo(STEP, 5)
  })

  it('a hidden thief is not caught by touch', () => {
    const lv = hall()
    const w = newWorld(lv, 0)
    place(w, 0, [500, 900], [500 + CATCH - 10, 900])
    w.pawns[0].until = 5
    stepWorld(w, lv, [idle, idle], STEP, [])
    expect(roundWinner(w)).toBeNull()
  })

  it('the thief wins by taking every piece of loot', () => {
    const lv = levelOf(1)
    const w = newWorld(lv, 0)
    for (const l of lv.loot.slice(0, 4)) {
      const k = w.loot.find((o) => o.x === l.x && o.y === l.y)
      if (k) k.got = 0
    }
    const last = lv.loot[4]
    if (!last) throw new Error('no loot')
    place(w, 0, [last.x, last.y], [900, 200])
    const ev: Ev[] = []
    stepWorld(w, lv, [idle, idle], STEP, ev)
    expect(ev.some((e) => e.k === 'loot')).toBe(true)
    expect(roundWinner(w)).toBe(0)
    expect(w.winT).toBeGreaterThan(0)
  })

  it('a loot item is only taken within reach', () => {
    const lv = hall()
    const w = newWorld(lv, 0)
    const l = lv.loot[0]
    if (!l) throw new Error('no loot')
    place(w, 0, [l.x + LOOT_R + 30, l.y], [900, 200])
    stepWorld(w, lv, [idle, idle], STEP, [])
    expect(w.loot.filter((o) => o.got >= 0).length).toBe(0)
  })

  it('the guard takes the round when time runs out', () => {
    const lv = levelOf(2)
    const w = newWorld(lv, 0)
    w.t = ROUND_T - STEP / 2
    stepWorld(w, lv, [idle, idle], STEP, [])
    expect(roundWinner(w)).toBe(1)
    expect(w.winT).toBe(ROUND_T)
  })

  it('the guard sees the thief in front, in range and in the open, but not behind them', () => {
    const lv = hall()
    const w = newWorld(lv, 0)
    place(w, 0, [500, 900], [500, 640])
    w.pawns[1].a = Math.PI / 2
    expect(sees(lv, w)).toBe(true)
    w.pawns[1].a = -Math.PI / 2
    expect(sees(lv, w)).toBe(false)
    place(w, 0, [500, 900], [500, 900 - VIS - 60])
    w.pawns[1].a = Math.PI / 2
    expect(sees(lv, w)).toBe(false)
    place(w, 0, [500, 900], [500, 640])
    w.pawns[0].until = 9
    expect(sees(lv, w)).toBe(false)
  })

  it('a wall between guard and thief blocks the view', () => {
    const lv = hall()
    const sc = lv.grid
    // Wall at column 5 of row 5: thief on column 4, guard on column 6.
    lv.grid.solid[5 * sc.cols + 5] = 1
    const w = newWorld(lv, 0)
    const y = sc.y0 + 5.5 * sc.cell
    place(w, 0, [sc.x0 + 4.5 * sc.cell, y], [sc.x0 + 6.5 * sc.cell, y])
    w.pawns[1].a = Math.PI
    expect(sees(lv, w)).toBe(false)
    lv.grid.solid[5 * sc.cols + 5] = 0
    expect(sees(lv, w)).toBe(true)
  })

  it('a match is the most round wins, then the lower winning time', () => {
    const sc = scoreNew(2)
    scoreAdd(sc, 0, 25)
    expect(matchWinner(sc)).toBeNull()
    scoreAdd(sc, 1, 12)
    expect(matchWinner(sc)).toBe(1)
    const tie = scoreNew(2)
    scoreAdd(tie, 0, 30)
    scoreAdd(tie, 1, 18)
    expect(matchWinner(tie)).toBe(1)
    const even = scoreNew(2)
    scoreAdd(even, 0, 20)
    scoreAdd(even, 1, 20)
    expect(matchWinner(even)).toBe('draw')
  })

  it('roles alternate, red thief first', () => {
    expect(thiefOf(0)).toBe(0)
    expect(thiefOf(1)).toBe(1)
    expect(thiefOf(2)).toBe(0)
  })
})

describe('guard and thief bots', () => {
  it('play either role and always produce finite drives', () => {
    const lv = levelOf(0)
    const w = newWorld(lv, 1)
    const bot = new CatBot(new Rng(3), 'normal')
    for (const side of [0, 1] as const) {
      const d = bot.decide(w, lv, side, STEP)
      expect(Number.isFinite(d.jx)).toBe(true)
      expect(Number.isFinite(d.jy)).toBe(true)
    }
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot reaches a round result on every map (${d})`, () => {
      for (let map = 0; map < MAPS.length; map++) {
        for (const thief of [0, 1] as const) {
          const lv = levelOf(map)
          const rng = new Rng(map * 7 + thief)
          const w = newWorld(lv, thief)
          const bots = [new CatBot(rng.fork(), d), new CatBot(rng.fork(), d)]
          let steps = 0
          while (roundWinner(w) === null && steps < 60 * (ROUND_T + 5)) {
            const drives = [0, 1].map((s) => bots[s]?.decide(w, lv, s as 0 | 1, STEP) ?? idle)
            stepWorld(w, lv, drives, STEP, [])
            steps++
          }
          expect(roundWinner(w)).not.toBeNull()
          expect(w.winT).toBeLessThanOrEqual(ROUND_T)
        }
      }
    })
  }
})
