import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { bestAim, choose, expected, SPREAD } from './bot.ts'
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
  result,
  ROUNDS,
  scoreAt,
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
  total = ROUNDS,
  first?: Side,
): { s: State; steps: number } {
  const rng = new Rng(seed)
  const s = newState(first ?? (rng.chance(0.5) ? 0 : 1), total)
  let steps = 0
  while (!done(s) && steps < 60 * 60 * 10) {
    if (s.phase === 'aim') {
      const side = s.turn
      throwDart(s, landingOf(side, choose(side, side === 0 ? a : b, rng)))
    }
    advance(s, STEP)
    steps++
  }
  return { s, steps }
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

describe('darts turns', () => {
  it('three darts a turn, then the other side; a round ends with the blue turn', () => {
    const s = newState(0)
    const throwOne = () => {
      throwDart(s, BOARD)
      for (let i = 0; i < 60 * 3 && s.phase !== 'aim'; i++) advance(s, STEP)
    }
    throwOne()
    throwOne()
    expect(s.turn).toBe(0)
    expect(s.throws).toBe(2)
    throwOne()
    expect(s.turn).toBe(1)
    expect(s.throws).toBe(0)
    expect(s.totals[0]).toBe(150)
    expect(s.rounds).toBe(0)
    for (let i = 0; i < DARTS_PER_TURN; i++) {
      throwDart(s, at(0.4 * BOARD.r, -90))
      for (let k = 0; k < 60 * 3 && s.phase !== 'aim'; k++) advance(s, STEP)
    }
    expect(s.rounds).toBe(1)
    expect(s.turn).toBe(0)
    expect(s.totals[1]).toBe(60)
  })

  it('when blue opens, red still gets as many visits as blue (a round ends back with the opener)', () => {
    for (const first of [0, 1] as Side[]) {
      const r = match(31, 'normal', 'normal', 3, first)
      expect(done(r.s)).toBe(true)
      const red = r.s.darts.filter((d) => d.side === 0).length
      const blue = r.s.darts.filter((d) => d.side === 1).length
      expect(red).toBe(3 * DARTS_PER_TURN)
      expect(blue).toBe(3 * DARTS_PER_TURN)
    }
  })

  it('the computer aims where its arm scores most: treble 20 when steady, safer beds when shaky', () => {
    const hard = bestAim(SPREAD.hard)
    expect(scoreAt(hard).label).toBe('Treble 20')
    for (const d of ['easy', 'normal'] as const) {
      const sigma = SPREAD[d]
      expect(expected(bestAim(sigma), sigma)).toBeGreaterThanOrEqual(expected(T20, sigma))
    }
  })

  it('the highest total after five rounds wins, and equal totals draw', () => {
    const s = newState(0)
    s.totals = [120, 80]
    s.rounds = ROUNDS
    expect(result(s)).toBe(0)
    s.totals = [80, 80]
    expect(result(s)).toBe('draw')
    s.totals = [80, 81]
    expect(result(s)).toBe(1)
  })

  it('computer vs computer finishes all five rounds in bounded steps', () => {
    const r = match(12, 'normal', 'normal')
    expect(done(r.s)).toBe(true)
    expect(r.s.darts.length).toBe(ROUNDS * 2 * DARTS_PER_TURN)
    expect(r.steps).toBeLessThan(60 * 60 * 10)
  })

  it('the match length sets how many rounds are thrown', () => {
    // Red opens, so each side throws exactly two turns.
    const r = match(13, 'normal', 'normal', 2, 0)
    expect(r.s.total).toBe(2)
    expect(done(r.s)).toBe(true)
    expect(r.s.darts.length).toBe(2 * 2 * DARTS_PER_TURN)
  })

  it('a hard computer out-scores an easy one most of the time', () => {
    let wins = 0
    for (let seed = 1; seed <= 5; seed++) if (result(match(seed, 'hard', 'easy').s) === 0) wins++
    expect(wins).toBeGreaterThanOrEqual(3)
  })

  it('the throw starts at the thrower edge', () => {
    expect(EDGE[0].y).toBeGreaterThan(BOARD.y)
    expect(EDGE[1].y).toBeLessThan(BOARD.y)
  })
})
