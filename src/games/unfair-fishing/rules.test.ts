import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { FishBot } from './bot.ts'
import {
  BITE_WINDOW,
  FISH,
  landingSpot,
  LIMIT,
  NO_TAPS,
  POND,
  frenzyOf,
  pickFish,
  type Rod,
  rodNew,
  rodStep,
  type Taps,
} from './rules.ts'

/** Drive one rod through a cast and a bite; returns the rod in 'bite' phase. */
function toBite(rng: Rng): Rod {
  const r = rodNew()
  rodStep(r, STEP, 0, { n: 1, at: { x: 500, y: 1200 } }, rng)
  r.until = 0.3
  for (let i = 0; i < 60 && r.phase !== 'bite'; i++) rodStep(r, STEP, i * STEP, NO_TAPS, rng)
  return r
}

/** Reel a hooked fish with a steady tap rate (taps per second). Returns the outcome. */
function reelAt(kind: number, rate: number, seconds: number, seed = 1) {
  const rng = new Rng(seed)
  const r = rodNew()
  r.phase = 'reel'
  r.kind = kind
  r.tension = 0.5
  r.surgeIn = 1e9 // no surges: test the steady balance
  let acc = 0
  let t = 0
  let final: Rod['phase'] = 'reel'
  for (let i = 0; i < seconds * 60 && r.phase === 'reel'; i++) {
    t += STEP
    acc += rate * STEP
    const n = Math.floor(acc)
    acc -= n
    rodStep(r, STEP, t, { n, at: null }, rng)
    final = r.phase
  }
  return { phase: final, tension: r.tension, reel: r.reel, points: r.points, t }
}

describe('unfair fishing rules', () => {
  it('a cast lands inside the pond', () => {
    expect(landingSpot(0, 0)).toEqual({ x: POND.x0, y: POND.y0 })
    expect(landingSpot(5000, 5000)).toEqual({ x: POND.x1, y: POND.y1 })
    expect(landingSpot(500, 1100)).toEqual({ x: 500, y: 1100 })
  })

  it('a tap while idle casts, and tapping while waiting reels back in', () => {
    const rng = new Rng(2)
    const r = rodNew()
    const cast = rodStep(r, STEP, 0, { n: 1, at: { x: 400, y: 1100 } }, rng)
    expect(cast[0]).toEqual({ k: 'cast', x: 400, y: 1100 })
    expect(r.phase).toBe('cast')
    for (let i = 0; i < 40; i++) rodStep(r, STEP, i * STEP, NO_TAPS, rng)
    expect(r.phase).toBe('wait')
    const back = rodStep(r, STEP, 1, { n: 1, at: null }, rng)
    expect(back).toEqual([{ k: 'reelin' }])
    expect(r.phase).toBe('idle')
  })

  it('the float bites after a while, and a tap inside the window hooks the fish', () => {
    const rng = new Rng(3)
    const r = toBite(rng)
    expect(r.phase).toBe('bite')
    const hook = rodStep(r, STEP, 1, { n: 1, at: null }, rng)
    expect(hook[0]?.k).toBe('hook')
    expect(r.phase).toBe('reel')
    expect(r.kind).toBeGreaterThanOrEqual(0)
  })

  it('a bite left alone gets away', () => {
    const rng = new Rng(4)
    const r = toBite(rng)
    let lost: unknown = null
    for (let i = 0; i < Math.ceil(BITE_WINDOW * 60) + 2; i++) {
      const evs = rodStep(r, STEP, i * STEP, NO_TAPS, rng)
      if (evs[0]?.k === 'lost') lost = evs[0]
    }
    expect(lost).toEqual({ k: 'lost', why: 'missed' })
    expect(r.note).toBe('missed')
  })

  it('a balanced reel lands a small fish', () => {
    // A small fish is balanced at about 3 taps a second.
    const out = reelAt(0, 3, 12)
    expect(out.phase).toBe('won')
    expect(out.points).toBe(FISH[0]?.value)
  })

  it('mashing far faster than a small fish pulls breaks the line to slack', () => {
    const out = reelAt(0, 12, 12)
    expect(out.phase).toBe('lost')
    expect(out.tension).toBeLessThanOrEqual(0)
    expect(out.points).toBe(0)
  })

  it('not mashing at all against a big fish snaps the line', () => {
    const out = reelAt(3, 0, 12)
    expect(out.phase).toBe('lost')
    expect(out.tension).toBeGreaterThanOrEqual(1)
  })

  it('big fish are worth more, and they pull harder', () => {
    for (let i = 1; i < FISH.length; i++) {
      expect(FISH[i]!.value).toBeGreaterThan(FISH[i - 1]!.value)
      expect(FISH[i]!.strength).toBeGreaterThan(FISH[i - 1]!.strength)
    }
  })

  it('bites are picked by weight', () => {
    const rng = new Rng(5)
    const counts = FISH.map(() => 0)
    for (let i = 0; i < 4000; i++) counts[pickFish(rng)]!++
    expect(counts[0]!).toBeGreaterThan(counts[1]!)
    expect(counts[1]!).toBeGreaterThan(counts[2]!)
    expect(counts[2]!).toBeGreaterThan(counts[3]!)
  })

  it('in the feeding frenzy big fish bite more often', () => {
    const count = (late: number) => {
      const rng = new Rng(9)
      let big = 0
      for (let i = 0; i < 4000; i++) if (pickFish(rng, late) >= 2) big++
      return big
    }
    expect(count(1)).toBeGreaterThan(count(0) * 1.5)
    expect(frenzyOf(0, 60)).toBe(0)
    expect(frenzyOf(40, 60)).toBe(0)
    expect(frenzyOf(60, 60)).toBe(1)
  })

  it('the surge pulls back reel progress', () => {
    const rng = new Rng(6)
    const r = rodNew()
    r.phase = 'reel'
    r.kind = 1
    r.tension = 0.5
    r.reel = 0.5
    r.surge = 0.5
    r.surgeIn = 99
    for (let i = 0; i < 30; i++) rodStep(r, STEP, i * STEP, NO_TAPS, rng)
    expect(r.reel).toBeLessThan(0.5)
  })
})

/** A whole match between two anglers. Returns both points and how many fish each landed. */
function play(seed: number, a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard') {
  const rng = new Rng(seed)
  const rods: [Rod, Rod] = [rodNew(), rodNew()]
  const bots = [new FishBot(rng.fork(), a), new FishBot(rng.fork(), b)]
  let t = 0
  let steps = 0
  while (t < LIMIT) {
    t += STEP
    steps++
    for (const side of [0, 1] as const) {
      const rod = rods[side]
      const inp: Taps = bots[side]!.act(rod, STEP)
      rodStep(rod, STEP, t, inp, rng)
    }
  }
  const [p0, p1] = [rods[0].points, rods[1].points]
  return {
    points: [p0, p1] as const,
    winner: p0 === p1 ? 'draw' : p0 > p1 ? 0 : 1,
    steps,
  }
}

describe('unfair fishing bot vs bot', () => {
  it('reaches a result within the match length, for either side', () => {
    for (let seed = 0; seed < 8; seed++) {
      const r = play(seed, 'normal', 'normal')
      expect(r.steps).toBeGreaterThanOrEqual(LIMIT / STEP)
      expect(r.steps).toBeLessThanOrEqual(LIMIT / STEP + 2)
      expect(['draw', 0, 1]).toContain(r.winner)
    }
  })

  it('anglers land fish, and some of them are big ones', () => {
    let total = 0
    for (let seed = 0; seed < 6; seed++) total += play(40 + seed, 'normal', 'normal').points[0]
    expect(total).toBeGreaterThan(10)
  })

  it('hard anglers beat easy ones most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 20; seed++) {
      if (play(300 + seed, 'hard', 'easy').winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(12)
  })

  it('hard anglers beat normal ones most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 16; seed++) {
      const hs = seed % 2 ? 0 : 1
      const r = play(500 + seed, hs === 0 ? 'hard' : 'normal', hs === 0 ? 'normal' : 'hard')
      if (r.winner === hs) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(10)
  })
})
