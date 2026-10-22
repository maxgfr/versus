import { describe, expect, it } from 'vitest'
import type { Difficulty } from '../../core/game.ts'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { FrogBot } from './bot.ts'
import {
  BUFFER_T,
  COLS,
  type Ev,
  type Frog,
  HOP_T,
  hopsFor,
  LEAP_T,
  newWorld,
  padIdx,
  RAMP,
  RAMP_DECIDER,
  rimDist,
  roundWinner,
  ROWS,
  SHOVE_T,
  SHRINK_T,
  shoveDest,
  sinkAt,
  STRANDED_T,
  stepWorld,
  type World,
} from './rules.ts'

const run = (w: World, n: number, taps: (number | undefined)[] = [], ev: Ev[] = []) => {
  for (let i = 0; i < n; i++) stepWorld(w, i === 0 ? taps : [], STEP, ev)
}
const wait = (w: World, s: number, ev: Ev[] = []) => run(w, Math.ceil(s / STEP) + 1, [], ev)
/** Step until nobody is in the air. */
const settle = (w: World, ev: Ev[] = []) => {
  for (let i = 0; i < 200 && w.frogs.some((f) => f.air); i++) stepWorld(w, [], STEP, ev)
}

/** Red on pad (c, r), blue on pad (c2, r2); everything else empty. */
function stage(red: [number, number], blue: [number, number]): [World, Frog, Frog] {
  const w = newWorld()
  const [r, b] = w.frogs
  if (!r || !b) throw new Error('frogs')
  r.pad = r.from = padIdx(red[0], red[1])
  b.pad = b.from = padIdx(blue[0], blue[1])
  return [w, r, b]
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
    // Plain JSON: it travels in online snapshots.
    expect(JSON.parse(JSON.stringify(w))).toEqual(w)
  })

  it('a frog can hop up to two pads away, not onto its own pad or off the pond', () => {
    const [w, red] = stage([0, 7], [4, 0])
    const hops = hopsFor(w, red)
    expect(hops).toContain(padIdx(2, 7))
    expect(hops).toContain(padIdx(1, 5))
    expect(hops).not.toContain(padIdx(0, 7))
    expect(hops.every((i) => i < COLS * ROWS)).toBe(true)
    // A 3 × 3 block at the corner, less the frog's own pad.
    expect(hops.length).toBe(8)
  })

  it('a tap hops the frog there; taps early in the flight are ignored', () => {
    const [w, red] = stage([2, 7], [4, 0])
    const target = padIdx(2, 5)
    stepWorld(w, [target, undefined], STEP, [])
    expect(red.pad).toBe(target)
    expect(red.from).toBe(padIdx(2, 7))
    expect(red.air).toBe(true)
    // A tap right after take-off is not buffered.
    stepWorld(w, [padIdx(2, 4), undefined], STEP, [])
    expect(red.queue).toBe(-1)
    settle(w)
    expect(red.pad).toBe(target)
    expect(red.air).toBe(false)
  })

  it('a landing is counted on touchdown, a long leap flies longer than a hop', () => {
    const [w, red] = stage([2, 7], [4, 0])
    const near = padIdx(2, 6)
    stepWorld(w, [near, undefined], STEP, [])
    expect(w.uses[near]).toBe(0)
    wait(w, HOP_T)
    expect(w.uses[near]).toBe(1)
    const far = padIdx(2, 4)
    stepWorld(w, [far, undefined], STEP, [])
    expect(red.power).toBe(2)
    wait(w, HOP_T)
    expect(red.air).toBe(true)
    wait(w, LEAP_T - HOP_T)
    expect(red.air).toBe(false)
    expect(w.uses[far]).toBe(1)
  })

  it('a tap just before touchdown is buffered and played on landing', () => {
    const [w, red] = stage([2, 7], [4, 0])
    stepWorld(w, [padIdx(2, 6), undefined], STEP, [])
    wait(w, HOP_T - BUFFER_T + 0.03)
    expect(red.air).toBe(true)
    stepWorld(w, [padIdx(2, 5), undefined], STEP, [])
    expect(red.queue).toBe(padIdx(2, 5))
    const ev: Ev[] = []
    wait(w, BUFFER_T, ev)
    // Landed on (2, 6) and took straight off again for (2, 5).
    expect(ev.filter((e) => e.k === 'hop').length).toBe(1)
    expect(red.pad).toBe(padIdx(2, 5))
    expect(red.from).toBe(padIdx(2, 6))
  })

  it('the shove lands with the attacker: one pad onward for a short hop', () => {
    const [w, red, blue] = stage([2, 5], [2, 4])
    const ev: Ev[] = []
    stepWorld(w, [padIdx(2, 4), undefined], STEP, ev)
    // Still in the air: the rival has not been touched yet.
    expect(blue.pad).toBe(padIdx(2, 4))
    expect(ev.some((e) => e.k === 'push')).toBe(false)
    wait(w, HOP_T, ev)
    expect(red.pad).toBe(padIdx(2, 4))
    expect(blue.pad).toBe(padIdx(2, 3))
    expect(blue.shoved).toBe(true)
    expect(blue.fellT).toBe(-1)
    expect(ev.find((e) => e.k === 'push')).toMatchObject({ d: 1, off: false })
    settle(w)
    expect(blue.air).toBe(false)
    expect(w.uses[padIdx(2, 3)]).toBe(1)
  })

  it('a long leap shoves twice as far', () => {
    const [w, , blue] = stage([2, 6], [2, 4])
    expect(shoveDest(w, padIdx(2, 6), padIdx(2, 4))).toBe(padIdx(2, 2))
    const ev: Ev[] = []
    stepWorld(w, [padIdx(2, 4), undefined], STEP, ev)
    settle(w, ev)
    expect(blue.pad).toBe(padIdx(2, 2))
    expect(ev.find((e) => e.k === 'push')).toMatchObject({ d: 2 })
  })

  it('a long leap knocks a rival two rows from the rim into the pond', () => {
    const [w, , blue] = stage([2, 3], [2, 1])
    stepWorld(w, [padIdx(2, 1), undefined], STEP, [])
    settle(w)
    expect(blue.fellT).toBeGreaterThanOrEqual(0)
    expect(blue.power).toBe(2)
    expect(roundWinner(w)).toBe(0)
  })

  it('a rival with no pad behind it falls in and loses the round', () => {
    const [w, red, blue] = stage([2, 1], [2, 0])
    const ev: Ev[] = []
    stepWorld(w, [padIdx(2, 0), undefined], STEP, ev)
    settle(w, ev)
    expect(blue.fellT).toBeGreaterThanOrEqual(0)
    expect(red.fellT).toBe(-1)
    expect(ev.some((e) => e.k === 'fall')).toBe(true)
    expect(roundWinner(w)).toBe(0)
  })

  it('a sunk pad behind the rival also drops it in', () => {
    const [w, , blue] = stage([2, 5], [2, 4])
    w.sunk[padIdx(2, 3)] = 1
    stepWorld(w, [padIdx(2, 4), undefined], STEP, [])
    settle(w)
    expect(blue.fellT).toBeGreaterThanOrEqual(0)
    expect(roundWinner(w)).toBe(0)
  })

  it('a rival can dodge: hopping away before the attacker lands', () => {
    const [w, red, blue] = stage([2, 5], [2, 4])
    stepWorld(w, [padIdx(2, 4), undefined], STEP, [])
    wait(w, HOP_T / 2)
    stepWorld(w, [undefined, padIdx(0, 4)], STEP, [])
    const ev: Ev[] = []
    settle(w, ev)
    expect(ev.some((e) => e.k === 'push')).toBe(false)
    expect(red.pad).toBe(padIdx(2, 4))
    expect(blue.pad).toBe(padIdx(0, 4))
    expect(blue.fellT).toBe(-1)
  })

  it('two frogs landing on one pad together clash and both bounce back: a tie favours nobody', () => {
    const [w, red, blue] = stage([2, 6], [2, 2])
    const mid = padIdx(2, 4)
    const ev: Ev[] = []
    stepWorld(w, [mid, mid], STEP, ev)
    settle(w, ev)
    expect(ev.some((e) => e.k === 'clash')).toBe(true)
    expect(ev.some((e) => e.k === 'push')).toBe(false)
    expect(red.pad).toBe(padIdx(2, 6))
    expect(blue.pad).toBe(padIdx(2, 2))
    expect(roundWinner(w)).toBeNull()
  })

  it('a clash bounce onto a pad that sank meanwhile drops that frog in', () => {
    const [w, red, blue] = stage([2, 6], [2, 2])
    w.uses[padIdx(2, 6)] = 3 // sinks as soon as red leaves it
    stepWorld(w, [padIdx(2, 4), padIdx(2, 4)], STEP, [])
    settle(w)
    expect(red.fellT).toBeGreaterThanOrEqual(0)
    expect(blue.fellT).toBe(-1)
    expect(roundWinner(w)).toBe(1)
  })

  it('a head-on hop onto each other just swaps the frogs', () => {
    const [w, red, blue] = stage([2, 5], [2, 4])
    const ev: Ev[] = []
    stepWorld(w, [padIdx(2, 4), padIdx(2, 5)], STEP, ev)
    settle(w, ev)
    expect(ev.some((e) => e.k === 'push' || e.k === 'clash')).toBe(false)
    expect(red.pad).toBe(padIdx(2, 4))
    expect(blue.pad).toBe(padIdx(2, 5))
  })

  it('the frog that lands second shoves the one already there', () => {
    const [w, red, blue] = stage([2, 6], [2, 2])
    const mid = padIdx(2, 4)
    stepWorld(w, [mid, undefined], STEP, [])
    run(w, 3)
    stepWorld(w, [undefined, mid], STEP, [])
    settle(w)
    // Red landed first; blue came down on it from the north with a long leap.
    expect(blue.pad).toBe(mid)
    expect(red.pad).toBe(padIdx(2, 6))
    expect(red.shoved).toBe(true)
    expect(SHOVE_T).toBeLessThan(HOP_T)
  })

  it('a pad sinks after it has been landed on three times, once nobody is on it', () => {
    const [w, red] = stage([2, 7], [4, 0])
    const a = padIdx(2, 6)
    const b = padIdx(2, 7)
    const hop = (t: number) => {
      stepWorld(w, [t, undefined], STEP, [])
      settle(w)
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
    expect(hopsFor(w, red)).not.toContain(a)
  })

  it('a pad a frog is flying to does not sink under it', () => {
    const [w, red] = stage([2, 7], [4, 0])
    const a = padIdx(2, 6)
    w.uses[a] = 3
    stepWorld(w, [a, undefined], STEP, [])
    run(w, 5)
    expect(w.sunk[a]).toBe(0)
    settle(w)
    expect(red.pad).toBe(a)
    expect(red.fellT).toBe(-1)
  })

  it('a frog with no pad in reach falls after a short while', () => {
    const [w, red] = stage([0, 7], [4, 0])
    for (const i of hopsFor(w, red)) w.sunk[i] = 1
    run(w, Math.ceil((STRANDED_T + 0.5) / STEP))
    expect(red.fellT).toBeGreaterThanOrEqual(0)
    expect(red.stranded).toBe(true)
    expect(roundWinner(w)).toBe(1)
  })

  it('once a frog is in, the survivor cannot be stranded or hop any more', () => {
    const [w, red, blue] = stage([0, 7], [4, 0])
    // Blue is in the pond; red is boxed in with no pad in reach.
    blue.fellT = 0
    blue.pad = -1
    for (const i of hopsFor(w, red)) w.sunk[i] = 1
    run(w, Math.ceil((STRANDED_T + 1) / STEP))
    expect(red.fellT).toBe(-1)
    expect(roundWinner(w)).toBe(0)
    w.sunk[padIdx(1, 7)] = 0
    stepWorld(w, [padIdx(1, 7), undefined], STEP, [])
    expect(red.air).toBe(false)
  })

  it('both out together is a draw', () => {
    const w = newWorld()
    for (const f of w.frogs) f.fellT = 0
    expect(roundWinner(w)).toBe('draw')
  })
})

describe('frog bot', () => {
  it('bots hop away from a leap aimed at their pad, hard far more often than easy', () => {
    const dodges = (d: Difficulty): number => {
      let n = 0
      for (let seed = 0; seed < 40; seed++) {
        const [w, red, blue] = stage([2, 6], [2, 4])
        const bot = new FrogBot(new Rng(seed), d)
        stepWorld(w, [padIdx(2, 4), undefined], STEP, [])
        const ev: Ev[] = []
        while (red.air) stepWorld(w, [undefined, bot.decide(w, blue, STEP)], STEP, ev)
        settle(w, ev)
        if (!ev.some((e) => e.k === 'push')) n++
      }
      return n
    }
    const easy = dodges('easy')
    const hard = dodges('hard')
    expect(hard).toBeGreaterThanOrEqual(26)
    expect(easy).toBeLessThan(hard / 2)
  })

  it('takes a lethal shove when one is on offer, from either side', () => {
    // Red can shove blue off the top rim; blue can shove red off the bottom rim.
    const [w, red, blue] = stage([2, 1], [2, 0])
    const r = new FrogBot(new Rng(1), 'normal')
    r['wait'] = 0
    expect(r.decide(w, red, STEP)).toBe(padIdx(2, 0))
    const [w2, red2, blue2] = stage([2, 7], [2, 6])
    const b = new FrogBot(new Rng(1), 'normal')
    b['wait'] = 0
    expect(b.decide(w2, blue2, STEP)).toBe(padIdx(2, 7))
    expect(red2.fellT + blue.fellT).toBe(-2)
  })

  const round = (seed: number, d: [Difficulty, Difficulty]): ReturnType<typeof roundWinner> => {
    const rng = new Rng(seed)
    const w = newWorld()
    const bots = w.frogs.map((_, i) => new FrogBot(rng.fork(), d[i] as Difficulty))
    let steps = 0
    while (roundWinner(w) === null && steps < 60 * 150) {
      const taps = w.frogs.map((f, i) => bots[i]?.decide(w, f, STEP))
      stepWorld(w, taps, STEP, [])
      steps++
    }
    return roundWinner(w)
  }

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`a ${difficulty} round is decided within bounded steps`, () => {
      for (let seed = 0; seed < 4; seed++)
        expect(round(seed * 23 + 5, [difficulty, difficulty])).not.toBeNull()
    })
  }

  /** Rounds the stronger bot wins out of `n`, sides alternating. */
  const wins = (strong: Difficulty, weak: Difficulty, n: number): number => {
    let won = 0
    for (let seed = 0; seed < n; seed++) {
      const swap = seed % 2 === 1
      const w = round(seed * 7 + 1, swap ? [weak, strong] : [strong, weak])
      if (w === (swap ? 1 : 0)) won++
    }
    return won
  }

  it('hard beats easy, on either side', () => {
    expect(wins('hard', 'easy', 12)).toBeGreaterThanOrEqual(11)
  })

  it('hard beats normal most of the time, on either side', () => {
    expect(wins('hard', 'normal', 24)).toBeGreaterThanOrEqual(17)
  })

  it('normal beats easy most of the time, on either side', () => {
    expect(wins('normal', 'easy', 12)).toBeGreaterThanOrEqual(10)
  })
})

describe('the pond weakens as a round drags on', () => {
  it('pads take three landings, then two, then one', () => {
    const w = newWorld()
    expect(sinkAt(w)).toBe(3)
    expect(sinkAt(w, RAMP[0])).toBe(2)
    expect(sinkAt(w, RAMP[1])).toBe(1)
    // A deciding round weakens sooner.
    const d = newWorld(RAMP_DECIDER)
    expect(RAMP_DECIDER[0]).toBeLessThan(RAMP[0])
    expect(sinkAt(d, RAMP_DECIDER[0])).toBe(2)
  })

  it('a twice-landed pad sinks once the pond has weakened, and the change is announced', () => {
    const [w] = stage([2, 7], [4, 0])
    const a = padIdx(2, 5)
    w.uses[a] = 2
    run(w, 3)
    expect(w.sunk[a]).toBe(0)
    w.t = RAMP[0] - STEP / 2
    const ev: Ev[] = []
    run(w, 2, [], ev)
    expect(ev.some((e) => e.k === 'ramp' && e.n === 2)).toBe(true)
    expect(w.sunk[a]).toBe(1)
  })

  it('late on, the rim sinks in mirrored pairs, never under a frog', () => {
    const [w, red, blue] = stage([0, 0], [4, 7])
    w.t = RAMP[1]
    const ev: Ev[] = []
    run(w, 1, [], ev)
    const sunk = ev.filter((e) => e.k === 'sink')
    // The corners not under a frog: (4, 0) and its mirror (0, 7).
    expect(sunk.length).toBe(2)
    expect(w.sunk[padIdx(4, 0)]).toBe(1)
    expect(w.sunk[padIdx(0, 7)]).toBe(1)
    expect(w.sunk[red.pad]).toBe(0)
    expect(w.sunk[blue.pad]).toBe(0)
    // Every SHRINK_T another pair goes, outermost first.
    run(w, Math.ceil(SHRINK_T / STEP))
    expect(w.sunk.filter((v) => v === 1).length).toBe(4)
    const afloat = w.sunk.map((v, i) =>
      v === 1 || i === red.pad || i === blue.pad ? 0 : rimDist(i),
    )
    const gone = w.sunk.map((v, i) => (v === 1 ? rimDist(i) : 9))
    expect(Math.max(...afloat)).toBeLessThanOrEqual(Math.min(...gone))
  })

  it('a frog in the air loses its landing pad to the rim and splashes in', () => {
    const [w, red] = stage([1, 6], [2, 0])
    // The other corners are gone: red leaps for the last one just as the rim starts to go.
    for (const i of [padIdx(0, 0), padIdx(4, 0), padIdx(4, 7)]) w.sunk[i] = 1
    w.t = RAMP[1] - 0.1
    w.shrinkT = RAMP[1]
    stepWorld(w, [padIdx(0, 7), undefined], STEP, [])
    settle(w)
    expect(red.fellT).toBeGreaterThanOrEqual(0)
    expect(roundWinner(w)).toBe(1)
  })

  it('two frogs that never move still get a result', () => {
    const w = newWorld()
    let n = 0
    while (roundWinner(w) === null && n < 60 * 120) {
      stepWorld(w, [], STEP, [])
      n++
    }
    expect(roundWinner(w)).not.toBeNull()
  })
})
