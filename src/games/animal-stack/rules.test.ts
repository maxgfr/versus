import Matter from 'matter-js'
import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import type { BodySnap, M } from '../../engines/ragdoll/index.ts'
import { choose } from './bot.ts'
import {
  anyFallen,
  cameraFor,
  clampHover,
  FALL_LINE,
  hoverY,
  ISLAND,
  landingOf,
  matchWinner,
  PIECES,
  pieceAt,
  roundSeed,
  swayOf,
  toyOf,
  towerTop,
} from './rules.ts'
import { rebuild, simulateDrop } from './sim.ts'
import { bottomOf, isConvex } from './toy.ts'

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

  it('every animal is built from convex parts, centred on its centre of mass', () => {
    for (const t of PIECES) {
      for (const part of t.parts) expect(isConvex(part.pts), t.name).toBe(true)
      // Area-weighted centre of the parts sits at the origin.
      let mx = 0
      let my = 0
      let area = 0
      for (const part of t.parts) {
        const p = part.pts
        let a = 0
        let cx = 0
        let cy = 0
        for (let i = 0; i < p.length; i += 2) {
          const j = (i + 2) % p.length
          const cr = p[i]! * p[j + 1]! - p[j]! * p[i + 1]!
          a += cr
          cx += (p[i]! + p[j]!) * cr
          cy += (p[i + 1]! + p[j + 1]!) * cr
        }
        mx += cx / 6
        my += cy / 6
        area += a / 2
      }
      expect(Math.abs(mx / area), t.name).toBeLessThan(0.5)
      expect(Math.abs(my / area), t.name).toBeLessThan(0.5)
    }
  })

  it('mixes sizes and weights', () => {
    const r = PIECES.map((t) => t.radius)
    const d = PIECES.map((t) => t.density)
    expect(Math.max(...r) / Math.min(...r)).toBeGreaterThan(1.5)
    expect(Math.max(...d) / Math.min(...d)).toBeGreaterThan(2)
  })

  it('the crane sways wider as the tower grows, and not at all at the start', () => {
    expect(swayOf(0, 0.7)).toBe(0)
    const amp = (n: number) => Math.max(...Array.from({ length: 200 }, (_, i) => swayOf(n, i / 30)))
    expect(amp(8)).toBeGreaterThan(amp(4))
    expect(amp(30)).toBeLessThanOrEqual(90)
  })

  it('previews the landing on the island, and nothing over the sea', () => {
    const y = landingOf([], 3, ISLAND.x, 0)
    expect(y).not.toBeNull()
    expect(bottomOf(toyOf(3), ISLAND.x, y as number, 0)).toBeCloseTo(ISLAND.top, 5)
    expect(landingOf([], 3, ISLAND.x + ISLAND.w / 2 + 300, 0)).toBeNull()
  })
})

describe('animal stack physics', () => {
  it('a centred drop lands on the island', () => {
    const o = simulateDrop(Mx, [], 3, ISLAND.x, 0)
    expect(o.fallen).toBe(false)
    expect(o.bodies).toHaveLength(1)
    expect(o.bodies[0]!.y).toBeLessThan(ISLAND.top)
  })

  it('every animal comes to rest on the island without sinking or creeping', () => {
    for (let k = 0; k < PIECES.length; k++) {
      const o = simulateDrop(Mx, [], k, ISLAND.x, 0, 600)
      const b = o.bodies[0]!
      const t = toyOf(k)
      expect(o.fallen, t.name).toBe(false)
      // Resting on the grass: its lowest point within a hair of the island top.
      expect(Math.abs(bottomOf(t, b.x, b.y, b.a) - ISLAND.top), t.name).toBeLessThan(2)
      // Left alone, it stays put (no jitter, no slow slide).
      const w = rebuild(Mx, o.bodies)
      for (let i = 0; i < 120; i++) w.step(1 / 60)
      const a = w.snap()[0]!
      expect(Math.hypot(a.x - b.x, a.y - b.y), t.name).toBeLessThan(2)
    }
  }, 30000)

  it('a stacked pair never sinks one animal into the other', () => {
    const base = simulateDrop(Mx, [], 7, ISLAND.x, 0, 600).bodies
    const o = simulateDrop(Mx, base, 13, base[0]!.x, 0, 600)
    expect(o.fallen).toBe(false)
    const top = o.bodies.find((b) => b.k === 13)!
    const low = o.bodies.find((b) => b.k === 7)!
    // The upper one rests above the lower one's centre, not inside it.
    expect(top.y).toBeLessThan(low.y - 40)
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
