import { describe, expect, it } from 'vitest'
import type { Difficulty, Side } from '../../core/game.ts'
import { newPlan, type Plan, shouldFlip } from './bot.ts'
import {
  BUFFER,
  fallDead,
  hazardAt,
  hazardsOn,
  judge,
  LAND_HI,
  LAND_LO,
  MUL_FLIP,
  MUL_MIN,
  nextHazard,
  newRunner,
  ROUND_CAP,
  type Runner,
  RUN_X,
  type RunEvent,
  runnerAngle,
  speedAt,
  stepRunner,
  TARGET,
} from './rules.ts'

const DT = 1 / 60

/** First seed (from 1) whose course starts with a hazard matching `pred`. */
function seedWith(pred: (side: Side, kind: string) => boolean): number {
  for (let s = 1; s < 10_000; s++) {
    const h = hazardAt(s, 0)
    if (pred(h.side, h.kind)) return s
  }
  throw new Error('no seed')
}

/** Walk one runner forward (no flips) until `until` returns true or 30 s pass. */
function walk(seed: number, r: Runner, until: (r: Runner) => boolean, flipAt?: number): number {
  let t = 0
  let flipped = false
  while (t < 30) {
    t += DT
    const flip = !flipped && flipAt !== undefined && r.dist + RUN_X >= flipAt
    if (flip) flipped = true
    stepRunner(seed, r, DT, 300, flip, t)
    if (until(r) || !r.alive) return t
  }
  return t
}

describe('gravity run course', () => {
  it('is a pure function of seed and index', () => {
    expect(hazardAt(42, 7)).toEqual(hazardAt(42, 7))
    expect(hazardAt(42, 7)).not.toEqual(hazardAt(43, 7))
  })

  it('keeps hazards in order, with room to switch surfaces between them', () => {
    for (let s = 1; s <= 20; s++) {
      for (let i = 0; i < 60; i++) {
        const a = hazardAt(s, i)
        const b = hazardAt(s, i + 1)
        // A runner needs about 0.5 s (≈230 units at top speed) to cross the corridor.
        expect(b.x - (a.x + a.w)).toBeGreaterThan(280)
      }
    }
  })

  it('finds the next hazard that is not behind a point', () => {
    const h0 = hazardAt(1, 0)
    expect(nextHazard(1, h0.side, h0.x - 10).i).toBe(0)
    expect(nextHazard(1, h0.side, h0.x + h0.w + 1).i).toBeGreaterThan(0)
  })

  it('lists only the hazards on a side that overlap a window', () => {
    const h0 = hazardAt(5, 0)
    const hits = hazardsOn(5, h0.side, h0.x + 1, h0.x + 2)
    expect(hits.map((h) => h.i)).toContain(0)
    expect(hazardsOn(5, h0.side, 0, 10).length).toBe(0)
  })
})

describe('gravity run runner', () => {
  it('stands on the floor and lands on the ceiling after a flip', () => {
    const seed = 3
    const r = newRunner()
    expect(r.y).toBe(LAND_HI)
    // Clear ground ahead for the first two seconds.
    const ev: RunEvent[] = []
    ev.push(...stepRunner(seed, r, DT, 300, true, 0.1))
    expect(ev).toContain('flip')
    for (let t = 0.2; t < 1; t += DT) ev.push(...stepRunner(seed, r, DT, 300, false, t))
    expect(r.alive).toBe(true)
    expect(r.grounded).toBe(true)
    expect(r.g).toBe(-1)
    expect(r.y).toBe(LAND_LO)
    expect(ev).toContain('land')
  })

  it('dies when it walks over a gap in the surface it stands on', () => {
    const seed = seedWith((side, kind) => side === 0 && kind === 'gap')
    const r = newRunner()
    walk(seed, r, () => false)
    expect(r.alive).toBe(false)
    expect(r.deadAt).toBeGreaterThan(0)
    // It falls down into the void, away from the floor.
    const y = r.y
    fallDead(r, DT)
    expect(r.y).toBeGreaterThan(y)
  })

  it('survives a floor gap when it flips to the ceiling beforehand', () => {
    const seed = seedWith((side, kind) => side === 0 && kind === 'gap')
    const h = hazardAt(seed, 0)
    const r = newRunner()
    walk(seed, r, (x) => x.dist + RUN_X > h.x + h.w + 60, h.x - 200)
    expect(r.alive).toBe(true)
    expect(r.g).toBe(-1)
  })

  it('dies on spikes it touches, but flies over them', () => {
    const seed = seedWith((side, kind) => side === 0 && kind === 'spike')
    const h = hazardAt(seed, 0)
    const stand = newRunner()
    walk(seed, stand, () => false)
    expect(stand.alive).toBe(false)
    const fly = newRunner()
    walk(seed, fly, (x) => x.dist + RUN_X > h.x + h.w + 60, h.x - 200)
    expect(fly.alive).toBe(true)
  })

  it('scores a pass once a hazard is behind the runner', () => {
    const seed = seedWith((side) => side === 1)
    const h = hazardAt(seed, 0)
    const r = newRunner()
    let passes = 0
    let t = 0
    while (r.alive && r.dist + RUN_X < h.x + h.w + 40 && t < 30) {
      t += DT
      for (const e of stepRunner(seed, r, DT, 300, false, t)) if (e === 'pass') passes++
    }
    expect(r.seen).toBeGreaterThanOrEqual(1)
    expect(passes).toBe(r.seen)
  })

  it('a flip costs momentum that comes back over time', () => {
    const seed = 3
    const r = newRunner()
    stepRunner(seed, r, DT, 300, true, 0.1)
    expect(r.mul).toBeCloseTo(1 - MUL_FLIP, 5)
    for (let t = 0.2; t < 3; t += DT) stepRunner(seed, r, DT, 300, false, t)
    expect(r.mul).toBe(1)
    // Flipping over and over never drops the speed below the floor.
    for (let k = 0; k < 400; k++) stepRunner(seed, r, DT, 300, true, 4 + k * DT)
    expect(r.mul).toBeGreaterThanOrEqual(MUL_MIN)
  })

  it('cannot flip again in mid-air: tapping away does not hover in the corridor', () => {
    const r = newRunner()
    let flips = 0
    let t = 0.1
    for (const e of stepRunner(3, r, DT, 300, true, t)) if (e === 'flip') flips++
    // Tap every few steps while crossing: gravity keeps pulling to the ceiling.
    for (let k = 0; k < 12; k++) {
      t += DT
      for (const e of stepRunner(3, r, DT, 300, k % 3 === 0 && k < 6, t)) if (e === 'flip') flips++
      if (r.grounded) break
    }
    expect(flips).toBe(1)
    expect(r.g).toBe(-1)
  })

  it('a tap just before landing flips straight back on touch-down', () => {
    const r = newRunner()
    let t = 0.1
    stepRunner(3, r, DT, 300, true, t)
    // Coast until a few steps from the ceiling, then tap.
    while (r.y - 248 > 110) {
      t += DT
      stepRunner(3, r, DT, 300, false, t)
    }
    expect(r.grounded).toBe(false)
    stepRunner(3, r, DT, 300, true, (t += DT))
    expect(r.buf).toBeGreaterThan(0)
    expect(r.buf).toBeLessThanOrEqual(BUFFER)
    const ev: RunEvent[] = []
    for (let k = 0; k < 20 && r.g < 0; k++) ev.push(...stepRunner(3, r, DT, 300, false, (t += DT)))
    expect(ev).toContain('land')
    expect(ev).toContain('flip')
    expect(r.g).toBe(1)
  })

  it('turns its sprite over as it flips', () => {
    const r = newRunner()
    stepRunner(1, r, DT, 300, true, 1)
    expect(runnerAngle(r, 1)).toBeCloseTo(0, 5)
    expect(runnerAngle(r, 1.3)).toBeCloseTo(Math.PI, 5)
  })
})

describe('gravity run judging', () => {
  const alive = (dist = 0): Runner => ({ ...newRunner(), dist })
  const dead = (): Runner => ({ ...newRunner(), alive: false })

  it('the last one running wins the round', () => {
    expect(judge(alive(), dead(), 5)).toBe(0)
    expect(judge(dead(), alive(), 5)).toBe(1)
  })

  it('both out on the same step is a draw', () => {
    expect(judge(dead(), dead(), 5)).toBe('draw')
  })

  it('still running at the cap, the furthest wins', () => {
    expect(judge(alive(900), alive(700), ROUND_CAP)).toBe(0)
    expect(judge(alive(600), alive(700), ROUND_CAP)).toBe(1)
    expect(judge(alive(700), alive(700), ROUND_CAP)).toBe('draw')
    expect(judge(alive(900), alive(700), ROUND_CAP - 1)).toBeNull()
  })
})

/** One round: both bots play until the round is judged. Returns the winner and step count. */
function playRound(
  seed: number,
  d: Difficulty,
  d1: Difficulty = d,
): { winner: Side | 'draw' | null; steps: number } {
  const rs: [Runner, Runner] = [newRunner(), newRunner()]
  const plans: [Plan, Plan] = [newPlan(), newPlan()]
  let t = 0
  for (let n = 1; n <= ROUND_CAP * 60 + 60; n++) {
    t += DT
    const speed = speedAt(t)
    for (const side of [0, 1] as Side[]) {
      const r = rs[side]
      const lvl = side === 0 ? d : d1
      const flip = r.alive && shouldFlip(seed, r, speed, lvl, plans[side], side * 0x9e3779b1)
      stepRunner(seed, r, DT, speed, flip, t)
    }
    const w = judge(rs[0], rs[1], t)
    if (w !== null) return { winner: w, steps: n }
  }
  return { winner: null, steps: Infinity }
}

/** Seconds one bot survives alone (capped at the round cap). */
function survive(seed: number, d: Difficulty): number {
  const r = newRunner()
  const p = newPlan()
  let t = 0
  while (r.alive && t < ROUND_CAP) {
    t += DT
    const speed = speedAt(t)
    stepRunner(seed, r, DT, speed, shouldFlip(seed, r, speed, d, p), t)
  }
  return t
}

describe('gravity run bot', () => {
  it('plans flips with the real rules: hard runs far, easy falls much sooner', () => {
    const seeds = [5, 36, 67, 98, 129, 160]
    const avg = (d: Difficulty) =>
      seeds.map((s) => survive(s, d)).reduce((a, b) => a + b) / seeds.length
    const hard = avg('hard')
    expect(hard).toBeGreaterThan(40)
    expect(avg('easy')).toBeLessThan(hard * 0.6)
  })

  it('hard beats easy most rounds', () => {
    let hard = 0
    for (let k = 0; k < 8; k++) if (playRound(400 + k * 7, 'easy', 'hard').winner === 1) hard++
    expect(hard).toBeGreaterThanOrEqual(6)
  })

  it('a normal bot survives a while, then loses to the course or the cap', () => {
    for (const seed of [11, 222, 3333]) {
      const r = playRound(seed, 'normal')
      expect(r.winner).not.toBeNull()
      expect(r.steps).toBeLessThanOrEqual(ROUND_CAP * 60 + 60)
    }
  })

  it('an easy bot loses rounds: it is beatable', () => {
    const losses = [1, 2, 3, 4, 5, 6].map((s) => playRound(s * 97, 'easy').steps)
    expect(Math.min(...losses)).toBeLessThan(ROUND_CAP * 60)
  })

  it('bot vs bot finishes a match within bounded steps, with both sides winning', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const wins: [number, number] = [0, 0]
      let steps = 0
      let rounds = 0
      while (Math.max(...wins) < TARGET && rounds < 40) {
        const r = playRound(1000 + rounds * 31, d)
        expect(r.winner).not.toBeNull()
        steps += r.steps
        rounds++
        if (r.winner !== 'draw' && r.winner !== null) wins[r.winner]++
      }
      expect(Math.max(...wins)).toBe(TARGET)
      expect(rounds).toBeLessThan(40)
      expect(steps).toBeLessThan(rounds * (ROUND_CAP * 60 + 60))
    }
  })
})
