import Matter from 'matter-js'
import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { type BodySnap, type M, trapCentroid } from '../../engines/ragdoll/index.ts'
import { choose } from './bot.ts'
import {
  anyFallen,
  cameraFor,
  clampHover,
  FALL_LINE,
  hoverY,
  ISLAND,
  matchWinner,
  PIECES,
  pieceAt,
  roundSeed,
  towerTop,
} from './rules.ts'
import { simulateDrop } from './sim.ts'

const Mx = Matter as unknown as M

describe('animal stack rules', () => {
  it('deals the same pieces from the same seed', () => {
    const a = Array.from({ length: 20 }, (_, i) => pieceAt(7, i))
    const b = Array.from({ length: 20 }, (_, i) => pieceAt(7, i))
    expect(a).toEqual(b)
    expect(a.every((k) => k >= 0 && k < PIECES.length)).toBe(true)
  })

  it('measures the tower and the camera', () => {
    expect(towerTop([])).toBe(ISLAND.top)
    const b: BodySnap[] = [{ id: 1, k: 3, x: 500, y: ISLAND.top - 60, a: 0 }]
    expect(towerTop(b)).toBeLessThan(ISLAND.top - 60)
    expect(hoverY(b, 0)).toBeLessThan(towerTop(b))
    expect(cameraFor(1000)).toBe(0)
    expect(cameraFor(-200)).toBeGreaterThan(0)
  })

  it('deals each round its own pieces', () => {
    expect(roundSeed(7, 0)).toBe(7)
    const first = Array.from({ length: 20 }, (_, i) => pieceAt(7, i))
    const second = Array.from({ length: 20 }, (_, i) => pieceAt(roundSeed(7, 1), i))
    expect(second).not.toEqual(first)
  })

  it('takes the match at the chosen number of round wins', () => {
    expect(matchWinner([0, 0], 1)).toBeNull()
    expect(matchWinner([1, 0], 1)).toBe(0)
    expect(matchWinner([2, 1], 3)).toBeNull()
    expect(matchWinner([2, 3], 3)).toBe(1)
  })

  it('knows a fallen block', () => {
    expect(anyFallen([{ id: 1, k: 0, x: 500, y: FALL_LINE + 1, a: 0 }])).toBe(true)
    expect(anyFallen([{ id: 1, k: 0, x: 500, y: ISLAND.top - 50, a: 0 }])).toBe(false)
  })

  it('keeps the hover inside reach of the island', () => {
    expect(clampHover(-500, 0)).toBeGreaterThan(0)
    expect(clampHover(5000, 0)).toBeLessThan(1000)
  })

  it('places a trapezoid centroid below its box centre', () => {
    expect(trapCentroid({ w: 180, h: 80, slope: 0.4 })).toBeGreaterThan(0)
    expect(trapCentroid({ w: 180, h: 80, slope: 0 })).toBeCloseTo(0)
  })
})

describe('animal stack physics', () => {
  it('a centred drop lands on the island', () => {
    const o = simulateDrop(Mx, [], 3, ISLAND.x, 0)
    expect(o.fallen).toBe(false)
    expect(o.bodies).toHaveLength(1)
    expect(o.bodies[0]!.y).toBeLessThan(ISLAND.top)
  })

  it('a drop far off the edge falls', () => {
    const o = simulateDrop(Mx, [], 3, ISLAND.x + ISLAND.w / 2 + 110, 0, 400)
    expect(o.fallen).toBe(true)
  })

  it('bot vs bot reaches a result or a tall tower', () => {
    for (const d of ['easy', 'hard'] as Difficulty[]) {
      const rng = new Rng(3)
      let bodies: BodySnap[] = []
      let loser = -1
      for (let n = 0; n < 14 && loser < 0; n++) {
        const k = pieceAt(11, n)
        const plan = choose(Mx, bodies, k, d, rng)
        const o = simulateDrop(Mx, bodies, k, plan.x, plan.a, 400)
        bodies = o.bodies
        if (o.fallen) loser = n % 2
      }
      // Either someone toppled it, or the computer built at least a few storeys.
      expect(loser >= 0 || towerTop(bodies) < ISLAND.top - 300).toBe(true)
    }
  }, 30000)
})
