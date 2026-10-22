import { describe, expect, it } from 'vitest'
import { STEP } from '../../core/game.ts'
import { SliceBot } from './bot.ts'
import {
  BOMB,
  BOMB_PENALTY,
  cutForce,
  FAST_CUT,
  FRUITS,
  MIN_CUT_SPEED,
  G,
  LAUNCH_Y,
  LIMIT,
  type Lane,
  type Seg,
  distSq,
  integrate,
  laneNew,
  laneStep,
  launchDue,
  REACH,
  schedule,
  slice,
  winnerOf,
} from './rules.ts'
import { Rng } from '../../core/rng.ts'

/** A fruit placed by hand, so cuts can be tested without the schedule. */
function lane(kind: number, x = 500, y = 1200): Lane {
  const l = laneNew()
  l.fruit.push({ id: l.nid++, kind, x, y, vx: 0, vy: 0, rot: 0, vr: 0 })
  return l
}

/** A swipe straight through a point. */
const through = (x: number, y: number, len = 200): Seg => [x - len / 2, y, x + len / 2, y]

describe('fruit duel rules', () => {
  it('a swipe through a fruit cuts it and scores its value', () => {
    const l = lane(0, 500, 1200)
    const evs = slice(l, [through(500, 1200)], 1)
    expect(l.fruit).toHaveLength(0)
    expect(l.score).toBe(FRUITS[0]?.value)
    expect(evs).toHaveLength(1)
    expect(l.halves).toHaveLength(2)
  })

  it('a swipe that misses cuts nothing', () => {
    const l = lane(0, 500, 1200)
    slice(l, [through(500, 1200 + REACH + 20)], 1)
    expect(l.fruit).toHaveLength(1)
    expect(l.score).toBe(0)
    expect(l.halves).toHaveLength(0)
  })

  it('a resting finger does not cut: the blade must move', () => {
    const l = lane(0, 300, 1000)
    // A finger held still on the fruit, and one creeping slower than the cut speed.
    slice(l, [[300, 1000, 300, 1000]], 1)
    slice(l, [[300, 1000, 300 + (MIN_CUT_SPEED * STEP) / 2, 1000]], 1)
    expect(l.fruit).toHaveLength(1)
    // A real flick through it cuts.
    slice(l, [[300, 1000, 300 + MIN_CUT_SPEED * STEP * 3, 1000]], 1)
    expect(l.fruit).toHaveLength(0)
  })

  it('a faster blade cuts harder: the halves fly further apart', () => {
    const spread = (len: number): number => {
      const l = lane(0, 500, 1200)
      const evs = slice(l, [through(500, 1200, len)], 1)
      const [a, b] = l.halves
      expect(evs[0]?.k === 'slice' && evs[0].force).toBeGreaterThan(0)
      return Math.hypot((a?.vx ?? 0) - (b?.vx ?? 0), (a?.vy ?? 0) - (b?.vy ?? 0))
    }
    expect(spread(60)).toBeGreaterThan(0)
    expect(spread(200)).toBeGreaterThan(spread(30))
    expect(cutForce([0, 0, FAST_CUT, 0], 1)).toBe(1)
    expect(cutForce([0, 0, 1, 0], 1)).toBe(0)
  })

  it('slicing a bomb costs points', () => {
    const l = lane(BOMB, 500, 1200)
    l.score = 10
    slice(l, [through(500, 1200)], 1)
    expect(l.score).toBe(10 - BOMB_PENALTY)
    expect(l.halves).toHaveLength(0)
  })

  it('one swipe through several fruit earns a combo bonus', () => {
    const l = laneNew()
    for (let i = 0; i < 3; i++) {
      l.fruit.push({ id: l.nid++, kind: 0, x: 300 + i * 120, y: 1200, vx: 0, vy: 0, rot: 0, vr: 0 })
    }
    const evs = slice(l, [through(420, 1200, 600)], 1)
    expect(evs).toHaveLength(3)
    const base = (FRUITS[0]?.value ?? 0) * 3
    expect(l.score).toBe(base + 2)
    expect(evs.reduce((s, e) => s + (e.k === 'slice' ? e.bonus : 0), 0)).toBe(2)
  })

  it('bombs are not counted as fruit for the combo', () => {
    const l = laneNew()
    l.fruit.push({ id: 1, kind: 0, x: 400, y: 1200, vx: 0, vy: 0, rot: 0, vr: 0 })
    l.fruit.push({ id: 2, kind: BOMB, x: 520, y: 1200, vx: 0, vy: 0, rot: 0, vr: 0 })
    slice(l, [through(460, 1200, 400)], 1)
    expect(l.score).toBe((FRUITS[0]?.value ?? 0) - BOMB_PENALTY)
  })

  it('segment distance is measured to the segment, not the endless line', () => {
    expect(distSq(0, 0, [10, 0, 20, 0])).toBe(100)
    expect(distSq(15, 3, [10, 0, 20, 0])).toBe(9)
  })

  it('fruit rises from the launch pad and falls back again', () => {
    const l = lane(0, 500, LAUNCH_Y)
    const f = l.fruit[0]!
    f.vy = -G * 1
    let peak = Infinity
    for (let i = 0; i < 60 * 3; i++) {
      integrate(l, STEP, i * STEP)
      if (l.fruit[0]) peak = Math.min(peak, l.fruit[0].y)
    }
    // A one-second toss peaks ~750 units above the launch point.
    expect(peak).toBeLessThan(LAUNCH_Y - 700)
    expect(peak).toBeGreaterThan(LAUNCH_Y - 800)
    expect(l.fruit).toHaveLength(0)
  })

  it('every scheduled throw peaks inside its own half', () => {
    for (const seed of [1, 2, 3, 99]) {
      for (const th of schedule(seed)) {
        const apex = LAUNCH_Y - (th.vy * th.vy) / (2 * G)
        expect(apex).toBeGreaterThan(900 + 100)
        expect(apex).toBeLessThan(1800)
      }
    }
  })

  it('both lanes get the same throws at the same times', () => {
    const sched = schedule(7)
    const a = laneNew()
    const b = laneNew()
    for (let i = 0; i < 60 * LIMIT; i++) {
      const t = i * STEP
      launchDue(a, sched, t)
      launchDue(b, sched, t)
    }
    expect(a.nid).toBe(b.nid)
    expect(a.fruit.map((f) => f.kind)).toEqual(b.fruit.map((f) => f.kind))
  })

  it('the schedule has fruit, bombs and some bunched volleys', () => {
    const s = schedule(5)
    expect(s.some((t) => t.kind === BOMB)).toBe(true)
    expect(s.some((t) => t.kind !== BOMB)).toBe(true)
    const times = new Set(s.map((t) => Math.round(t.t * 10)))
    expect(times.size).toBeLessThan(s.length)
  })

  it('the leader wins; equal scores draw', () => {
    expect(winnerOf([3, 1])).toBe(0)
    expect(winnerOf([1, 3])).toBe(1)
    expect(winnerOf([2, 2])).toBe('draw')
  })

  it('halves fall away and fade', () => {
    const l = lane(0, 500, 1200)
    slice(l, [through(500, 1200)], 0)
    for (let i = 0; i < 60 * 2; i++) integrate(l, STEP, i * STEP)
    expect(l.halves).toHaveLength(0)
  })

  it('trail keeps only the newest points', () => {
    const l = laneNew()
    laneStep(l, STEP, 0, [], [[0, 0, 10, 10]])
    laneStep(l, STEP, 1, [], [[0, 0, 20, 20]])
    // The old stroke has faded; the new one starts fresh (not joined to the old one).
    expect(l.trail.every((p) => p.t === 1)).toBe(true)
    expect(l.trail[0]?.b).toBe(1)
    expect(l.trail.length).toBe(2)
  })
})

/** A whole match with two bots, returning the final scores and bombs they hit. */
function play(seed: number, a: 'easy' | 'normal' | 'hard', b: 'easy' | 'normal' | 'hard') {
  const sched = schedule(seed)
  const rng = new Rng(seed)
  const lanes: [Lane, Lane] = [laneNew(), laneNew()]
  const bots = [new SliceBot(rng.fork(), a), new SliceBot(rng.fork(), b)]
  const bombs: [number, number] = [0, 0]
  let t = 0
  let steps = 0
  while (t < LIMIT) {
    t += STEP
    steps++
    for (const side of [0, 1] as const) {
      const lane = lanes[side]
      const seg = bots[side]!.step(lane, t, STEP)
      for (const ev of laneStep(lane, STEP, t, sched, seg ? [seg] : [])) {
        if (ev.k === 'slice' && ev.kind === BOMB) bombs[side]++
      }
    }
  }
  return {
    scores: [lanes[0].score, lanes[1].score] as [number, number],
    winner: winnerOf([lanes[0].score, lanes[1].score]),
    steps,
    bombs,
  }
}

describe('fruit duel bot vs bot', () => {
  it('reaches a result within the match length, for either side', () => {
    for (let seed = 0; seed < 8; seed++) {
      const r = play(seed, 'normal', 'normal')
      expect(r.steps).toBeGreaterThanOrEqual(LIMIT / STEP)
      expect(r.steps).toBeLessThanOrEqual(LIMIT / STEP + 2)
      expect(['draw', 0, 1]).toContain(r.winner)
    }
  })

  it('bots score on both sides', () => {
    const r = play(11, 'normal', 'normal')
    expect(r.scores[0]).toBeGreaterThan(0)
    expect(r.scores[1]).toBeGreaterThan(0)
  })

  it('hard beats easy most of the time', () => {
    let hard = 0
    for (let seed = 0; seed < 20; seed++) {
      if (play(200 + seed, 'hard', 'easy').winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(17)
  })

  it('hard never trails normal, and normal beats easy most of the time', () => {
    let hard = 0
    let normal = 0
    for (let seed = 0; seed < 10; seed++) {
      const h = play(500 + seed, 'hard', 'normal')
      if (h.scores[0] >= h.scores[1]) hard++
      if (play(500 + seed, 'normal', 'easy').winner === 0) normal++
    }
    expect(hard).toBeGreaterThanOrEqual(9)
    expect(normal).toBeGreaterThanOrEqual(7)
  })

  it('a late volley is busier than an early one', () => {
    const sched = schedule(7, 120)
    const early = sched.filter((t) => t.t < 30).length
    const late = sched.filter((t) => t.t >= 90).length
    expect(late).toBeGreaterThan(early)
  })

  it('hard bots hardly ever cut a bomb', () => {
    let bombs = 0
    for (let seed = 0; seed < 6; seed++) bombs += play(300 + seed, 'hard', 'hard').bombs[0]
    expect(bombs).toBeLessThanOrEqual(3)
  })
})
