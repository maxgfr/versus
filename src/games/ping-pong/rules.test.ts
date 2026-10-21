import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { disc } from '../../engines/puck/index.ts'
import { decide, newMemory, TUNING, type BotMemory } from './bot.ts'
import {
  BALL_R,
  BAT_R,
  bandOf,
  type Cmd,
  newWorld,
  REST_Y,
  serverOf,
  step,
  TABLE,
  winner,
  type World,
} from './rules.ts'

const idle = (): Cmd => ({ target: [null, null], speed: [5000, 5000], serve: [false, false] })

/** Put the ball into play at (x, y) with velocity (vx, vy). */
function inPlay(w: World, x: number, y: number, vx: number, vy: number): World {
  w.phase = 'play'
  w.ball = disc(x, y, BALL_R)
  w.ball.vx = vx
  w.ball.vy = vy
  return w
}

describe('scoring rules', () => {
  it('first to the target wins by two', () => {
    expect(winner([7, 5], 7)).toBe(0)
    expect(winner([5, 7], 7)).toBe(1)
    expect(winner([7, 6], 7)).toBeNull()
    expect(winner([8, 6], 7)).toBe(0)
    expect(winner([6, 6], 7)).toBeNull()
  })

  it('caps the deuce at target + 4', () => {
    expect(winner([10, 10], 7)).toBeNull()
    expect(winner([11, 10], 7)).toBe(0)
    expect(winner([10, 11], 7)).toBe(1)
  })

  it('follows the chosen target, not the default', () => {
    expect(winner([3, 1], 3)).toBe(0)
    expect(winner([7, 5], 3)).toBe(0)
    expect(winner([6, 5], 7)).toBeNull()
    expect(winner([2, 2], 3)).toBeNull()
  })

  it('alternates serve every two points', () => {
    expect(serverOf([0, 0], 0)).toBe(0)
    expect(serverOf([1, 0], 0)).toBe(0)
    expect(serverOf([2, 0], 0)).toBe(1)
    expect(serverOf([2, 1], 0)).toBe(1)
    expect(serverOf([3, 1], 0)).toBe(0)
    expect(serverOf([0, 0], 1)).toBe(1)
  })
})

describe('ball physics', () => {
  it('bounces off the side walls', () => {
    const w = inPlay(newWorld(0), TABLE.x0 + BALL_R + 2, 900, -800, 0)
    const ev = step(w, STEP, idle(), new Rng(1))
    expect(ev.some((e) => e.kind === 'wall')).toBe(true)
    expect(w.ball.vx).toBeGreaterThan(0)
    expect(w.ball.x).toBeGreaterThanOrEqual(TABLE.x0 + BALL_R)
  })

  it('the bat returns a ball coming at it, back over the net', () => {
    const w = newWorld(0)
    const bat = w.bats[0]
    inPlay(w, bat.x, bat.y - 120, 0, 900)
    const ev = step(w, STEP, idle(), new Rng(2))
    const hit = ev.find((e) => e.kind === 'hit')
    expect(hit).toBeDefined()
    expect(hit && hit.kind === 'hit' && hit.side).toBe(0)
    expect(w.ball.vy).toBeLessThan(0)
    expect(w.rally).toBe(1)
  })

  it('the offset from the bat centre sets the outgoing angle', () => {
    const left = newWorld(0)
    const lb = left.bats[0]
    inPlay(left, lb.x - BAT_R * 0.8, lb.y - 60, 0, 900)
    step(left, STEP, idle(), new Rng(3))
    expect(left.ball.vx).toBeLessThan(0)

    const right = newWorld(0)
    const rb = right.bats[0]
    inPlay(right, rb.x + BAT_R * 0.8, rb.y - 60, 0, 900)
    step(right, STEP, idle(), new Rng(3))
    expect(right.ball.vx).toBeGreaterThan(0)
  })

  it('speeds up each rally, up to the cap', () => {
    const w = newWorld(0)
    const bat = w.bats[0]
    w.rally = 40
    inPlay(w, bat.x, bat.y - 120, 0, 900)
    step(w, STEP, idle(), new Rng(4))
    expect(w.speed).toBeGreaterThan(1500)
    expect(w.speed).toBeLessThanOrEqual(2100)
  })

  it('a ball leaving the bottom edge is a point for blue, and the server alternates', () => {
    const w = newWorld(0)
    inPlay(w, W / 2, TABLE.y1 + BALL_R - 1, 0, 900)
    const ev = step(w, STEP, idle(), new Rng(5))
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.side).toBe(1)
    expect(w.score).toEqual([0, 1])
    expect(w.phase).toBe('point')
    expect(w.server).toBe(0)
  })

  it('a ball leaving the top edge is a point for red', () => {
    const w = newWorld(1)
    inPlay(w, W / 2, TABLE.y0 - BALL_R + 1, 0, -900)
    step(w, STEP, idle(), new Rng(6))
    expect(w.score).toEqual([1, 0])
  })

  it('serves after the pause, from the server bat, toward the other side', () => {
    const w = newWorld(0)
    w.phase = 'point'
    w.pause = 0.001
    w.server = 0
    step(w, STEP, idle(), new Rng(7))
    expect(w.phase).toBe('serve')
    const cmd = idle()
    cmd.serve = [true, false]
    step(w, STEP, cmd, new Rng(7))
    expect(w.phase).toBe('play')
    expect(w.ball.vy).toBeLessThan(0)
  })
})

describe('bats', () => {
  it('stay in their own band on their own half', () => {
    const w = newWorld(0)
    const rng = new Rng(8)
    for (let i = 0; i < 600; i++) {
      const cmd: Cmd = {
        target: [
          { x: rng.range(-500, 2000), y: rng.range(-500, 2500) },
          { x: rng.range(-500, 2000), y: rng.range(-500, 2500) },
        ],
        speed: [5000, 5000],
        serve: [false, false],
      }
      step(w, STEP, cmd, rng)
      for (const side of [0, 1] as Side[]) {
        const b = bandOf(side)
        const p = w.bats[side]
        expect(p.x).toBeGreaterThanOrEqual(b.x0 - 1e-6)
        expect(p.x).toBeLessThanOrEqual(b.x1 + 1e-6)
        expect(p.y).toBeGreaterThanOrEqual(b.y0 - 1e-6)
        expect(p.y).toBeLessThanOrEqual(b.y1 + 1e-6)
      }
    }
    expect(REST_Y[0]).toBeGreaterThan(W / 2)
  })
})

/** Computer vs computer until someone wins; returns the world and steps taken. */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  target = 7,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(rng.chance(0.5) ? 0 : 1)
  const mem: [BotMemory, BotMemory] = [newMemory(), newMemory()]
  const diff: [Difficulty, Difficulty] = [a, b]
  let steps = 0
  while (winner(w.score, target) === null && steps < 60 * 900) {
    const cmd: Cmd = { target: [null, null], speed: [0, 0], serve: [false, false] }
    for (const side of [0, 1] as Side[]) {
      const d = decide(w, side, diff[side], rng, mem[side], STEP)
      cmd.target[side] = d.target
      cmd.serve[side] = d.serve
      cmd.speed[side] = TUNING[diff[side]].speed
    }
    step(w, STEP, cmd, rng)
    steps++
  }
  return { w, steps }
}

describe('ping pong bots', () => {
  it('a bot-vs-bot game reaches a result in bounded time', () => {
    const { w, steps } = botMatch('normal', 'normal', 11)
    expect(winner(w.score, 7)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 900)
  })

  it('plays either side and finishes at a custom target', () => {
    const { w } = botMatch('hard', 'easy', 12, 3)
    expect(winner(w.score, 3)).not.toBeNull()
    expect(Math.max(...w.score)).toBeGreaterThanOrEqual(3)
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    for (let s = 1; s <= 4; s++) if (winner(botMatch('hard', 'easy', s, 5).w.score, 5) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })
})
