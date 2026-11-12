import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { aimFor, bedOf, bestAim, choose, expected, SPREAD } from './bot.ts'
import {
  advance,
  BOARD,
  DARTS_PER_TURN,
  done,
  EDGE,
  flickFor,
  idealFlick,
  landingOf,
  newState,
  type Pt,
  finishOf,
  result,
  scoreAt,
  scoreDart,
  type State,
  sagOf,
  sagVec,
  segmentAt,
  SOFT,
  T20,
  throwDart,
  WILD,
  wobble,
} from './rules.ts'

const at = (r: number, deg: number): Pt => ({
  x: BOARD.x + Math.cos((deg * Math.PI) / 180) * r,
  y: BOARD.y + Math.sin((deg * Math.PI) / 180) * r,
})

/** Play a whole match with the computer on both sides; returns the state and the steps taken. */
function match(
  seed: number,
  a: Difficulty,
  b: Difficulty,
  legs = 1,
  first?: Side,
  start = 501,
): { s: State; steps: number } {
  const rng = new Rng(seed)
  const s = newState(first ?? (rng.chance(0.5) ? 0 : 1), legs, start)
  let steps = 0
  while (!done(s) && steps < 60 * 60 * 30) {
    if (s.phase === 'aim') {
      const side = s.turn
      throwDart(s, landingOf(side, choose(side, side === 0 ? a : b, rng, s.left[side])))
    }
    advance(s, STEP)
    steps++
  }
  return { s, steps }
}

/** Throw one dart at `p` and let it land and the pause run out. */
function throwAt(s: State, p: Pt): void {
  throwDart(s, p)
  for (let i = 0; i < 60 * 3 && s.phase !== 'aim' && !done(s); i++) advance(s, STEP)
}

describe('dartboard', () => {
  it('the centre is the bull, the next ring the outer bull, the middle a miss off the wire', () => {
    expect(scoreAt(BOARD)).toMatchObject({ pts: 50, ring: 'bull' })
    expect(scoreAt(at(0.07 * BOARD.r, 0))).toMatchObject({ pts: 25, ring: 'outer' })
    expect(scoreAt(at(410, 0))).toMatchObject({ pts: 0, ring: 'miss' })
  })

  it('segments run clockwise from 20 at the top, with trebles and doubles on their rings', () => {
    expect(scoreAt(at(0.4 * BOARD.r, -90)).pts).toBe(20)
    expect(scoreAt(at(0.4 * BOARD.r, -72)).pts).toBe(1)
    expect(scoreAt(at(0.4 * BOARD.r, 90)).pts).toBe(3) // bottom of the board is 3
    expect(scoreAt(at(0.6 * BOARD.r, -90))).toMatchObject({
      pts: 60,
      label: 'Treble 20',
      ring: 'treble',
    })
    expect(scoreAt(at(0.97 * BOARD.r, -90))).toMatchObject({
      pts: 40,
      label: 'Double 20',
      ring: 'double',
    })
    expect(segmentAt(0, -1)).toBe(20)
  })
})

describe('flick to landing', () => {
  it('the ideal flick from each edge lands on the centre', () => {
    for (const side of [0, 1] as Side[]) {
      const p = landingOf(side, idealFlick(side))
      expect(p.x).toBeCloseTo(BOARD.x, 6)
      expect(p.y).toBeCloseTo(BOARD.y, 6)
    }
  })

  it('a longer flick than ideal from the red edge lands above the centre, and blue mirrors it', () => {
    const longer = { x: 0, y: idealFlick(0).y * 1.1 }
    expect(landingOf(0, longer).y).toBeLessThan(BOARD.y)
    const longerB = { x: 0, y: idealFlick(1).y * 1.1 }
    expect(landingOf(1, longerB).y).toBeGreaterThan(BOARD.y)
  })

  it('the bot flick for a target lands on that target', () => {
    const target = { x: 620, y: 700 }
    const p = landingOf(0, flickFor(0, target))
    expect(p.x).toBeCloseTo(target.x, 6)
    expect(p.y).toBeCloseTo(target.y, 6)
  })

  it('a faster flick wobbles more', () => {
    const spread = (speed: number) => {
      const rng = new Rng(3)
      const xs = Array.from({ length: 400 }, () => wobble(rng, speed).x)
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
    }
    expect(spread(5000)).toBeGreaterThan(spread(1000) * 4)
    // A crisp release is as tight as a gentle one.
    expect(spread(WILD - 1)).toBeCloseTo(spread(SOFT), 6)
  })

  it('a limp release sags short, back toward the thrower, and a crisp one does not', () => {
    expect(sagOf(0)).toBeGreaterThan(30)
    expect(sagOf(SOFT)).toBe(0)
    expect(sagOf(1500)).toBe(0)
    // Red throws up the screen: short is lower (larger y). Blue mirrors it.
    expect(sagVec(0, 0).y).toBeGreaterThan(0)
    expect(sagVec(1, 0).y).toBeLessThan(0)
  })

  it('a harder throw flies faster', () => {
    const a = newState(0)
    throwDart(a, BOARD, 0)
    const b = newState(0)
    throwDart(b, BOARD, 1)
    expect(b.flight!.dur).toBeLessThan(a.flight!.dur)
    expect(b.flight!.force).toBe(1)
  })

  it('a dart that misses the board still lands on the surround, not off the table', () => {
    const s = newState(0)
    throwDart(s, { x: BOARD.x, y: BOARD.y - 2000 })
    expect(s.flight?.to.y).toBeGreaterThan(BOARD.y - BOARD.r * 1.2)
    expect(s.flight?.pts).toBe(0)
  })
})

describe('darts turns (501, double out)', () => {
  it('every dart comes off the score; three darts a visit, then the other side', () => {
    const s = newState(0)
    expect(s.left).toEqual([501, 501])
    throwAt(s, BOARD)
    throwAt(s, BOARD)
    expect(s.turn).toBe(0)
    expect(s.throws).toBe(2)
    throwAt(s, BOARD)
    expect(s.turn).toBe(1)
    expect(s.throws).toBe(0)
    expect(s.left[0]).toBe(501 - 150)
    expect(s.rounds).toBe(0)
    for (let i = 0; i < DARTS_PER_TURN; i++) throwAt(s, at(0.4 * BOARD.r, -90))
    expect(s.rounds).toBe(1)
    expect(s.turn).toBe(0)
    expect(s.left[1]).toBe(501 - 60)
  })

  it('a leg is won on exactly zero with a double, the bull counting as one', () => {
    expect(scoreDart(40, 40, 'double')).toBe('checkout')
    expect(scoreDart(50, 50, 'bull')).toBe('checkout')
    expect(scoreDart(100, 60, 'treble')).toBe(40)
  })

  it('a bust (below zero, one, or zero off a double) wipes the visit', () => {
    expect(scoreDart(20, 20, 'single')).toBe('bust')
    expect(scoreDart(20, 19, 'single')).toBe('bust')
    expect(scoreDart(20, 40, 'double')).toBe('bust')
    const s = newState(0)
    s.left = [70, 501]
    s.visitFrom = 70
    // Single 20 → 50, then treble 20 would go below zero: back to 70, and the visit is over.
    throwAt(s, bedOf(20, 'single'))
    expect(s.left[0]).toBe(50)
    throwAt(s, bedOf(20, 'treble'))
    expect(s.left[0]).toBe(70)
    expect(s.turn).toBe(1)
    expect(s.throws).toBe(0)
  })

  it('checking out takes the leg; the next leg restarts both scores and the other player opens', () => {
    const s = newState(0, 2)
    s.left = [32, 200]
    s.visitFrom = 32
    throwAt(s, bedOf(16, 'double'))
    expect(s.legs).toEqual([1, 0])
    expect(done(s)).toBe(false)
    expect(s.left).toEqual([501, 501])
    expect(s.turn).toBe(1)
    expect(s.first).toBe(1)
    s.left = [501, 40]
    s.visitFrom = 40
    throwAt(s, bedOf(20, 'double'))
    expect(s.legs).toEqual([1, 1])
    s.turn = 0
    s.left = [50, 40]
    s.visitFrom = 50
    throwAt(s, BOARD)
    expect(done(s)).toBe(true)
    expect(result(s)).toBe(0)
  })

  it('shows the double that finishes, once one dart can', () => {
    expect(finishOf(40)).toBe('D20')
    expect(finishOf(2)).toBe('D1')
    expect(finishOf(50)).toBe('Bull')
    expect(finishOf(41)).toBeNull()
    expect(finishOf(60)).toBeNull()
  })

  it('the computer sets up a double and goes for it, never into a bust', () => {
    expect(scoreAt(aimFor(32, SPREAD.hard)).label).toBe('Double 16')
    expect(scoreAt(aimFor(50, SPREAD.hard)).ring).toBe('bull')
    // 41: a single 9 leaves 32 (double 16).
    expect(left41()).toBe(32)
    for (let left = 2; left <= 61; left++) {
      const p = aimFor(left, SPREAD.hard)
      const sc = scoreAt(p)
      expect(scoreDart(left, sc.pts, sc.ring), `left ${left}`).not.toBe('bust')
    }
  })

  it('the computer aims where its arm scores most far from the finish: treble 20 when steady', () => {
    const hard = bestAim(SPREAD.hard)
    expect(scoreAt(hard).label).toBe('Treble 20')
    for (const d of ['easy', 'normal'] as const) {
      const sigma = SPREAD[d]
      expect(expected(bestAim(sigma), sigma)).toBeGreaterThanOrEqual(expected(T20, sigma))
    }
  })

  it('computer vs computer checks out a leg of 501 in bounded steps, at every level', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const r = match(12, d, d)
      expect(done(r.s), d).toBe(true)
      expect(r.s.legs[0] + r.s.legs[1]).toBe(1)
    }
  })

  it('the match length is the legs to win, and 301 is shorter', () => {
    const r = match(13, 'normal', 'normal', 2, 0)
    expect(Math.max(...r.s.legs)).toBe(2)
    const long = match(14, 'hard', 'hard', 1, 0, 501).s
    const short = match(14, 'hard', 'hard', 1, 0, 301).s
    expect(short.start).toBe(301)
    expect(done(short)).toBe(true)
    expect(long.start).toBe(501)
  })

  it('a hard computer beats an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) if (result(match(seed, 'hard', 'easy').s) === 0) wins++
    expect(wins).toBeGreaterThanOrEqual(4)
  })

  it('the throw starts at the thrower edge', () => {
    expect(EDGE[0].y).toBeGreaterThan(BOARD.y)
    expect(EDGE[1].y).toBeLessThan(BOARD.y)
  })
})

/** What a single 9 (the computer's pick on 41) leaves. */
function left41(): number {
  const sc = scoreAt(aimFor(41, SPREAD.hard))
  return 41 - sc.pts
}
