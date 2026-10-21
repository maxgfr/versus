import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { FrogBot } from './bot.ts'
import {
  COLS,
  type Ev,
  HOP_T,
  hopsFor,
  newWorld,
  padIdx,
  roundWinner,
  ROWS,
  STRANDED_T,
  stepWorld,
  type World,
} from './rules.ts'

const run = (w: World, n: number, taps: (number | undefined)[] = [], ev: Ev[] = []) => {
  for (let i = 0; i < n; i++) stepWorld(w, i === 0 ? taps : [], STEP, ev)
}
const wait = (w: World, s: number) => run(w, Math.ceil(s / STEP) + 1)

/** Red on pad (c, r), blue on pad (c2, r2); everything else empty. */
function stage(red: [number, number], blue: [number, number]): World {
  const w = newWorld()
  const [r, b] = w.frogs
  if (!r || !b) throw new Error('frogs')
  r.pad = r.from = padIdx(red[0], red[1])
  b.pad = b.from = padIdx(blue[0], blue[1])
  return w
}

describe('frog pond', () => {
  it('starts on a 5 by 8 grid, red at the bottom, blue at the top, mirrored', () => {
    expect(COLS).toBe(5)
    expect(ROWS).toBe(8)
    const w = newWorld()
    const [red, blue] = w.frogs
    expect(red?.pad).toBe(padIdx(2, ROWS - 1))
    expect(blue?.pad).toBe(padIdx(2, 0))
    expect(roundWinner(w)).toBeNull()
  })

  it('a frog can hop up to two pads away, not onto its own pad or off the pond', () => {
    const w = stage([0, 7], [4, 0])
    const red = w.frogs[0]
    if (!red) throw new Error('red')
    const hops = hopsFor(w, red)
    expect(hops).toContain(padIdx(2, 7))
    expect(hops).toContain(padIdx(1, 5))
    expect(hops).not.toContain(padIdx(0, 7))
    expect(hops.every((i) => i < COLS * ROWS)).toBe(true)
    // A 3 × 3 block at the corner, less the frog's own pad.
    expect(hops.length).toBe(8)
  })

  it('a tap hops the frog there and it is in the air for a short time', () => {
    const w = stage([2, 7], [4, 0])
    const red = w.frogs[0]
    if (!red) throw new Error('red')
    const target = padIdx(2, 5)
    stepWorld(w, [target, undefined], STEP, [])
    expect(red.pad).toBe(target)
    expect(red.from).toBe(padIdx(2, 7))
    // Taps while in the air are ignored.
    stepWorld(w, [padIdx(2, 4), undefined], STEP, [])
    expect(red.pad).toBe(target)
    wait(w, HOP_T)
    expect(red.pad).toBe(target)
  })

  it('a hop onto the rival pushes it one pad onward in the hop direction', () => {
    const w = stage([2, 5], [2, 4])
    const red = w.frogs[0]
    const blue = w.frogs[1]
    if (!red || !blue) throw new Error('frogs')
    const ev: Ev[] = []
    stepWorld(w, [padIdx(2, 4), undefined], STEP, ev)
    expect(red.pad).toBe(padIdx(2, 4))
    expect(blue.pad).toBe(padIdx(2, 3))
    expect(blue.fellT).toBe(-1)
    expect(ev.some((e) => e.k === 'push')).toBe(true)
  })

  it('a rival with no pad behind it falls in and loses the round', () => {
    const w = stage([0, 3], [2, 0])
    const red = w.frogs[0]
    const blue = w.frogs[1]
    if (!red || !blue) throw new Error('frogs')
    // Put blue on the top rim: a push north sends it off the board.
    blue.pad = blue.from = padIdx(2, 0)
    red.pad = red.from = padIdx(2, 1)
    const ev: Ev[] = []
    stepWorld(w, [padIdx(2, 0), undefined], STEP, ev)
    expect(blue.fellT).toBeGreaterThanOrEqual(0)
    expect(ev.some((e) => e.k === 'fall')).toBe(true)
    expect(roundWinner(w)).toBe(0)
  })

  it('a pad with no pad behind it that is sunk also drops the rival in', () => {
    const w = stage([2, 5], [2, 4])
    const red = w.frogs[0]
    const blue = w.frogs[1]
    if (!red || !blue) throw new Error('frogs')
    w.sunk[padIdx(2, 3)] = 1
    stepWorld(w, [padIdx(2, 4), undefined], STEP, [])
    expect(blue.fellT).toBeGreaterThanOrEqual(0)
    expect(roundWinner(w)).toBe(0)
  })

  it('a pad sinks after it has been landed on three times, once nobody is on it', () => {
    const w = stage([2, 7], [4, 0])
    const a = padIdx(2, 6)
    const b = padIdx(2, 7)
    // Each hop lands the red frog; the pads are A = (2, 6) and B = (2, 7).
    const hop = (t: number) => {
      stepWorld(w, [t, undefined], STEP, [])
      wait(w, HOP_T)
    }
    hop(a)
    hop(b)
    hop(a)
    hop(b)
    hop(a)
    expect(w.uses[a]).toBe(3)
    // Red is standing on A: it does not sink under her.
    expect(w.sunk[a]).toBe(0)
    hop(b)
    // Red has left: A is empty and worn out, so it sinks.
    expect(w.sunk[a]).toBe(1)
    expect(w.sunk[b]).toBe(0)
    expect(hopsFor(w, w.frogs[0] as NonNullable<(typeof w.frogs)[number]>)).not.toContain(a)
  })

  it('a frog with no pad in reach falls after a short while', () => {
    const w = stage([0, 7], [4, 0])
    const red = w.frogs[0]
    if (!red) throw new Error('red')
    for (const i of hopsFor(w, red)) w.sunk[i] = 1
    run(w, Math.ceil((STRANDED_T + 0.5) / STEP))
    expect(red.fellT).toBeGreaterThanOrEqual(0)
    expect(red.stranded).toBe(true)
    expect(roundWinner(w)).toBe(1)
  })

  it('both out together is a draw', () => {
    const w = newWorld()
    for (const f of w.frogs) f.fellT = 0
    expect(roundWinner(w)).toBe('draw')
  })
})

describe('frog bot vs bot', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`a ${difficulty} round is decided within bounded steps`, () => {
      for (let seed = 0; seed < 4; seed++) {
        const rng = new Rng(seed * 23 + 5)
        const w = newWorld()
        const bots = w.frogs.map(() => new FrogBot(rng.fork(), difficulty))
        let steps = 0
        while (roundWinner(w) === null && steps < 60 * 150) {
          const taps = w.frogs.map((f, i) => bots[i]?.decide(w, f, STEP))
          stepWorld(w, taps, STEP, [])
          steps++
        }
        expect(roundWinner(w)).not.toBeNull()
      }
    })
  }
})
