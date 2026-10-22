import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { decide, foldX, newMemory, TUNING } from './bot.ts'
import {
  BALL_R,
  BUMP_KICK,
  BUMPERS,
  DRAIN_TOP,
  DRAIN_Y,
  type Event,
  FLIP_R,
  flipGeom,
  newWorld,
  PAUSE,
  PIVOT,
  pullOf,
  PULL_MAX,
  RAILS,
  REST,
  SLING_KICK,
  SLINGS,
  STALL,
  step,
  type Seg,
  UP,
  type World,
  winner,
} from './rules.ts'

/** A world in play with the ball placed and at rest, flippers down. */
function playWorld(seed = 1): World {
  const w = newWorld(new Rng(seed))
  w.phase = 'play'
  w.pause = 0
  return w
}

const NO_HOLDS = [false, false, false, false]

/** Run `n` steps with no flipper input; returns every event. */
function run(w: World, n: number, rng = new Rng(3), holds = NO_HOLDS): Event[] {
  const out: Event[] = []
  for (let i = 0; i < n; i++) out.push(...step(w, STEP, holds, rng))
  return out
}

const sameSeg = (a: Seg, b: readonly number[]) =>
  (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]) ||
  (a[0] === b[2] && a[1] === b[3] && a[2] === b[0] && a[3] === b[1])

describe('pinball table', () => {
  it('blue is red turned 180 degrees about the stage centre', () => {
    const turn = (x: number, y: number) => [W - x, 1800 - y]
    for (const [ax, ay, bx, by] of RAILS) {
      const [rax, ray] = turn(ax, ay) as [number, number]
      const [rbx, rby] = turn(bx, by) as [number, number]
      expect(RAILS.some((s) => sameSeg(s, [rax, ray, rbx, rby]))).toBe(true)
    }
    for (const lane of [0, 1] as const) {
      const red = flipGeom({ side: 0, lane, a: REST[lane], w: 0, up: false })
      const blue = flipGeom({ side: 1, lane, a: REST[lane], w: 0, up: false })
      expect(blue.px).toBe(W - red.px)
      expect(blue.py).toBe(1800 - red.py)
      expect(blue.ang).toBeCloseTo(red.ang + Math.PI, 9)
    }
  })

  it('the centre bumper sits on the midline and the other two are mirror images', () => {
    expect(BUMPERS[1]).toEqual([W / 2, MID])
    const [ax, ay] = BUMPERS[0] as [number, number]
    expect(BUMPERS[2]).toEqual([W - ax, 1800 - ay])
  })

  it('every slingshot face points into the table', () => {
    for (const [ax, ay, bx, by] of SLINGS) {
      const cx = (ax + bx) / 2
      const cy = (ay + by) / 2
      expect(Math.abs(cx - W / 2) + Math.abs(cy - MID)).toBeGreaterThan(0)
    }
  })
})

describe('flippers', () => {
  it('swing between rest and up at a fixed speed and come back', () => {
    const w = playWorld()
    const left = w.flips[0]
    expect(left?.a).toBeCloseTo(REST[0], 6)
    run(w, 30, new Rng(1), [true, false, false, false])
    expect(left?.a).toBeCloseTo(UP[0], 6)
    expect(left?.w).toBeCloseTo(0, 6)
    run(w, 30, new Rng(1), NO_HOLDS)
    expect(left?.a).toBeCloseTo(REST[0], 6)
  })

  it('a flipper swinging up hands its speed to a resting ball', () => {
    const w = playWorld()
    // Ball resting just above the red-left flipper, about 60% of the way out.
    const g = flipGeom({ side: 0, lane: 0, a: REST[0], w: 0, up: false })
    const mx = g.px + (g.tx - g.px) * 0.6
    const my = g.py + (g.ty - g.py) * 0.6
    w.ball = {
      x: mx + 0.5 * (BALL_R + FLIP_R - 4),
      y: my - 0.866 * (BALL_R + FLIP_R - 4),
      vx: 0,
      vy: 0,
    }
    const events = run(w, 12, new Rng(1), [true, false, false, false])
    expect(events.some((e) => e.kind === 'flip' && e.side === 0)).toBe(true)
    expect(w.ball.vy).toBeLessThan(-300)
  })

  it('a flipper leaves a distant ball alone', () => {
    const w = playWorld()
    w.ball = { x: 500, y: 1000, vx: 0, vy: 0 }
    const events = run(w, 60, new Rng(1), [true, true, true, true])
    expect(events.filter((e) => e.kind === 'flip')).toHaveLength(0)
    // Nothing touches it: the only force is the gentle pull along the table's length.
    expect(w.ball.x).toBe(500)
    expect(w.ball.y).toBeGreaterThan(1000)
  })

  it('the up angle lifts the tip above the pivot', () => {
    const w = playWorld()
    run(w, 30, new Rng(1), [false, true, false, false])
    const right = w.flips[1]
    if (!right) throw new Error('no flipper')
    expect(right.a).toBeCloseTo(UP[1], 6)
    expect(flipGeom(right).ty).toBeLessThan(PIVOT[1][1])
  })
})

describe('bumpers and slingshots', () => {
  it('a pop bumper kicks the ball away at least at BUMP_KICK and lights up', () => {
    const w = playWorld()
    const [cx, cy] = BUMPERS[1] as [number, number]
    w.ball = { x: cx, y: cy + BALL_R + 44 - 4, vx: 0, vy: -500 }
    const events = step(w, STEP, NO_HOLDS, new Rng(1))
    const bump = events.find((e) => e.kind === 'bump')
    expect(bump?.kind).toBe('bump')
    expect(w.ball.vy).toBeGreaterThanOrEqual(BUMP_KICK - 1)
    expect(w.bumpLit[1]).toBe(1)
  })

  it('a slingshot kicks from its table face but not from its back', () => {
    const face = playWorld()
    // Red-left slingshot: midpoint (290, 1345), interior normal (0.707, -0.707).
    const n = [0.7071, -0.7071]
    face.ball = {
      x: 290 + n[0]! * 41,
      y: 1345 + n[1]! * 41,
      vx: -n[0]! * 600,
      vy: -n[1]! * 600,
    }
    const kicked = step(face, STEP, NO_HOLDS, new Rng(1)).find((e) => e.kind === 'kick')
    expect(kicked?.kind).toBe('kick')
    expect(face.ball.vx * n[0]! + face.ball.vy * n[1]!).toBeGreaterThanOrEqual(SLING_KICK - 1)

    const back = playWorld()
    back.ball = {
      x: 290 - n[0]! * 41,
      y: 1345 - n[1]! * 41,
      vx: n[0]! * 600,
      vy: n[1]! * 600,
    }
    const plain = step(back, STEP, NO_HOLDS, new Rng(1))
    expect(plain.some((e) => e.kind === 'kick')).toBe(false)
  })
})

describe('drains and serves', () => {
  it('a ball through the bottom drain scores for blue and parks the ball', () => {
    const w = playWorld()
    w.ball = { x: W / 2, y: DRAIN_Y + 20, vx: 0, vy: 300 }
    const events = step(w, STEP, NO_HOLDS, new Rng(1))
    expect(events.find((e) => e.kind === 'goal')).toMatchObject({ kind: 'goal', side: 1 })
    expect(w.score).toEqual([0, 1])
    expect(w.phase).toBe('goal')
    expect(w.server).toBe(0)
    expect(w.ball).toMatchObject({ x: W / 2, y: MID, vx: 0, vy: 0 })
  })

  it('a ball through the top drain scores for red', () => {
    const w = playWorld()
    w.ball = { x: W / 2, y: DRAIN_TOP - 20, vx: 0, vy: -300 }
    step(w, STEP, NO_HOLDS, new Rng(1))
    expect(w.score).toEqual([1, 0])
    expect(w.server).toBe(1)
  })

  it('the next serve comes after the pause, toward the player who conceded', () => {
    const w = playWorld()
    w.ball = { x: W / 2, y: DRAIN_Y + 20, vx: 0, vy: 300 }
    step(w, STEP, NO_HOLDS, new Rng(1))
    const rng = new Rng(9)
    const steps = Math.ceil(PAUSE * 60) + 2
    let served: Event | undefined
    for (let i = 0; i < steps && !served; i++) {
      served = step(w, STEP, NO_HOLDS, rng).find((e) => e.kind === 'serve')
    }
    expect(served).toMatchObject({ kind: 'serve', side: 0 })
    expect(w.phase).toBe('play')
    expect(w.ball.vy).toBeGreaterThan(0)
  })

  it('a ball in mid-table does not score by itself', () => {
    const w = playWorld()
    w.ball = { x: 500, y: 700, vx: 100, vy: 100 }
    run(w, 120)
    expect(w.score).toEqual([0, 0])
  })
})

describe('rails and the match', () => {
  it('the rails keep the ball inside the side walls, however it is struck', () => {
    const w = playWorld(4)
    const rng = new Rng(11)
    for (let i = 0; i < 60 * 40; i++) {
      const holds = [rng.chance(0.2), rng.chance(0.2), rng.chance(0.2), rng.chance(0.2)]
      step(w, STEP, holds, rng)
      if (w.phase !== 'play') continue
      expect(w.ball.x).toBeGreaterThanOrEqual(70 + BALL_R)
      expect(w.ball.x).toBeLessThanOrEqual(930 - BALL_R)
    }
  })

  it('winner respects the chosen target, not a constant', () => {
    const w = newWorld(new Rng(1))
    w.score = [4, 0]
    expect(winner(w, 5)).toBeNull()
    expect(winner(w, 4)).toBe(0)
    w.score = [0, 3]
    expect(winner(w, 3)).toBe(1)
    expect(winner(w, 4)).toBeNull()
  })

  it('the state is plain JSON, so the online host can stream it', () => {
    const w = playWorld(2)
    run(w, 300, new Rng(2), [true, false, true, false])
    expect(JSON.parse(JSON.stringify(w))).toEqual(w)
  })
})

describe('bot', () => {
  it('plays either side: it swings the flipper for a ball heading to its own end', () => {
    for (const side of [0, 1] as Side[]) {
      const w = playWorld(5)
      // Ball heading to this side's end, aimed at the left flipper's line in its own frame.
      w.ball =
        side === 0
          ? { x: 400, y: 1100, vx: 0, vy: 900 }
          : { x: W - 400, y: 1800 - 1100, vx: 0, vy: -900 }
      const rng = new Rng(6)
      const mem = newMemory()
      let swung = false
      for (let i = 0; i < 120 && !swung; i++) {
        const [l, r] = decide(w, side, 'hard', rng, mem, STEP)
        const holds = [false, false, false, false]
        holds[side * 2] = l
        holds[side * 2 + 1] = r
        const ev = step(w, STEP, holds, rng)
        swung = ev.some((e) => e.kind === 'flip' && e.side === side)
      }
      expect(swung).toBe(true)
    }
  })

  it('leaves its flippers down when the ball is heading away', () => {
    const w = playWorld(5)
    w.ball = { x: 400, y: 1100, vx: 0, vy: -900 }
    const rng = new Rng(2)
    const mem = newMemory()
    for (let i = 0; i < 60; i++) {
      const [l, r] = decide(w, 0, 'hard', rng, mem, STEP)
      expect(l || r).toBe(false)
    }
  })

  for (const [a, b] of [
    ['hard', 'hard'],
    ['normal', 'normal'],
    ['easy', 'easy'],
    ['hard', 'easy'],
  ] as const) {
    it(`bot ${a} vs bot ${b} reaches the default match in bounded time`, () => {
      const r = botMatch(a, b, 3, 5)
      expect(r.win).not.toBeNull()
      expect(Math.max(...r.w.score)).toBeGreaterThanOrEqual(5)
      expect(r.steps).toBeLessThan(60 * 900)
    })
  }

  it('a chosen match length ends the match at that length, not the default', () => {
    const r = botMatch('hard', 'normal', 8, 2)
    expect(r.win).not.toBeNull()
    expect(Math.max(...r.w.score)).toBe(2)
  })

  it('the harder bot scores more: hard over normal and easy, normal over easy', () => {
    /** Points for `a` minus points for `b`, over seeded matches played from both ends. */
    const edge = (a: Difficulty, b: Difficulty): number => {
      let n = 0
      for (let s = 1; s <= 6; s++) {
        const x = botMatch(a, b, s, 5).w
        const y = botMatch(b, a, s, 5).w
        n += x.score[0] - x.score[1] + (y.score[1] - y.score[0])
      }
      return n
    }
    expect(edge('hard', 'easy')).toBeGreaterThan(0)
    expect(edge('hard', 'normal')).toBeGreaterThan(0)
    expect(edge('normal', 'easy')).toBeGreaterThan(0)
  })

  it('the table pulls harder as points are scored, up to a cap', () => {
    const w = playWorld(1)
    const p0 = pullOf(w)
    w.score = [3, 2]
    expect(pullOf(w)).toBeGreaterThan(p0)
    w.score = [50, 50]
    expect(pullOf(w)).toBeCloseTo(p0 * PULL_MAX, 5)
  })

  it('tunes easy bots to be slower and less accurate than hard ones', () => {
    expect(TUNING.easy.react).toBeGreaterThan(TUNING.hard.react)
    expect(TUNING.easy.miss).toBeGreaterThan(TUNING.hard.miss)
    expect(TUNING.easy.lead).toBeGreaterThan(TUNING.hard.lead)
  })
})

/** Bot against bot until `target` points, capped so a bad tune fails instead of hanging. */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  target: number,
  maxSteps = 60 * 900,
): { w: World; steps: number; win: Side | null } {
  const rng = new Rng(seed)
  const w = newWorld(rng)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (winner(w, target) === null && steps < maxSteps) {
    const holds = [false, false, false, false]
    const d0 = decide(w, 0, a, rng, mem[0] as ReturnType<typeof newMemory>, STEP)
    const d1 = decide(w, 1, b, rng, mem[1] as ReturnType<typeof newMemory>, STEP)
    holds[0] = d0[0]
    holds[1] = d0[1]
    holds[2] = d1[0]
    holds[3] = d1[1]
    step(w, STEP, holds, rng)
    steps++
  }
  return { w, steps, win: winner(w, target) }
}

describe('bot aim', () => {
  it('folds its landing prediction between the real side rails, not the stage edges', () => {
    // Heading right at 600/s for 1 s from x = 700: it meets the right rail and comes back.
    const x = foldX(700, 600, 1)
    expect(x).toBeLessThan(930 - BALL_R)
    expect(x).toBeCloseTo(2 * (930 - 14 - BALL_R) - 1300, 5)
  })

  it('flips a slow ball dribbling onto its flipper instead of watching it drain', () => {
    for (const side of [0, 1] as Side[]) {
      const w = playWorld(9)
      // Resting on the left flipper's blade, barely moving.
      const lx = PIVOT[0][0] + 90
      const ly = PIVOT[0][1] - 70
      w.ball =
        side === 0 ? { x: lx, y: ly, vx: 0, vy: 40 } : { x: W - lx, y: 1800 - ly, vx: 0, vy: -40 }
      const [l, r] = decide(w, side, 'normal', new Rng(1), newMemory(), STEP)
      expect(l).toBe(true)
      expect(r).toBe(false)
    }
  })
})

describe('no stalling', () => {
  it('a ball that has been nearly still for STALL seconds is nudged back toward the middle', () => {
    for (const side of [0, 1] as Side[]) {
      const w = playWorld(4)
      const y = side === 0 ? 1500 : 300
      w.ball = { x: 300, y, vx: 0, vy: 0 }
      w.still = STALL - STEP / 2
      const ev = step(w, STEP, NO_HOLDS, new Rng(1))
      expect(ev.some((e) => e.kind === 'nudge')).toBe(true)
      expect(Math.sign(w.ball.vy)).toBe(side === 0 ? -1 : 1)
      expect(w.still).toBe(0)
    }
  })

  it('a moving ball never counts as stalled', () => {
    const w = playWorld(4)
    w.ball = { x: 500, y: 1200, vx: 300, vy: 400 }
    w.still = STALL - STEP / 2
    step(w, STEP, NO_HOLDS, new Rng(1))
    expect(w.still).toBe(0)
  })
})
