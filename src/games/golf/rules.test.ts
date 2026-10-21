import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
import {
  advance,
  done,
  fire,
  type Hole,
  HOLES,
  holeOf,
  makeHole,
  MAX_STROKES,
  nextTurn,
  newState,
  plan,
  result,
  runShot,
  type State,
  stepBall,
  surfaceAt,
} from './rules.ts'

const flat = (over: Partial<Hole> = {}): Hole => ({
  par: 3,
  starter: 0,
  tee: { x: 500, y: 1560 },
  bend: { x: 500, y: 1100 },
  cup: { x: 500, y: 500 },
  bunkers: [],
  ponds: [],
  ...over,
})

/** Play one full game with the computer on both sides; returns the state and the step count. */
function game(
  seed: number,
  a: Difficulty,
  b: Difficulty,
  holes = HOLES,
): { s: State; steps: number } {
  const rng = new Rng(seed)
  const wind = () => (rng.chance(0.2) ? 0 : rng.range(-110, 110))
  const s = newState(rng, rng.chance(0.5) ? 0 : 1, wind(), holes)
  let steps = 0
  while (!done(s) && steps < 60 * 60 * 20) {
    if (s.phase === 'aim') {
      const d = s.turn === 0 ? a : b
      fire(s, choose(s, d, rng))
    }
    advance(s, STEP, wind)
    steps++
  }
  return { s, steps }
}

describe('golf course', () => {
  it('a seeded course is the same every time and sits inside the stage', () => {
    const a = makeHole(new Rng(7), 1, 0)
    const b = makeHole(new Rng(7), 1, 0)
    expect(a).toEqual(b)
    for (const p of [a.tee, a.cup, a.bend]) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(1000)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(1800)
    }
    expect(a.tee.y).toBeGreaterThan(1000) // red starts at the bottom
    expect(a.cup.y).toBeLessThan(900)
  })

  it('every hole starts from the starter end and alternates', () => {
    const s = newState(new Rng(3), 1, 0)
    expect(s.holes.map((h) => h.starter)).toEqual([1, 0, 1])
    expect(s.turn).toBe(1)
    expect(HOLES).toBe(3)
  })

  it('surfaces: the cup is green, the tee is tee, a pond is water, a bunker is sand', () => {
    const h = flat({
      ponds: [{ x: 500, y: 1300, r: 60 }],
      bunkers: [{ x: 700, y: 1200, r: 50 }],
    })
    expect(surfaceAt(h, 500, 500)).toBe('green')
    expect(surfaceAt(h, 500, 1560)).toBe('tee')
    expect(surfaceAt(h, 500, 1300)).toBe('water')
    expect(surfaceAt(h, 700, 1200)).toBe('sand')
    expect(surfaceAt(h, 900, 1200)).toBe('rough')
    expect(surfaceAt(h, 520, 1200)).toBe('fairway')
  })
})

describe('golf strokes', () => {
  it('a full-power lob carries far and lands on the fairway before rolling', () => {
    const h = flat()
    const b = plan(h, h.tee, { dx: 0, dy: -1, power: 1 })
    expect(b.air).toBe(true)
    let landed: { x: number; y: number } | null = null
    for (let i = 0; i < 600 && !landed; i++) {
      const hit = stepBall(b, STEP, 0, h)
      if (hit?.kind === 'land') landed = hit
      if (hit && hit.kind !== 'land') break
    }
    expect(landed).not.toBeNull()
    expect(1560 - (landed?.y ?? 0)).toBeGreaterThan(450)
  })

  it('a putt on the green rolls and stops, and a weak putt stops short of a strong one', () => {
    const h = flat()
    const from = { x: 500, y: 640 }
    const weak = runShot(h, from, { dx: 0, dy: -1, power: 0.3 }, 0)
    const strong = runShot(h, from, { dx: 0, dy: -1, power: 1 }, 0)
    expect(plan(h, from, { dx: 0, dy: -1, power: 1 }).air).toBe(false)
    expect(weak.kind).toBe('rest')
    expect(strong.kind === 'sunk' || strong.kind === 'rest').toBe(true)
    expect(strong.y).toBeLessThan(weak.y)
  })

  it('wind pushes a lob sideways', () => {
    const h = flat()
    const calm = runShot(h, h.tee, { dx: 0, dy: -1, power: 0.8 }, 0)
    const windy = runShot(h, h.tee, { dx: 0, dy: -1, power: 0.8 }, 100)
    expect(windy.x).toBeGreaterThan(calm.x + 20)
  })

  it('a stroke into a pond is a splash: +1 stroke and the ball drops back where it was played', () => {
    const h = flat({ ponds: [{ x: 500, y: 1380, r: 70 }] })
    const shot = { dx: 0, dy: -1, power: Math.sqrt(180 / 612.5) }
    expect(runShot(h, h.tee, shot, 0).kind).toBe('water')
    const s = newState(new Rng(1), 0, 0)
    s.holes = [h, h, h]
    s.turn = 0
    s.rest = [{ ...h.tee }, { ...h.tee }]
    fire(s, shot)
    for (let i = 0; i < 60 * 8 && s.phase !== 'beat'; i++) advance(s, STEP, () => 0)
    expect(s.phase).toBe('beat')
    expect(s.after).toBe('water')
    expect(s.strokes[0]).toBe(2)
    expect(s.balls[0].x).toBe(h.tee.x)
    expect(s.balls[0].y).toBe(h.tee.y)
  })

  it('the hole ends only once both balls are holed, then the next starts from its tee', () => {
    const h = flat()
    const s = newState(new Rng(2), 0, 0)
    s.holes = [h, h, h]
    s.turn = 0
    s.rest = [
      { x: 500, y: 540 },
      { x: 500, y: 545 },
    ]
    fire(s, { dx: 0, dy: -1, power: 0.3 })
    for (let i = 0; i < 60 * 8 && s.phase !== 'aim'; i++) advance(s, STEP, () => 0)
    expect(s.holed).toEqual([true, false])
    expect(s.card.length).toBe(0)
    expect(s.turn).toBe(1)
    fire(s, { dx: 0, dy: -1, power: 0.35 })
    for (let i = 0; i < 60 * 8 && s.card.length === 0; i++) advance(s, STEP, () => 0)
    expect(s.card).toEqual([[1, 1]])
    expect(s.hole).toBe(1)
    expect(s.rest).toEqual([h.tee, h.tee])
  })

  it('a ball still out after the cap is picked up and scores the cap', () => {
    const h = flat()
    const s = newState(new Rng(2), 0, 0)
    s.holes = [h, h, h]
    s.turn = 0
    s.strokes = [MAX_STROKES - 1, 0]
    fire(s, { dx: 1, dy: 0, power: 0.2 })
    for (let i = 0; i < 60 * 8 && s.phase !== 'aim'; i++) advance(s, STEP, () => 0)
    expect(s.holed[0]).toBe(true)
    expect(s.strokes[0]).toBe(MAX_STROKES)
    expect(s.turn).toBe(1)
  })
})

describe('golf game', () => {
  it('computer vs computer finishes all holes in bounded steps', () => {
    const r = game(11, 'normal', 'normal')
    expect(done(r.s)).toBe(true)
    expect(r.s.card.length).toBe(HOLES)
    expect(r.steps).toBeLessThan(60 * 60 * 20)
    expect(['0', '1', 'draw']).toContain(String(result(r.s)))
  })

  it('the match length sets how many holes are played', () => {
    const r = game(12, 'normal', 'normal', 1)
    expect(r.s.holes.length).toBe(1)
    expect(done(r.s)).toBe(true)
    expect(r.s.card.length).toBe(1)
  })

  it('a hard computer takes no more strokes than an easy one over several courses', () => {
    let hard = 0
    let easy = 0
    for (let seed = 1; seed <= 4; seed++) {
      const r = game(seed, 'hard', 'easy')
      hard += r.s.strokes[0]
      easy += r.s.strokes[1]
    }
    expect(hard).toBeLessThanOrEqual(easy)
  })

  it('the ball farthest from the cup plays next', () => {
    const s = newState(new Rng(5), 0, 0)
    const rng = new Rng(9)
    fire(s, choose(s, 'normal', rng))
    let t = 0
    while (s.phase !== 'aim' && t < 60 * 30) {
      advance(s, STEP, () => 0)
      t++
    }
    // Red has played off the tee, so blue (still on the tee) is away.
    expect(s.turn).toBe(1)
    s.rest[1] = { ...holeOf(s).cup, y: holeOf(s).cup.y + (s.holes[0]?.starter === 0 ? 30 : -30) }
    expect(nextTurn({ ...s, turn: 1 })).toBe(0)
  })
})
