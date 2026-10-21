import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { RhythmBot } from './bot.ts'
import {
  BEAT,
  DRAG,
  judgeTap,
  KICK,
  LAPS,
  laps,
  loopAt,
  MASH_MAX,
  OFF_MUL,
  PERFECT,
  PERFECT_MUL,
  ratNew,
  stepRat,
  STUMBLE,
  TAU,
  TRACK,
  tap,
  winnerOf,
  worldNew,
  type State,
} from './rules.ts'

describe('rat race: beat', () => {
  it('a tap on the beat is perfect, a tap between beats is ok', () => {
    const on = BEAT * 8
    expect(judgeTap(on)).toBe('perfect')
    expect(judgeTap(on + PERFECT * 0.9)).toBe('perfect')
    expect(judgeTap(on + BEAT / 2)).toBe('ok')
    expect(judgeTap(on - BEAT / 2)).toBe('ok')
  })

  it('a perfect tap kicks harder than an off-beat one', () => {
    const a = ratNew()
    const b = ratNew()
    expect(tap(a, BEAT * 4)).toBe('perfect')
    expect(tap(b, BEAT * 4 + BEAT / 2)).toBe('ok')
    expect(a.speed).toBeCloseTo(KICK * PERFECT_MUL, 6)
    expect(b.speed).toBeCloseTo(KICK * OFF_MUL, 6)
    expect(a.perfects).toBe(1)
    expect(a.perfectAt).toBeCloseTo(BEAT * 4, 6)
  })
})

describe('rat race: mashing', () => {
  it('mashing past the limit trips the rat: speed gone, down for a while', () => {
    const r = ratNew()
    const t0 = 10
    let last = ''
    for (let i = 0; i <= MASH_MAX; i++) last = tap(r, t0 + i * 0.05)
    expect(last).toBe('stumble')
    expect(r.speed).toBe(0)
    expect(r.judge).toBe('stumble')
    expect(tap(r, t0 + 0.3)).toBe('down')
    expect(tap(r, t0 + 0.3 + STUMBLE + 0.05)).not.toBe('down')
  })

  it('a steady pace under the limit never trips', () => {
    const r = ratNew()
    for (let i = 0; i < 20; i++) expect(tap(r, i * 0.25)).not.toBe('stumble')
  })

  it('a down rat does not move', () => {
    const r = ratNew()
    r.downUntil = 5
    r.speed = 3
    stepRat(r, STEP, 2)
    expect(r.angle).toBe(0)
    expect(r.speed).toBe(0)
  })
})

describe('rat race: running', () => {
  it('speed decays and the angle advances', () => {
    const r = ratNew()
    r.speed = 2
    stepRat(r, 1, 0)
    expect(r.speed).toBeCloseTo(2 * Math.exp(-DRAG), 6)
    expect(r.angle).toBeGreaterThan(0)
  })

  it('laps count the full loops, capped at the target', () => {
    const r = ratNew()
    expect(laps(r)).toBe(0)
    r.angle = TAU * 1.5
    expect(laps(r)).toBe(1)
    r.angle = TAU * 9
    expect(laps(r)).toBe(LAPS)
  })

  it('the loop starts at the bottom, nearest red, and runs left first', () => {
    const p = loopAt(0)
    expect(p.x).toBeCloseTo(TRACK.cx, 6)
    expect(p.y).toBeCloseTo(TRACK.cy + TRACK.ry, 6)
    expect(p.dir).toBe(-1)
    const q = loopAt(TAU / 4)
    expect(q.x).toBeCloseTo(TRACK.cx - TRACK.rx, 6)
  })
})

describe('rat race: winner', () => {
  const at = (a: number, b: number): State => {
    const s = worldNew()
    s.rats[0].angle = a
    s.rats[1].angle = b
    return s
  }

  it('nobody until a rat has run the laps', () => {
    expect(winnerOf(at(0, 0))).toBeNull()
    expect(winnerOf(at(LAPS * TAU - 0.01, 0))).toBeNull()
  })

  it('the first rat over the line wins', () => {
    expect(winnerOf(at(LAPS * TAU, 1))).toBe(0)
    expect(winnerOf(at(1, LAPS * TAU))).toBe(1)
  })

  it('both over on the same step is a draw', () => {
    expect(winnerOf(at(LAPS * TAU, LAPS * TAU))).toBe('draw')
  })
})

describe('rat race: match length', () => {
  it('a race to fewer laps is won at that lap count', () => {
    const s = worldNew()
    s.rats[1].angle = 2 * TAU
    expect(winnerOf(s, 2)).toBe(1)
    expect(winnerOf(s)).toBeNull()
    expect(laps(s.rats[1], 2)).toBe(2)
    expect(laps(s.rats[1])).toBe(2)
  })
})

/** A race between two bots. Returns the finish time, winner and stumbles. */
function race(seed: number, red: Difficulty, blue: Difficulty) {
  const rng = new Rng(seed)
  const s = worldNew()
  const bots = [new RhythmBot(rng.fork(), red), new RhythmBot(rng.fork(), blue)] as const
  let t = 0
  let stumbles = 0
  while (t < 90 && winnerOf(s) === null) {
    t += STEP
    for (const side of [0, 1] as const) {
      const n = bots[side].step(t)
      for (let k = 0; k < n; k++) if (tap(s.rats[side], t) === 'stumble') stumbles++
      stepRat(s.rats[side], STEP, t)
    }
  }
  return { t, winner: winnerOf(s), stumbles }
}

describe('rat race: bots', () => {
  it('bot vs bot reaches a winner within the clock, with no stumbles', () => {
    for (let seed = 0; seed < 8; seed++) {
      const r = race(seed, 'normal', 'normal')
      expect(r.winner).not.toBeNull()
      expect(r.t).toBeLessThan(60)
      expect(r.stumbles).toBe(0)
    }
  })

  it('a hard bot beats an easy bot most of the time', () => {
    let hard = 0
    const games = 16
    for (let seed = 0; seed < games; seed++)
      if (race(100 + seed, 'hard', 'easy').winner === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(Math.ceil(games * 0.8))
  })

  it('a hard bot taps the eighth-note grid, so about half its taps land on the beat', () => {
    const rng = new Rng(3)
    const s = worldNew()
    const bot = new RhythmBot(rng, 'hard')
    let t = 0
    let perfect = 0
    let total = 0
    while (t < 20) {
      t += STEP
      const n = bot.step(t)
      for (let k = 0; k < n; k++) {
        total++
        if (tap(s.rats[0], t) === 'perfect') perfect++
      }
    }
    expect(total).toBeGreaterThan(20)
    expect(perfect / total).toBeGreaterThan(0.4)
    expect(perfect / total).toBeLessThan(0.6)
  })
})
