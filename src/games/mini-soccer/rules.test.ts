import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { disc } from '../../engines/puck/index.ts'
import { decide, type BotMemory, newMemory } from './bot.ts'
import {
  BALL_R,
  type Cmd,
  COOLDOWN,
  type Flick,
  GOAL_PAUSE,
  homeOf,
  nearestDisc,
  newWorld,
  RINK,
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
    const p = homeOf(0)
    w.players[0] = disc(p.x, MID - 300, 74)
    w.ball = disc(p.x, MID - 300 - 200, BALL_R)
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
    expect(w.ball.x).toBeCloseTo(W / 2, 6)
    expect(w.ball.y).toBeCloseTo(MID, 6)
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
