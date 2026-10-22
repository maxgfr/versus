import { describe, expect, it } from 'vitest'
import { STEP, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { DanceBot } from './bot.ts'
import {
  arrowY,
  BEAT,
  BOUNCE,
  chartNew,
  DURATION,
  dancerNew,
  expire,
  GOOD,
  hitsFor,
  LANE_X,
  LANES,
  laneAt,
  LEAD,
  PAD_Y,
  PERFECT,
  pointsFor,
  press,
  SPAWN_Y,
  START,
  winnerOf,
  worldNew,
  type Dancer,
  type Note,
  type State,
} from './rules.ts'

/** A chart with one arrow in each given lane mask at the given times. */
const chartOf = (...notes: [number, number][]): Note[] => notes.map(([t, lanes]) => ({ t, lanes }))

describe('disco battle: chart', () => {
  it('is the same for the same seed', () => {
    expect(chartNew(new Rng(5))).toEqual(chartNew(new Rng(5)))
  })

  it('lands on the beat grid from the start, inside the song', () => {
    const chart = chartNew(new Rng(9))
    expect(chart.length).toBeGreaterThan(40)
    for (const n of chart) {
      expect(n.t).toBeGreaterThanOrEqual(START)
      expect(n.t).toBeLessThan(DURATION)
      const k = (n.t - START) / (BEAT / 2)
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6)
      expect(n.lanes).toBeGreaterThan(0)
      expect(n.lanes).toBeLessThan(1 << LANES)
    }
  })

  it('expands each note into one hit per lane, in time order', () => {
    const hits = hitsFor(chartOf([2, 0b0011], [2.5, 0b1000]))
    expect(hits.map((h) => [h.t, h.lane])).toEqual([
      [2, 0],
      [2, 1],
      [2.5, 3],
    ])
    expect(hits.every((h) => h.r === 0)).toBe(true)
  })

  it('both players get the same chart', () => {
    const s = worldNew(new Rng(12))
    expect(s.p[0].hits).toEqual(s.p[1].hits)
  })
})

describe('disco battle: pressing', () => {
  it('a press dead on the arrow is perfect, a bit late is good', () => {
    const d = dancerNew(chartOf([2, 0b0001], [3, 0b0001]))
    expect(press(d, 0, 2)).toBe('perfect')
    expect(press(d, 0, 3 + PERFECT + 0.02)).toBe('good')
  })

  it('a press outside the good window is stray and changes nothing', () => {
    const d = dancerNew(chartOf([2, 0b0001]))
    expect(press(d, 0, 2 + GOOD + 0.05)).toBeNull()
    expect(press(d, 1, 2)).toBeNull()
    expect(d.score).toBe(0)
    expect(d.hits[0]?.r).toBe(0)
  })

  it('a hit resolves the arrow only once', () => {
    const d = dancerNew(chartOf([2, 0b0001]))
    expect(press(d, 0, 2)).toBe('perfect')
    expect(press(d, 0, 2)).toBeNull()
  })

  it('combos add up and multiply the points in steps of ten', () => {
    expect(pointsFor('perfect', 1)).toBe(100)
    expect(pointsFor('perfect', 10)).toBe(200)
    expect(pointsFor('good', 25)).toBe(150)
    expect(pointsFor('perfect', 99)).toBe(400)
  })

  it('a miss breaks the combo', () => {
    const d = dancerNew(chartOf([2, 0b0001], [2.5, 0b0001]))
    press(d, 0, 2)
    expect(d.combo).toBe(1)
    expect(expire(d, 2.5 + GOOD + 0.01)).toBe(1)
    expect(d.combo).toBe(0)
    expect(d.misses).toBe(1)
    expect(d.judge).toBe('miss')
  })

  it('arrows that pass unhit are expired, not hit later', () => {
    const d = dancerNew(chartOf([2, 0b0011]))
    expect(expire(d, 2 + GOOD + 0.01)).toBe(2)
    expect(press(d, 0, 2)).toBeNull()
  })

  it('chords need every lane: one press resolves one lane', () => {
    const d = dancerNew(chartOf([2, 0b0101]))
    expect(press(d, 0, 2)).toBe('perfect')
    expect(d.hits.filter((h) => h.r === 0)).toHaveLength(1)
    expect(press(d, 2, 2)).toBe('perfect')
  })

  it('the best combo is kept after it breaks', () => {
    const d = dancerNew(chartOf([2, 1], [2.5, 1], [3, 1]))
    press(d, 0, 2)
    press(d, 0, 2.5)
    expire(d, 3 + GOOD + 0.01)
    expect(d.combo).toBe(0)
    expect(d.best).toBe(2)
  })
})

describe('disco battle: no free mashing', () => {
  it('a tap on a pad with nothing to hit is a whiff and breaks the combo', () => {
    const d = dancerNew(chartOf([2, 0b0001], [2.5, 0b0001], [3, 0b0001]))
    press(d, 0, 2)
    press(d, 0, 2.5)
    expect(d.combo).toBe(2)
    expect(press(d, 3, 2.7)).toBeNull()
    expect(d.whiffs).toBe(1)
    expect(d.combo).toBe(0)
    expect(d.best).toBe(2)
    expect(d.judge).toBe('miss')
    // The arrow it did not touch is still there to hit.
    expect(press(d, 0, 3)).toBe('perfect')
  })

  it('a finger bouncing on the pad it just hit is forgiven', () => {
    const d = dancerNew(chartOf([2, 0b0001], [2.5, 0b0001]))
    press(d, 0, 2)
    expect(press(d, 0, 2 + BOUNCE * 0.5)).toBeNull()
    expect(d.combo).toBe(1)
    expect(d.whiffs).toBe(0)
  })

  it('a whiff with no combo costs nothing but is counted', () => {
    const d = dancerNew(chartOf([2, 0b0001]))
    expect(press(d, 2, 1)).toBeNull()
    expect(d.whiffs).toBe(1)
    expect(d.score).toBe(0)
    expect(d.judge).toBe('')
  })

  it('mashing every pad scores far less than dancing on the beat', () => {
    const rng = new Rng(8)
    const s = worldNew(rng)
    const masher = s.p[0]
    const bot = new DanceBot(rng.fork(), 'normal')
    for (let t = STEP, k = 0; t < DURATION; t += STEP, k++) {
      expire(masher, t)
      expire(s.p[1], t)
      // Four fingers drumming all pads about 12 times a second each.
      if (k % 5 === 0) for (let lane = 0; lane < LANES; lane++) press(masher, lane, t)
      for (const lane of bot.step(t, s.p[1])) press(s.p[1], lane, t)
    }
    expect(s.p[1].score).toBeGreaterThan(masher.score * 1.5)
    expect(masher.best).toBeLessThan(10)
  })

  it('records how early or late the last hit was', () => {
    const d = dancerNew(chartOf([2, 0b0001], [3, 0b0001]))
    press(d, 0, 1.95)
    expect(d.err).toBeCloseTo(-0.05, 6)
    press(d, 0, 3.08)
    expect(d.err).toBeCloseTo(0.08, 6)
  })
})

describe('disco battle: geometry', () => {
  it('an arrow scrolls from the spawn line to the pad over LEAD seconds', () => {
    const h = { t: 4, lane: 0, r: 0 as const }
    expect(arrowY(h, 4 - LEAD)).toBeCloseTo(SPAWN_Y, 6)
    expect(arrowY(h, 4)).toBeCloseTo(PAD_Y, 6)
  })

  it('a tap lands in the lane under it, on the pad row only', () => {
    expect(laneAt(0, LANE_X[2] as number, PAD_Y)).toBe(2)
    expect(laneAt(0, LANE_X[0] as number, PAD_Y - 20)).toBe(0)
    expect(laneAt(0, LANE_X[0] as number, 800)).toBeNull()
    // Blue's own lanes are mirrored on the table: its pad row is near y 340.
    expect(laneAt(1, 1000 - (LANE_X[1] as number), 1800 - PAD_Y)).toBe(1)
  })

  it('the higher score wins, a perfect tie is a draw', () => {
    const s: State = worldNew(new Rng(1))
    s.p[0].score = 500
    s.p[1].score = 300
    expect(winnerOf(s)).toBe(0)
    s.p[1].score = 700
    expect(winnerOf(s)).toBe(1 as Side)
    s.p[1].score = 500
    expect(winnerOf(s)).toBe('draw')
  })

  it('equal scores go to the cleaner dance: perfects, then best combo, then fewer slips', () => {
    const s: State = worldNew(new Rng(1))
    s.p[0].score = s.p[1].score = 600
    s.p[1].perfects = 3
    s.p[0].perfects = 2
    expect(winnerOf(s)).toBe(1)
    s.p[0].perfects = 3
    s.p[0].best = 5
    s.p[1].best = 4
    expect(winnerOf(s)).toBe(0)
    s.p[1].best = 5
    s.p[0].whiffs = 2
    s.p[1].misses = 1
    expect(winnerOf(s)).toBe(1)
    s.p[1].whiffs = 1
    expect(winnerOf(s)).toBe('draw')
  })
})

describe('disco battle: match length', () => {
  it('a shorter song has a shorter chart, all inside its length', () => {
    const short = chartNew(new Rng(5), 20)
    expect(short.length).toBeGreaterThan(0)
    expect(short.every((n) => n.t < 20)).toBe(true)
    expect(chartNew(new Rng(5)).length).toBeGreaterThan(short.length)
  })
})

/** A full game between two bots, on the real clock. */
function game(seed: number, red: 'easy' | 'normal' | 'hard', blue: 'easy' | 'normal' | 'hard') {
  const rng = new Rng(seed)
  const s = worldNew(rng)
  const bots = [new DanceBot(rng.fork(), red), new DanceBot(rng.fork(), blue)] as const
  let t = 0
  while (t < DURATION) {
    t += STEP
    for (const side of [0, 1] as Side[]) {
      const d: Dancer = s.p[side]
      expire(d, t)
      for (const lane of bots[side].step(t, d)) press(d, lane, t)
    }
  }
  return { s, winner: winnerOf(s) }
}

describe('disco battle: bots', () => {
  it('a bot plays the whole chart within the clock and scores', () => {
    const r = game(3, 'normal', 'normal')
    expect(r.s.p[0].score).toBeGreaterThan(0)
    expect(r.s.p[1].score).toBeGreaterThan(0)
    expect(r.winner).not.toBeNull()
  })

  it('accuracy follows difficulty: hard hits far more than easy', () => {
    const hard = game(11, 'hard', 'easy')
    expect(hard.s.p[0].perfects + hard.s.p[0].goods).toBeGreaterThan(
      (hard.s.p[1].perfects + hard.s.p[1].goods) * 1.2,
    )
  })

  it('a hard bot hits most arrows, perfectly most of the time', () => {
    const r = game(21, 'hard', 'hard')
    const d = r.s.p[0]
    const total = d.perfects + d.goods + d.misses
    expect(total).toBeGreaterThan(40)
    expect((d.perfects + d.goods) / total).toBeGreaterThan(0.85)
    expect(d.perfects / (d.perfects + d.goods)).toBeGreaterThan(0.7)
  })

  it('a bot never whiffs: its planned hits all land inside the window', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const r = game(5, d, d)
      expect(r.s.p[0].whiffs).toBe(0)
      expect(r.s.p[1].whiffs).toBe(0)
    }
  })

  it('normal sits between easy and hard', () => {
    let easy = 0
    let normal = 0
    let hard = 0
    for (const seed of [1, 2, 3]) {
      easy += game(seed, 'easy', 'easy').s.p[0].score
      normal += game(seed, 'normal', 'normal').s.p[0].score
      hard += game(seed, 'hard', 'hard').s.p[0].score
    }
    expect(normal).toBeGreaterThan(easy * 1.2)
    expect(hard).toBeGreaterThan(normal * 1.2)
  })

  it('a bot never presses an arrow that is not on screen', () => {
    const rng = new Rng(4)
    const s = worldNew(rng)
    const bot = new DanceBot(rng.fork(), 'hard')
    for (let t = STEP; t < 4; t += STEP) {
      for (const lane of bot.step(t, s.p[0])) {
        const h = s.p[0].hits.find((x) => x.lane === lane && x.r === 0 && Math.abs(x.t - t) < GOOD)
        expect(h).toBeDefined()
      }
    }
    expect(s.p[0].score).toBe(0)
  })
})
