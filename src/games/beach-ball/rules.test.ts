import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { decide, intercept, newMemory, TUNING } from './bot.ts'
import {
  BALL_R,
  BLOB_R,
  G,
  MAX_TOUCH,
  SPIKE_FULL,
  newWorld,
  step,
  winner,
  type Event,
  type World,
} from './rules.ts'

type Target = { x: number; y: number } | null

const speeds = (w: World) => w.blobs.map(() => 3800)

/** Step with the given blob targets until `pred` holds or the step budget runs out. */
function run(w: World, rng: Rng, targets: Target[], until: (e: Event[]) => boolean, max = 60 * 8) {
  const seen: Event[] = []
  for (let i = 0; i < max; i++) {
    const ev = step(w, STEP, targets, speeds(w), rng)
    seen.push(...ev)
    if (until(ev)) break
  }
  return seen
}

/** Put the ball in mid-air at the given spot, moving with (vx, vy), and drop it. */
function toss(w: World, x: number, y: number, vx: number, vy: number, z = 300, vz = 0): void {
  w.ball = { x, y, z, vx, vy, vz }
  w.phase = 'rally'
  w.last = -1
  w.count = 0
}

describe('beach ball rules', () => {
  it('a ball landing on red sand is a point for blue, and the other way round', () => {
    const rng = new Rng(1)
    const w = newWorld(false, 0, rng)
    toss(w, 500, 1500, 0, 0, 2, -10)
    const ev = run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'point'))
    expect(w.score).toEqual([0, 1])
    expect(ev.some((e) => e.kind === 'point' && e.side === 1 && e.why === 'land')).toBe(true)
    expect(w.phase).toBe('point')

    const w2 = newWorld(false, 1, rng)
    toss(w2, 500, 300, 0, 0, 2, -10)
    run(w2, rng, [null, null], (e) => e.some((x) => x.kind === 'point'))
    expect(w2.score).toEqual([1, 0])
  })

  it('a blob bumps the ball toward the rival, and a high ball is out of reach', () => {
    const rng = new Rng(2)
    const w = newWorld(false, 0, rng)
    const red = w.blobs[0]
    if (!red) throw new Error('no blob')
    // Blob right under a falling ball, low enough to reach.
    toss(w, 500, 1400, 0, 0, 200, -300)
    red.x = 500
    red.y = 1400 + BLOB_R
    const ev = run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'bump'), 60)
    const bump = ev.find((e) => e.kind === 'bump')
    expect(bump && bump.kind === 'bump' && bump.side).toBe(0)
    expect(w.ball.vy).toBeLessThan(0) // red sends it up the table
    expect(w.ball.vz).toBeGreaterThan(0)

    // Same position, but the ball is far too high to be reached.
    const w2 = newWorld(false, 0, rng)
    const red2 = w2.blobs[0]
    if (!red2) throw new Error('no blob')
    toss(w2, 500, 1400, 0, 0, 900, 0)
    red2.x = 500
    red2.y = 1400
    const ev2 = run(w2, rng, [null, null], (e) => e.some((x) => x.kind === 'bump'), 10)
    expect(ev2.some((e) => e.kind === 'bump')).toBe(false)
  })

  it('charging at the net spikes the ball: faster and flatter than a standing bump', () => {
    const bump = (charge: number) => {
      const rng = new Rng(9)
      const w = newWorld(false, 0, rng)
      const red = w.blobs[0]
      if (!red) throw new Error('no blob')
      red.x = 500
      red.y = 1400
      toss(w, 500, 1400 - BLOB_R - BALL_R + 2, 0, 0, 200, -100)
      const targets: Target[] = [{ x: 500, y: 1400 - charge * STEP }, null]
      const ev = run(w, rng, targets, (e) => e.some((x) => x.kind === 'bump'), 1)
      const b = ev.find((e) => e.kind === 'bump')
      return { w, power: b && b.kind === 'bump' ? b.power : -1 }
    }
    const still = bump(0)
    const spike = bump(SPIKE_FULL)
    expect(still.power).toBe(0)
    expect(spike.power).toBeGreaterThan(0.9)
    expect(-spike.w.ball.vy).toBeGreaterThan(-still.w.ball.vy * 1.8)
    expect(spike.w.ball.vz).toBeLessThan(still.w.ball.vz * 0.8)
  })

  it('the ball takes the side of the blob it hits: offset aims the bump', () => {
    const rng = new Rng(10)
    const w = newWorld(false, 0, rng)
    const red = w.blobs[0]
    if (!red) throw new Error('no blob')
    red.x = 500
    red.y = 1400
    toss(w, 560, 1300, 0, 0, 200, -100)
    run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'bump'), 30)
    expect(w.ball.vx).toBeGreaterThan(80)
  })

  it('each bump of a rally adds pace, so long rallies open up', () => {
    const pace = (hits: number) => {
      const rng = new Rng(11)
      const w = newWorld(false, 0, rng)
      const red = w.blobs[0]
      if (!red) throw new Error('no blob')
      red.x = 500
      red.y = 1400
      toss(w, 500, 1300, 0, 0, 200, -100)
      w.hits = hits
      run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'bump'), 30)
      return -w.ball.vy
    }
    expect(pace(20)).toBeGreaterThan(pace(0) * 1.4)
  })

  it('blobs move evenly through the substeps, at the finger speed', () => {
    const rng = new Rng(12)
    const w = newWorld(false, 0, rng)
    const red = w.blobs[0]
    if (!red) throw new Error('no blob')
    const x0 = red.x
    step(w, STEP, [{ x: x0 + 1500 * STEP, y: red.y }, null], speeds(w), rng)
    expect(red.vx).toBeCloseTo(1500, 0)
  })

  it('a fourth touch in a row by one side is a point for the rival', () => {
    const rng = new Rng(3)
    const w = newWorld(false, 0, rng)
    const red = w.blobs[0]
    if (!red) throw new Error('no blob')
    w.last = 0
    w.count = MAX_TOUCH
    toss(w, 500, 1300, 0, 0, 120, 0)
    red.x = 500
    red.y = 1300
    w.last = 0
    w.count = MAX_TOUCH
    run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'point'), 20)
    expect(w.score).toEqual([0, 1])
    expect(w.why).toBe('touches')
  })

  it('a ball hitting the net low is a point for the rival of its last toucher', () => {
    const rng = new Rng(4)
    const w = newWorld(false, 0, rng)
    toss(w, 500, MID + 60, 0, -600, 40, 0)
    w.last = 0
    w.count = 1
    run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'point'), 60)
    expect(w.score).toEqual([0, 1])
    expect(w.why).toBe('net')
  })

  it('a ball that clears the net high is not a net fault', () => {
    const rng = new Rng(5)
    const w = newWorld(false, 0, rng)
    toss(w, 500, MID + 200, 0, -300, 500, 300)
    w.last = 0
    w.count = 1
    const ev = run(
      w,
      rng,
      [null, null],
      (e) => e.some((x) => x.kind === 'net' || x.kind === 'point'),
      60 * 2,
    )
    expect(ev.some((e) => e.kind === 'net')).toBe(false)
  })

  it('the ball bounces off the side walls and stays on the sand', () => {
    const rng = new Rng(6)
    const w = newWorld(false, 0, rng)
    toss(w, 800, 1000, 900, 0, 400, 0)
    const ev = run(w, rng, [null, null], (e) => e.some((x) => x.kind === 'wall'), 120)
    expect(ev.some((e) => e.kind === 'wall')).toBe(true)
    expect(w.ball.x).toBeLessThanOrEqual(W - BALL_R)
  })

  it('the serve goes up over the server, and the winner is who reaches the target', () => {
    const rng = new Rng(7)
    const w = newWorld(false, 1, rng)
    expect(w.ball.vz).toBeGreaterThan(0)
    expect(w.ball.y).toBeLessThan(MID)
    expect(winner(w, 3)).toBeNull()
    w.score = [3, 1]
    expect(winner(w, 3)).toBe(0)
    w.score = [1, 3]
    expect(winner(w, 3)).toBe(1)
    expect(G).toBeGreaterThan(0)
  })

  it('bot vs bot reaches the target within bounded steps, for either side', () => {
    const { w, steps } = botMatch('normal', 'normal', 21, 3, false)
    expect(winner(w, 3)).not.toBeNull()
    expect(Math.max(...w.score)).toBe(3)
    expect(steps).toBeLessThan(60 * 60 * 10)
  })

  it('bot vs bot in 2 vs 2 also finishes', () => {
    const { w } = botMatch('hard', 'easy', 22, 3, true)
    expect(w.blobs).toHaveLength(4)
    expect(winner(w, 3)).not.toBeNull()
  })

  it('the bot moves a blob under the ball and plays either side', () => {
    const rng = new Rng(8)
    const w = newWorld(false, 0, rng)
    toss(w, 500, 1100, 0, 0, 500, -200)
    const t0 = decide(w, 0, 'hard', rng, newMemory(), 1)
    expect(t0[0]).not.toBeNull()
    const w1 = newWorld(false, 1, rng)
    toss(w1, 500, 700, 0, 0, 500, 200)
    const t1 = decide(w1, 1, 'hard', rng, newMemory(), 1)
    expect(t1[1]).not.toBeNull()
    expect(TUNING.hard.speed).toBeGreaterThan(TUNING.easy.speed)
  })

  it('the bot reads the flight and meets the ball low on its own sand, in time', () => {
    const rng = new Rng(13)
    const w = newWorld(false, 1, rng)
    toss(w, 500, 700, 100, 450, 300, 900)
    const red = w.blobs[0]
    if (!red) throw new Error('no blob')
    const spot = intercept(w, 0, red, TUNING.hard.speed)
    expect(spot).not.toBeNull()
    expect((spot as { y: number }).y).toBeGreaterThan(MID)
    // A ball that comes down on blue's sand is not red's to chase.
    toss(w, 500, 300, 0, 0, 300, 600)
    expect(intercept(w, 0, red, TUNING.hard.speed)).toBeNull()
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    for (let s = 1; s <= 6; s++) if (botMatch('hard', 'easy', s, 5, false).w.score[0] >= 5) hard++
    expect(hard).toBeGreaterThanOrEqual(5)
  })
})

/** Computer vs computer rally until the target. */
function botMatch(a: Difficulty, b: Difficulty, seed: number, target: number, teams: boolean) {
  const rng = new Rng(seed)
  const w = newWorld(teams, rng.chance(0.5) ? 0 : 1, rng)
  const mem: [ReturnType<typeof newMemory>, ReturnType<typeof newMemory>] = [
    newMemory(),
    newMemory(),
  ]
  let steps = 0
  while (winner(w, target) === null && steps < 60 * 60 * 10) {
    const t0 = decide(w, 0, a, rng, mem[0], STEP) as Target[]
    const t1 = decide(w, 1, b, rng, mem[1], STEP) as Target[]
    const targets = w.blobs.map((bl, i) => (bl.side === 0 ? t0[i] : t1[i]) ?? null)
    const sp = w.blobs.map((bl) => TUNING[bl.side === 0 ? a : b].speed)
    step(w, STEP, targets, sp, rng)
    steps++
  }
  return { w, steps: steps as number, side: 0 as Side }
}
