import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { choose } from './ai.ts'
import {
  atRest,
  COURSE,
  CUP_R,
  frame,
  holeOver,
  holeScore,
  launch,
  makeGeo,
  MAX_STROKES,
  MAX_ROLL,
  nextTurn,
  settle,
  simulate,
  startTable,
  totals,
  type Table,
  FRAME,
} from './rules.ts'
import type { Side } from '../../core/game.ts'

/** Play one hole with the bot on both sides, the way the game does. Returns strokes per side. */
function playHole(
  seed: number,
  holeIndex: number,
  d: 'easy' | 'normal' | 'hard' = 'hard',
): { strokes: [number, number]; frames: number } {
  const rng = new Rng(seed)
  let t: Table = startTable(makeGeo(rng, holeIndex - 1))
  let frames = 0
  let guard = 0
  while (!holeOver(t) && guard++ < 40) {
    const side = nextTurn(t)
    if (side === null) break
    const shot = choose({ table: t, side }, d, rng.int(1, 1e6))
    launch(t, side, shot.dx, shot.dy, shot.power)
    let rolls = 0
    while (!atRest(t) && rolls++ < MAX_ROLL / FRAME + 2) {
      frame(t)
      frames++
    }
    settle(t)
  }
  return { strokes: [holeScore(t.balls[0]), holeScore(t.balls[1])], frames }
}

describe('mini golf course', () => {
  it('builds the same hole from the same seed', () => {
    const a = makeGeo(new Rng(42))
    const b = makeGeo(new Rng(42))
    expect(a).toEqual(b)
  })

  it('keeps the cup, tees and features inside the course', () => {
    for (let s = 1; s <= 60; s++) {
      const g = makeGeo(new Rng(s), s % 7)
      const inside = (x: number, y: number) =>
        x > COURSE.x0 + 40 && x < COURSE.x1 - 40 && y > COURSE.y0 + 40 && y < COURSE.y1 - 40
      expect(inside(g.cup.x, g.cup.y)).toBe(true)
      for (const t of g.tees) expect(inside(t.x, t.y)).toBe(true)
      for (const b of g.bumpers) expect(inside(b.x, b.y)).toBe(true)
      for (const m of g.mills) expect(inside(m.x, m.y)).toBe(true)
    }
  })

  it('a ball drops only when it is inside the rim and slow enough', () => {
    const t = startTable(makeGeo(new Rng(7)))
    const cup = t.geo.cup
    // Park the ball right over the cup at walking pace: it drops.
    t.balls[0].x = cup.x + 4
    t.balls[0].y = cup.y
    t.balls[0].vx = 40
    frame(t)
    expect(t.balls[0].state).toBe('holed')
    // Same spot, shot hard: it lips out and keeps going.
    const u = startTable(makeGeo(new Rng(7)))
    u.balls[0].x = u.geo.cup.x
    u.balls[0].y = u.geo.cup.y + CUP_R - 2
    u.balls[0].vy = -1200
    frame(u)
    expect(u.balls[0].state).toBe('play')
  })

  it('picks a ball up after six strokes without dropping it', () => {
    const t = startTable(makeGeo(new Rng(3)))
    const b = t.balls[1]
    b.strokes = MAX_STROKES
    b.x = 300
    b.y = 1000
    settle(t)
    expect(b.state).toBe('picked')
    expect(holeScore(b)).toBe(MAX_STROKES)
  })

  it('scores a holed ball as the strokes it took', () => {
    const t = startTable(makeGeo(new Rng(3)))
    t.balls[0].strokes = 2
    t.balls[0].state = 'holed'
    expect(holeScore(t.balls[0])).toBe(2)
  })
})

describe('mini golf turns', () => {
  it('the ball with fewer strokes putts next', () => {
    const t = startTable(makeGeo(new Rng(5)))
    t.balls[0].strokes = 2
    t.balls[1].strokes = 1
    expect(nextTurn(t)).toBe(1)
  })

  it('on a tie, the ball farther from the cup goes first', () => {
    const t = startTable(makeGeo(new Rng(5)))
    const cup = t.geo.cup
    t.balls[0].x = cup.x
    t.balls[0].y = cup.y + 300
    t.balls[1].x = cup.x
    t.balls[1].y = cup.y + 900
    expect(nextTurn(t)).toBe(1)
  })

  it('a dropped ball leaves the other one to finish the hole', () => {
    const t = startTable(makeGeo(new Rng(5)))
    t.balls[0].state = 'holed'
    expect(holeOver(t)).toBe(false)
    expect(nextTurn(t)).toBe(1)
    t.balls[1].state = 'picked'
    expect(holeOver(t)).toBe(true)
    expect(nextTurn(t)).toBeNull()
  })

  it('adds up strokes across the holes', () => {
    expect(
      totals([
        [2, 3, 6],
        [4, 1],
      ]),
    ).toEqual([11, 5])
  })

  it('a shot the bot simulates is the one the game plays', () => {
    const t = startTable(makeGeo(new Rng(11), 0))
    const shot = choose({ table: t, side: 0 }, 'hard', 99)
    const sim = simulate(t, 0, shot.dx, shot.dy, shot.power)
    const real = startTable(makeGeo(new Rng(11), 0))
    launch(real, 0, shot.dx, shot.dy, shot.power)
    for (let i = 0; i < Math.round(MAX_ROLL / FRAME) && !atRest(real); i++) {
      frame(real)
      if (real.balls[0].state !== 'play') break
    }
    expect(real.balls[0].state === 'holed').toBe(sim.holed)
  })
})

describe('mini golf match', () => {
  it('a bot holes out a hole on either side within the stroke cap', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = playHole(seed, 0, 'hard')
      for (const s of r.strokes) {
        expect(s).toBeGreaterThanOrEqual(1)
        expect(s).toBeLessThanOrEqual(MAX_STROKES)
      }
    }
  })

  it('computer vs computer plays six holes to a result in bounded time', () => {
    const card: [number[], number[]] = [[], []]
    let prev = -1
    let framesTotal = 0
    for (let hole = 0; hole < 6; hole++) {
      const rng = new Rng(100 + hole)
      const geo = makeGeo(rng, prev)
      prev = geo.id
      const t = startTable(geo)
      let guard = 0
      while (!holeOver(t) && guard++ < 40) {
        const side = nextTurn(t) as Side
        const shot = choose({ table: t, side }, 'normal', hole)
        launch(t, side, shot.dx, shot.dy, shot.power)
        for (let i = 0; i < Math.round(MAX_ROLL / FRAME) + 2 && !atRest(t); i++) {
          frame(t)
          framesTotal++
        }
        settle(t)
      }
      expect(holeOver(t)).toBe(true)
      card[0].push(holeScore(t.balls[0]))
      card[1].push(holeScore(t.balls[1]))
    }
    const [a, b] = totals(card)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(0)
    // Bounded: well under the frame cap (6 holes × 2 × 6 strokes × 9 s).
    expect(framesTotal).toBeLessThan(6 * 2 * MAX_STROKES * (MAX_ROLL / FRAME + 2))
    expect(W).toBe(1000)
  })
})
