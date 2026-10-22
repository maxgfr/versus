import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { greedy, PACE, plan, Pilot, POWER, READ, shortest } from './bot.ts'
import {
  countPainted,
  generateLevel,
  impactOf,
  LEVEL_SIZES,
  levelSizes,
  MAX_SIZE,
  type Level,
  neighbour,
  paintTime,
  raceVerdict,
  roll,
  rollSeconds,
  roundSeed,
  startPaint,
  stuck,
  swipePower,
  twistOf,
} from './rules.ts'

describe('match rounds', () => {
  it('round 0 keeps the match seed; later rounds carve their own levels, repeatably', () => {
    expect(roundSeed(4242, 0)).toBe(4242)
    const seeds = [0, 1, 2, 3].map((r) => roundSeed(4242, r))
    expect(new Set(seeds).size).toBe(4)
    expect(roundSeed(4242, 2)).toBe(seeds[2])
    const a = generateLevel(new Rng(roundSeed(4242, 1)), 5)
    const b = generateLevel(new Rng(roundSeed(4242, 1)), 5)
    expect(a.walls).toEqual(b.walls)
  })
})

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

describe('swipe power', () => {
  it('a lazy drag has no power, a flick has full power, never outside 0..1', () => {
    expect(swipePower(60, 0.5)).toBe(0)
    expect(swipePower(120, 1 / 60)).toBe(1)
    expect(swipePower(100, 0)).toBe(1)
    expect(swipePower(Number.NaN, 0.1)).toBe(0)
    const mid = swipePower(80, 0.05)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })

  it('a harder swipe rolls faster, by at most a third', () => {
    expect(rollSeconds(4, 1)).toBeLessThan(rollSeconds(4, 0))
    expect(rollSeconds(4, 1)).toBeCloseTo(rollSeconds(4) * 0.65, 6)
    expect(rollSeconds(4, 9)).toBe(rollSeconds(4, 1))
    expect(rollSeconds(4, Number.NaN)).toBe(rollSeconds(4, 0))
  })

  it('paints each tile of a roll in order, the last one as the ball arrives', () => {
    const dur = rollSeconds(5, 0.7)
    let last = 0
    for (let k = 0; k < 5; k++) {
      const t = paintTime(1, dur, 5, k)
      expect(t).toBeGreaterThan(last)
      last = t
    }
    expect(paintTime(1, dur, 5, 4)).toBeLessThanOrEqual(1 + dur + 1e-9)
  })

  it('the wall hit grows with the roll length and the swipe power', () => {
    expect(impactOf(1, 0)).toBeLessThan(impactOf(5, 0))
    expect(impactOf(5, 0)).toBeLessThan(impactOf(5, 1))
    expect(impactOf(9, 1)).toBe(1)
    expect(impactOf(0, 1)).toBe(0)
  })
})

describe('race verdict (versus is on the clock, penalties included)', () => {
  const r = (done: boolean, clock: number, at = clock) => ({ done, clock, at })
  it('stays open while nobody has finished', () => {
    expect(raceVerdict([r(false, 30), r(false, 31)])).toBeNull()
  })
  it('a finisher wins at once when the rival is already past their time', () => {
    expect(raceVerdict([r(true, 40), r(false, 45)])).toBe(0)
  })
  it('a finisher with penalties waits: the rival can still stop the clock lower', () => {
    // Red finished first in real time but restarted twice (+10 s): blue still has 8 s.
    expect(raceVerdict([r(true, 40, 30), r(false, 32)])).toBeNull()
    expect(raceVerdict([r(true, 40, 30), r(true, 38, 38)])).toBe(1)
    // Blue's clock runs past 40 without finishing: red takes it.
    expect(raceVerdict([r(true, 40, 30), r(false, 40)])).toBe(0)
  })
  it('a tie on the clock goes to the earlier finish', () => {
    expect(raceVerdict([r(true, 40, 35), r(true, 40, 34)])).toBe(1)
  })
})

describe('bot search', () => {
  it('the shortest plan clears the level and is never longer than the greedy plan', () => {
    for (const seed of [31, 32, 33, 34]) {
      const rng = new Rng(seed)
      for (const n of LEVEL_SIZES) {
        const lv = generateLevel(rng, n)
        const best = shortest(lv, lv.start, startPaint(lv))
        const any = plan(lv, lv.start, startPaint(lv))
        expect(best).not.toBeNull()
        expect(countPainted(replay(lv, best ?? []).painted)).toBe(lv.floors)
        expect((best ?? []).length).toBeLessThanOrEqual((any ?? []).length)
      }
    }
  })

  it('the greedy fallback never rolls into a sure dead end', () => {
    const lv = grid(['S.#.', '..#.', '###.', '....'])
    // From the start, every roll leaves the far corridor unreachable: no safe roll.
    expect(greedy(lv, lv.start, startPaint(lv))).toBe(-1)
    const rng = new Rng(5)
    for (const n of LEVEL_SIZES) {
      const open = generateLevel(rng, n)
      const d = greedy(open, open.start, startPaint(open))
      expect(d).toBeGreaterThanOrEqual(0)
      const after = roll(open, open.start, d)
      const painted = startPaint(open)
      for (const t of after.path) painted[t] = 1
      expect(stuck(open, after.end, painted)).toBe(false)
    }
  })
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

describe('difficulty and ramp', () => {
  it('sizes mazes by difficulty and grows them round by round, capped', () => {
    expect(levelSizes('normal', 0)).toEqual(LEVEL_SIZES)
    expect(levelSizes('easy', 0)).toEqual([4, 5, 6])
    expect(levelSizes('hard', 0)).toEqual([6, 7, 8])
    expect(levelSizes('normal', 1)).toEqual([6, 7, 8])
    expect(levelSizes('easy', 5)).toEqual([6, 7, 8])
    expect(Math.max(...levelSizes('hard', 9))).toBe(MAX_SIZE)
  })

  it('twists more on hard and as rounds go on; normal round one carves as before', () => {
    expect(twistOf('normal', 0)).toBe(0)
    expect(twistOf('hard', 0)).toBeGreaterThan(0)
    expect(twistOf('easy', 2)).toBeGreaterThan(twistOf('easy', 1))
    expect(twistOf('hard', 9)).toBe(1)
    expect(generateLevel(new Rng(42), 6, 0)).toEqual(generateLevel(new Rng(42), 6))
  })

  it('twisted and largest mazes are still solvable by their recorded solution', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = new Rng(seed)
      for (const n of [4, 6, MAX_SIZE]) {
        for (const twist of [0.35, 1]) {
          const lv = generateLevel(rng, n, twist)
          const { painted, moved } = replay(lv, lv.solution)
          expect(moved.every(Boolean)).toBe(true)
          expect(countPainted(painted)).toBe(lv.floors)
        }
      }
    }
  })

  it('twistier mazes take more turns to solve', () => {
    let plain = 0
    let twisty = 0
    for (let seed = 0; seed < 30; seed++) {
      plain += generateLevel(new Rng(seed), 7, 0).solution.length
      twisty += generateLevel(new Rng(seed), 7, 1).solution.length
    }
    expect(twisty).toBeGreaterThan(plain)
  })

  /**
   * Seconds a bot needs for a round's three mazes: reading each one, then each
   * decision waits for its pace and its roll; a dead end costs the restart.
   */
  function race(d: Difficulty, seed: number, sizes: number[]): number {
    const rng = new Rng(seed)
    const levels = sizes.map((n) => generateLevel(rng, n, 0.35))
    const hands = new Rng(seed * 3 + 1)
    let t = 0
    for (const lv of levels) {
      t += READ[d]
      const pilot = new Pilot(lv, d, hands)
      let pos = lv.start
      let painted = startPaint(lv)
      for (let guard = 0; countPainted(painted) < lv.floors && guard < 5000; guard++) {
        const m = pilot.decide(pos, painted)
        if (m === 'reset') {
          t += 5 + 0.35
          pos = lv.start
          painted = startPaint(lv)
          pilot.reset()
          continue
        }
        const r = roll(lv, pos, m)
        t += Math.max(PACE[d], r.path.length ? rollSeconds(r.path.length, POWER[d]) : 0.12)
        for (const x of r.path) painted[x] = 1
        pos = r.end
      }
      expect(countPainted(painted)).toBe(lv.floors)
    }
    return t
  }

  it('hard beats easy, and normal beats easy, on most seeded mazes', () => {
    let hard = 0
    let normal = 0
    for (const seed of [71, 72, 73, 74, 75]) {
      const sizes = levelSizes('normal', 1)
      const easy = race('easy', seed, sizes)
      if (race('hard', seed, sizes) < easy) hard++
      if (race('normal', seed, sizes) < easy) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(4)
    expect(normal).toBeGreaterThanOrEqual(4)
  })

  it('the hard bot clears its own biggest mazes within bounded steps', () => {
    for (const seed of [81, 82]) race('hard', seed, levelSizes('hard', 2))
  })
})
