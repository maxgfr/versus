import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { plan, Pilot } from './bot.ts'
import {
  countPainted,
  generateLevel,
  LEVEL_SIZES,
  type Level,
  neighbour,
  roll,
  startPaint,
  stuck,
} from './rules.ts'

/** A hand-made 4 × 4 level: `#` wall, `.` floor, `S` start. */
function grid(rows: string[]): Level {
  const n = rows.length
  const walls: number[] = []
  let start = -1
  let floors = 0
  rows.forEach((row, r) => {
    for (let c = 0; c < n; c++) {
      const ch = row[c]
      walls.push(ch === '#' ? 1 : 0)
      if (ch !== '#') floors++
      if (ch === 'S') start = r * n + c
    }
  })
  return { n, walls, start, floors, solution: [] }
}

/** Replay a roll sequence on a level and return the painted tiles. */
function replay(lv: Level, dirs: number[]): { painted: number[]; moved: boolean[] } {
  let pos = lv.start
  const painted = startPaint(lv)
  const moved: boolean[] = []
  for (const d of dirs) {
    const r = roll(lv, pos, d)
    moved.push(r.path.length > 0)
    for (const t of r.path) painted[t] = 1
    pos = r.end
  }
  return { painted, moved }
}

describe('roll', () => {
  const lv = grid(['S...', '....', '.#..', '....'])

  it('slides until the next tile is a wall, painting every tile it enters', () => {
    const r = roll(lv, 0, 1)
    expect(r.end).toBe(3)
    expect(r.path).toEqual([1, 2, 3])
  })

  it('stops against the edge of the grid', () => {
    expect(roll(lv, 0, 0).path).toEqual([])
    const down = roll(lv, 0, 2)
    expect(down.end).toBe(12)
    expect(down.path).toEqual([4, 8, 12])
  })

  it('stops in front of an inner wall', () => {
    // From (3,1) rolling up: the wall at (2,1) stops it at once.
    expect(roll(lv, 13, 0).path).toEqual([])
    // From (0,1) rolling down: (1,1) is floor, then the wall at (2,1) stops it.
    expect(roll(lv, 1, 2).end).toBe(5)
    // From (1,0) rolling down: (2,0) and (3,0) are floor, then the edge.
    expect(roll(lv, 4, 2).end).toBe(12)
  })

  it('never enters a wall tile', () => {
    const r = roll(lv, 12, 0)
    expect(r.path.every((t) => lv.walls[t] === 0)).toBe(true)
  })

  it('neighbour is -1 past the edge', () => {
    expect(neighbour(4, 3, 1)).toBe(-1)
    expect(neighbour(4, 0, 3)).toBe(-1)
    expect(neighbour(4, 5, 0)).toBe(1)
  })
})

describe('level generation', () => {
  it('carves solvable levels: the recorded solution paints every floor tile', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rng = new Rng(seed)
      for (const n of LEVEL_SIZES) {
        const lv = generateLevel(rng, n)
        expect(lv.walls[lv.start]).toBe(0)
        expect(lv.floors).toBe(lv.walls.filter((w) => w === 0).length)
        const { painted, moved } = replay(lv, lv.solution)
        expect(moved.every(Boolean)).toBe(true)
        expect(countPainted(painted)).toBe(lv.floors)
        expect(painted.every((v, i) => v === 1 || lv.walls[i] === 1)).toBe(true)
      }
    }
  })

  it('is deterministic per seed and differs between seeds', () => {
    const a = generateLevel(new Rng(42), 6)
    const b = generateLevel(new Rng(42), 6)
    const c = generateLevel(new Rng(43), 6)
    expect(a).toEqual(b)
    expect(a.walls).not.toEqual(c.walls)
  })

  it('makes real mazes: a good share of tiles are walls and the start is not walled in', () => {
    const lv = generateLevel(new Rng(9), 7)
    const walls = lv.walls.filter((w) => w === 1).length
    expect(walls).toBeGreaterThan(7 * 7 * 0.2)
    expect(lv.solution.length).toBeGreaterThan(4)
  })

  it('generates fast', () => {
    const t = performance.now()
    for (let s = 0; s < 20; s++) generateLevel(new Rng(300 + s), 7)
    expect((performance.now() - t) / 20).toBeLessThan(40)
  })
})

describe('planning', () => {
  it('finds a roll sequence that clears a level from the start', () => {
    const lv = generateLevel(new Rng(11), 6)
    const dirs = plan(lv, lv.start, startPaint(lv))
    expect(dirs).not.toBeNull()
    const { painted } = replay(lv, dirs ?? [])
    expect(countPainted(painted)).toBe(lv.floors)
  })

  it('returns an empty plan once every floor tile is painted', () => {
    const lv = generateLevel(new Rng(12), 5)
    const { painted } = replay(lv, lv.solution)
    expect(plan(lv, lv.solution.length ? replayEnd(lv) : lv.start, painted)).toEqual([])
  })
})

function replayEnd(lv: Level): number {
  let pos = lv.start
  for (const d of lv.solution) pos = roll(lv, pos, d).end
  return pos
}

describe('bot vs bot', () => {
  /** Drive a whole game with the pilot, restarting on dead ends like the game does. */
  function play(
    seed: number,
    d: Difficulty,
  ): { decisions: number; resets: number; cleared: boolean } {
    const rng = new Rng(seed)
    const levels = LEVEL_SIZES.map((n) => generateLevel(rng, n))
    const hands = new Rng(seed + 1)
    let decisions = 0
    let resets = 0
    for (const lv of levels) {
      const pilot = new Pilot(lv, d, hands)
      let pos = lv.start
      let painted = startPaint(lv)
      while (countPainted(painted) < lv.floors) {
        decisions++
        if (decisions > 20000) return { decisions, resets, cleared: false }
        const m = pilot.decide(pos, painted)
        if (m === 'reset') {
          resets++
          pos = lv.start
          painted = startPaint(lv)
          pilot.reset()
          continue
        }
        const r = roll(lv, pos, m)
        for (const t of r.path) painted[t] = 1
        pos = r.end
      }
    }
    return { decisions, resets, cleared: true }
  }

  for (const d of ['easy', 'normal', 'hard'] as const) {
    it(`${d} bot clears all three levels within bounded steps`, () => {
      for (const seed of [21, 22, 23]) {
        const out = play(seed, d)
        expect(out.cleared).toBe(true)
        expect(out.decisions).toBeLessThan(5000)
      }
    })
  }
})

describe('stuck', () => {
  const lv = grid(['S.#.', '..#.', '###.', '....'])

  it('spots unpainted floor that no reachable roll can cover', () => {
    expect(stuck(lv, lv.start, startPaint(lv))).toBe(true)
  })

  it('is not stuck once the far tiles are painted, nor on a fresh generated level', () => {
    const painted = lv.walls.map((w, i) => (w === 0 && i !== 1 && i !== 4 && i !== 5 ? 1 : 0))
    expect(stuck(lv, lv.start, painted)).toBe(false)
    const rng = new Rng(7)
    for (const n of LEVEL_SIZES) {
      const g = generateLevel(rng, n)
      expect(stuck(g, g.start, startPaint(g))).toBe(false)
    }
  })
})
