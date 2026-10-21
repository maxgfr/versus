import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { SpikeBot } from './bot.ts'
import {
  BLOB_R,
  CAP,
  COLS,
  cellX,
  cellY,
  type Drive,
  type Ev,
  HP,
  INVULN,
  levelAt,
  newFloor,
  ROWS,
  RISE,
  roundWinner,
  SINK,
  spikeAt,
  stepFloor,
  timing,
  TILE,
  touches,
  X0,
  Y0,
} from './rules.ts'

const still: Drive[] = [
  { jx: 0, jy: 0 },
  { jx: 0, jy: 0 },
]

/** A fighter placed on tile (c, r), both start away from the spikes. */
function floorAt(c: number, r: number, side: 0 | 1 = 0) {
  const f = newFloor([500, 500], [1350, 450])
  const p = f.fighters[side]
  p.x = cellX(r * COLS + c) + TILE / 2
  p.y = cellY(r * COLS + c) + TILE / 2
  return f
}

describe('spike timing', () => {
  const pat = { cells: [5], w: 10, f: 11.5, u: 12.5 }

  it('telegraphs (warn), then rises, stays up and sinks', () => {
    expect(spikeAt([pat], 5, 10).h).toBe(0)
    expect(spikeAt([pat], 5, 10).warn).toBe(0)
    expect(spikeAt([pat], 5, 11).h).toBe(0)
    expect(spikeAt([pat], 5, 11).warn).toBeGreaterThan(0.5)
    expect(spikeAt([pat], 5, 11.5).h).toBe(0)
    expect(spikeAt([pat], 5, 11.5 + RISE).h).toBe(1)
    expect(spikeAt([pat], 5, 12).h).toBe(1)
    expect(spikeAt([pat], 5, 12.5 + SINK / 2).h).toBeCloseTo(0.5, 5)
    expect(spikeAt([pat], 5, 12.5 + SINK + 0.01).h).toBe(0)
  })

  it('other tiles are unaffected', () => {
    expect(spikeAt([pat], 6, 12)).toEqual({ h: 0, warn: 0 })
  })

  it('the telegraph gets shorter and the spikes stay up longer as the round goes on', () => {
    expect(levelAt(0)).toBe(0)
    expect(levelAt(33)).toBe(3)
    expect(levelAt(10000)).toBe(7)
    expect(timing(7).warn).toBeLessThan(timing(0).warn)
    expect(timing(7).gap).toBeLessThan(timing(0).gap)
    expect(timing(7).up).toBeGreaterThan(timing(0).up)
  })
})

describe('touching a spike', () => {
  it('a blob counts as touching a tile when its edge reaches the tile', () => {
    const i = 3 * COLS + 4
    const x0 = cellX(i)
    const y0 = cellY(i)
    expect(touches(i, x0 + TILE / 2, y0 + TILE / 2, BLOB_R)).toBe(true)
    expect(touches(i, x0 - BLOB_R + 2, y0 + TILE / 2, BLOB_R)).toBe(true)
    expect(touches(i, x0 - BLOB_R - 6, y0 + TILE / 2, BLOB_R)).toBe(false)
  })

  it('a hit costs one heart and gives a short invulnerability', () => {
    const f = floorAt(4, 3)
    const i = 3 * COLS + 4
    f.pats.push({ cells: [i], w: -2, f: -1, u: 50 })
    f.t = 0
    const ev: Ev[] = []
    stepFloor(f, new Rng(1), still, STEP, ev)
    expect(f.fighters[0].hp).toBe(HP - 1)
    expect(ev.some((e) => e.k === 'hit' && e.side === 0)).toBe(true)
    // Still on the spike, but invulnerable: no second heart straight away.
    for (let t = 0; t < INVULN * 60 - 2; t++) stepFloor(f, new Rng(1), still, STEP, [])
    expect(f.fighters[0].hp).toBe(HP - 1)
    for (let t = 0; t < 60; t++) stepFloor(f, new Rng(1), still, STEP, [])
    expect(f.fighters[0].hp).toBe(HP - 2)
  })

  it('a telegraphed (warning) tile does not hurt', () => {
    const f = floorAt(4, 3)
    const i = 3 * COLS + 4
    f.pats.push({ cells: [i], w: 0, f: 5, u: 6 })
    f.t = 1
    stepFloor(f, new Rng(1), still, STEP, [])
    expect(f.fighters[0].hp).toBe(HP)
  })

  it('the last blob standing wins; both down at once is a draw', () => {
    const f = floorAt(4, 3)
    expect(roundWinner(f)).toBeNull()
    f.fighters[1].died = 5
    expect(roundWinner(f)).toBe(0)
    const g = floorAt(4, 3)
    g.fighters[0].died = 7
    g.fighters[1].died = 7
    expect(roundWinner(g)).toBe('draw')
  })

  it('a blob that dies at 0 hearts is out of the round', () => {
    const f = floorAt(4, 3)
    f.fighters[0].hp = 1
    const i = 3 * COLS + 4
    f.pats.push({ cells: [i], w: -2, f: -1, u: 50 })
    const ev: Ev[] = []
    stepFloor(f, new Rng(1), still, STEP, ev)
    expect(f.fighters[0].died).toBeGreaterThanOrEqual(0)
    expect(ev.some((e) => e.k === 'dead' && e.side === 0)).toBe(true)
    expect(roundWinner(f)).toBe(1)
  })
})

describe('spike floor', () => {
  it('blobs stay on the floor whatever the stick says', () => {
    const f = floorAt(0, 0)
    for (let t = 0; t < 600; t++) {
      stepFloor(
        f,
        new Rng(2),
        [
          { jx: -1, jy: -1 },
          { jx: 1, jy: 1 },
        ],
        STEP,
        [],
      )
    }
    for (const p of f.fighters) {
      expect(p.x).toBeGreaterThanOrEqual(X0 + BLOB_R - 0.001)
      expect(p.x).toBeLessThanOrEqual(X0 + COLS * TILE - BLOB_R + 0.001)
      expect(p.y).toBeGreaterThanOrEqual(Y0 + BLOB_R - 0.001)
      expect(p.y).toBeLessThanOrEqual(Y0 + ROWS * TILE - BLOB_R + 0.001)
    }
  })

  it('the spiked share of the floor never passes the cap', () => {
    const f = newFloor([500, 500], [1350, 450])
    const rng = new Rng(9)
    for (let s = 0; s < 60 * 150; s++) {
      stepFloor(f, rng, still, STEP, [])
      let live = 0
      const seen = new Set<number>()
      for (const p of f.pats) for (const i of p.cells) if (f.t < p.u + SINK) seen.add(i)
      live = seen.size
      expect(live).toBeLessThanOrEqual(Math.floor(CAP * COLS * ROWS))
      if (f.fighters[0].died >= 0 || f.fighters[1].died >= 0) break
    }
  })

  it('the same seed gives the same patterns', () => {
    const run = (seed: number) => {
      const f = newFloor([500, 500], [1350, 450])
      const rng = new Rng(seed)
      const out: string[] = []
      for (let s = 0; s < 60 * 30; s++) {
        stepFloor(f, rng, still, STEP, [])
        for (const p of f.pats) if (Math.abs(f.t - p.w) < STEP / 2) out.push(p.cells.join(','))
      }
      return out
    }
    expect(run(4)).toEqual(run(4))
    expect(run(4)).not.toEqual(run(5))
  })
})

describe('spike bot', () => {
  it('plays either side and stays put when dead', () => {
    const f = newFloor([500, 500], [1350, 450])
    const bot = new SpikeBot('normal')
    for (const side of [0, 1] as const) {
      const d = bot.decide(f, side, STEP)
      expect(Number.isFinite(d.jx)).toBe(true)
      expect(Number.isFinite(d.jy)).toBe(true)
    }
    f.fighters[0].died = 1
    expect(bot.decide(f, 0, STEP)).toEqual({ jx: 0, jy: 0 })
  })

  it('steps off a tile that is about to spike', () => {
    const f = floorAt(4, 3)
    const i = 3 * COLS + 4
    // Spikes will hit the tile under the blob in half a second.
    f.pats.push({ cells: [i], w: 0, f: 0.9, u: 2.5 })
    f.t = 0.4
    const bot = new SpikeBot('hard')
    let moved = false
    for (let s = 0; s < 40; s++) {
      const d = bot.decide(f, 0, STEP)
      if (Math.hypot(d.jx, d.jy) > 0.2) moved = true
      stepFloor(f, new Rng(1), [d, { jx: 0, jy: 0 }], STEP, [])
    }
    expect(moved).toBe(true)
    expect(f.fighters[0].hp).toBe(HP)
  })

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot reaches a result within bounded time (${d})`, () => {
      for (let seed = 0; seed < 5; seed++) {
        const rng = new Rng(seed)
        const f = newFloor([500, 500], [1350, 450])
        const bots = [new SpikeBot(d), new SpikeBot(d)]
        let steps = 0
        while (roundWinner(f) === null && steps < 60 * 150) {
          const drives = [0, 1].map((s) => bots[s]?.decide(f, s as 0 | 1, STEP) ?? still[0])
          stepFloor(f, rng, drives as Drive[], STEP, [])
          steps++
        }
        expect(roundWinner(f)).not.toBeNull()
        expect(steps).toBeLessThan(60 * 150)
      }
    })
  }
})
