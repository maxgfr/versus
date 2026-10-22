import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { disc } from '../../engines/puck/index.ts'
import { decide, type BotMemory, judge, newMemory } from './bot.ts'
import {
  BALL_R,
  type Cmd,
  COOLDOWN,
  cooldownOf,
  type Flick,
  GOAL_PAUSE,
  homeOf,
  KICKOFF_DEPTH,
  nearestDisc,
  newWorld,
  RINK,
  RUSH_AT,
  step,
  type World,
} from './rules.ts'

const none = (): Cmd => ({ flicks: [] })

/** Step until an event matching `want` appears (or 3 seconds pass); returns every event seen. */
function runUntil(w: World, want: (e: { kind: string }) => boolean): ReturnType<typeof step> {
  const seen: ReturnType<typeof step> = []
  for (let i = 0; i < 60 * 3; i++) {
    const ev = step(w, STEP, none())
    seen.push(...ev)
    if (ev.some(want)) break
  }
  return seen
}

describe('flicks', () => {
  it('a flick sends the disc along the drag and starts its cooldown', () => {
    const w = newWorld(90)
    const ev = step(w, STEP, { flicks: [{ index: 0, dx: 0, dy: -1, power: 1 }] })
    expect(ev.some((e) => e.kind === 'flick' && e.index === 0)).toBe(true)
    expect(w.players[0]?.vy).toBeLessThan(0)
    expect(w.cool[0]).toBeGreaterThan(COOLDOWN - 0.05)
  })

  it('a disc that is cooling down ignores another flick, and can flick again after', () => {
    const w = newWorld(90)
    step(w, STEP, { flicks: [{ index: 1, dx: 0, dy: -1, power: 0.5 }] })
    step(w, STEP, { flicks: [{ index: 1, dx: 1, dy: 0, power: 1 }] })
    expect(w.players[1]?.vx ?? 0).toBeLessThan(200)
    for (let i = 0; i < 60 * (COOLDOWN + 0.2); i++) step(w, STEP, none())
    const ev = step(w, STEP, { flicks: [{ index: 1, dx: 1, dy: 0, power: 1 }] })
    expect(ev.some((e) => e.kind === 'flick')).toBe(true)
  })

  it('a flicked disc that meets the ball knocks it on', () => {
    const w = newWorld(90)
    // Clear of the other discs (blue's forward stands at its kick-off spot).
    const x = 820
    expect(Math.abs(homeOf(2).x - x)).toBeGreaterThan(300)
    w.players[0] = disc(x, MID - 300, 74)
    w.ball = disc(x, MID - 300 - 130, BALL_R)
    const ev = step(w, STEP, { flicks: [{ index: 0, dx: 0, dy: -1, power: 1 }] })
    expect(ev.some((e) => e.kind === 'hit' && e.index === 0)).toBe(true)
    expect(w.ball.vy).toBeLessThan(-800)
  })
})

describe('goals and the clock', () => {
  it('a ball fully past the top line inside the mouth is a goal for red', () => {
    const w = newWorld(90)
    w.ball = disc(W / 2, RINK.y0 - 10, BALL_R)
    w.ball.vy = -1500
    const ev = runUntil(w, (e) => e.kind === 'goal')
    const goal = ev.find((e) => e.kind === 'goal')
    expect(goal && goal.kind === 'goal' && goal.side).toBe(0)
    expect(w.score).toEqual([1, 0])
    expect(w.phase).toBe('goal')
  })

  it('the clock stops during the goal pause and the kick-off resets everyone', () => {
    const w = newWorld(90)
    w.ball = disc(W / 2, RINK.y0 - 10, BALL_R)
    w.ball.vy = -1500
    runUntil(w, (e) => e.kind === 'goal')
    const left = w.left
    for (let i = 0; i < 60 * (GOAL_PAUSE - 0.1); i++) step(w, STEP, none())
    expect(w.left).toBeCloseTo(left, 6)
    expect(w.phase).toBe('goal')
    for (let i = 0; i < 60 * 0.3; i++) step(w, STEP, none())
    expect(w.phase).toBe('play')
    // Blue conceded: blue kicks off from its own half, red's discs wait a moment.
    expect(w.ball.x).toBeCloseTo(W / 2, 6)
    expect(w.ball.y).toBeCloseTo(MID - KICKOFF_DEPTH, 6)
    expect(w.cool[0]).toBeGreaterThan(0)
    expect(w.cool[1]).toBeGreaterThan(0)
    expect(w.cool[2]).toBe(0)
    expect(w.cool[3]).toBe(0)
    const ev = step(w, STEP, { flicks: [{ index: 0, dx: 0, dy: -1, power: 1 }] })
    expect(ev.some((e) => e.kind === 'flick')).toBe(false)
  })

  it('every kick-off has a keeper in front of each goal', () => {
    for (const i of [1, 3]) {
      const h = homeOf(i)
      expect(Math.abs(h.x - W / 2)).toBeLessThan(RINK.goal / 2)
      const own = i >> 1 === 0 ? RINK.y1 : RINK.y0
      expect(Math.abs(h.y - own)).toBeLessThan(300)
    }
  })

  it('discs recharge quicker in the closing seconds and a golden goal', () => {
    const w = newWorld(90)
    expect(cooldownOf(w)).toBe(COOLDOWN)
    w.left = RUSH_AT - 1
    expect(cooldownOf(w)).toBeLessThan(COOLDOWN)
    w.left = 0
    w.golden = true
    expect(cooldownOf(w)).toBeLessThan(COOLDOWN)
  })

  it('a clear lead at full time wins', () => {
    const w = newWorld(1)
    w.score = [2, 1]
    step(w, 1.5, none())
    expect(w.phase).toBe('end')
    expect(w.winner).toBe(0)
  })

  it('a level game at full time goes golden: the next goal ends it', () => {
    const w = newWorld(1)
    w.score = [1, 1]
    step(w, 1.5, none())
    expect(w.golden).toBe(true)
    expect(w.phase).toBe('play')
    w.ball = disc(W / 2, RINK.y1 - 10, BALL_R)
    w.ball.vy = 1500
    runUntil(w, (e) => e.kind === 'goal')
    expect(w.phase).toBe('end')
    expect(w.winner).toBe(1)
  })

  it('the match length is the chosen one', () => {
    const w = newWorld(45)
    expect(w.left).toBe(45)
  })
})

describe('players', () => {
  it('nearestDisc picks the closest of the given discs', () => {
    const w = newWorld(90)
    expect(nearestDisc(w, homeOf(2).x, homeOf(2).y, [2, 3])).toBe(2)
    expect(nearestDisc(w, homeOf(3).x, homeOf(3).y, [0, 1])).not.toBe(3)
    expect(nearestDisc(w, 0, 0, [])).toBeNull()
  })

  it('discs stay on the rink', () => {
    const w = newWorld(90)
    const rng = new Rng(51)
    for (let i = 0; i < 2000; i++) {
      const cmd: Cmd = { flicks: [] }
      if (i % 40 === 0) {
        const f: Flick = {
          index: rng.int(0, 3),
          dx: rng.range(-1, 1),
          dy: rng.range(-1, 1),
          power: 1,
        }
        cmd.flicks.push(f)
      }
      step(w, STEP, cmd)
      for (const p of w.players) {
        expect(p.x).toBeGreaterThanOrEqual(RINK.x0 - 1e-6)
        expect(p.x).toBeLessThanOrEqual(RINK.x1 + 1e-6)
      }
    }
  })
})

/** Computer vs computer until the match ends; returns the world and steps taken. */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  seconds = 90,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(seconds)
  const mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  const diff: [Difficulty, Difficulty] = [a, b]
  const indices = (side: Side) => [side * 2, side * 2 + 1]
  let steps = 0
  while (w.phase !== 'end' && steps < 60 * 400) {
    const cmd: Cmd = { flicks: [] }
    for (const side of [0, 1] as Side[]) {
      const plan = decide(w, side, indices(side), diff[side], rng, mem[side], STEP)
      if (plan) cmd.flicks.push(plan)
    }
    step(w, STEP, cmd)
    steps++
  }
  return { w, steps }
}

describe('mini soccer bots', () => {
  it('judges a goal for it above everything, a goal against below everything', () => {
    const w = newWorld(90)
    const mid = judge(w, 0, [0, 0])
    w.score = [1, 0]
    expect(judge(w, 0, [0, 0])).toBeGreaterThan(mid + 1000)
    expect(judge(w, 1, [0, 0])).toBeLessThan(mid - 1000)
  })

  it('the hard bot looks ahead and buries an open chance', () => {
    const w = newWorld(90)
    // Red's forward right behind the ball, blue's keeper pulled wide.
    w.ball = disc(W / 2, RINK.y0 + 420, BALL_R)
    w.players[0] = disc(W / 2 + 40, RINK.y0 + 600, 74)
    w.players[3] = disc(RINK.x1 - 90, MID - 100, 74)
    w.players[2] = disc(RINK.x0 + 90, MID - 100, 74)
    const plan = decide(w, 0, [0, 1], 'hard', new Rng(3), newMemory(), STEP)
    expect(plan).not.toBeNull()
    let scored = false
    step(w, STEP, { flicks: plan ? [plan] : [] })
    for (let i = 0; i < 90 && !scored; i++)
      scored = step(w, STEP, { flicks: [] }).some((e) => e.kind === 'goal' && e.side === 0)
    expect(scored).toBe(true)
  })

  it('the hard bot will not knock the ball into its own goal', () => {
    // Ball sitting in front of red's own goal, red's disc between it and blue's goal:
    // the straight aim would drive the ball into its own net.
    for (const seed of [4, 5, 6]) {
      const w = newWorld(90)
      w.ball = disc(W / 2, RINK.y1 - 200, BALL_R)
      w.players[0] = disc(W / 2 + 20, RINK.y1 - 420, 74)
      w.players[1] = disc(RINK.x0 + 90, MID + 100, 74)
      const plan = decide(w, 0, [0, 1], 'hard', new Rng(seed), newMemory(), STEP)
      step(w, STEP, { flicks: plan ? [plan] : [] })
      let own = false
      for (let i = 0; i < 90 && !own; i++)
        own = step(w, STEP, { flicks: [] }).some((e) => e.kind === 'goal' && e.side === 1)
      expect(own).toBe(false)
    }
  })

  it('a bot-vs-bot match ends within the bound', () => {
    const { w, steps } = botMatch('normal', 'normal', 61)
    expect(w.phase).toBe('end')
    expect(w.winner).not.toBeNull()
    expect(steps).toBeLessThan(60 * 400)
  })

  it('a shorter match with all four discs busy also ends', () => {
    const { w, steps } = botMatch('normal', 'hard', 62, 45)
    expect(w.phase).toBe('end')
    expect(steps).toBeLessThan(60 * 400)
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    for (let s = 1; s <= 4; s++) {
      const { w } = botMatch('hard', 'easy', s, 60)
      if (w.winner === 0) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(3)
  })
})
