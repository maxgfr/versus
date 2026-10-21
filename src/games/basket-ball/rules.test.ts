import { describe, expect, it } from 'vitest'
import { STEP, type Difficulty, type Side } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { W } from '../../core/stage.ts'
import { decide, newMemory, TUNING } from './bot.ts'
import {
  BALL_R,
  G,
  GAIN,
  hoopAt,
  MAX_SWIPE,
  MIN_SWIPE,
  newWorld,
  over,
  RIM_H,
  RIM_R,
  ready,
  shoot,
  step,
  T_RING,
  VZ,
  winner,
  type World,
  boardY,
  swipeOK,
} from './rules.ts'

/** Play a match computer vs computer for `seconds` of clock; returns the world and the steps used. */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  seconds = 45,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(seconds, rng)
  const mem = [newMemory(), newMemory()]
  let steps = 0
  while (!over(w) && steps < 60 * (seconds + 30)) {
    for (const side of [0, 1] as Side[]) {
      const d = decide(w, side, side === 0 ? a : b, rng, mem[side] ?? newMemory(), STEP)
      if (d) shoot(w, side, d.dx, d.dy, d.len)
    }
    step(w, STEP, rng)
    steps++
  }
  return { w, steps }
}

/** Launch a red ball straight at its hoop with the swipe that matches the distance. */
function perfectRedShot(w: World): boolean {
  const b = w.balls[0]
  const h = hoopAt(0)
  const dx = h.x - b.x
  const dy = h.y - b.y
  const dist = Math.hypot(dx, dy)
  return shoot(w, 0, dx / dist, dy / dist, dist / T_RING / GAIN)
}

describe('basket ball rules', () => {
  it('the launch arc is set so the ball is on the rim plane at T_RING', () => {
    const z = (t: number) => VZ * t - 0.5 * G * t * t
    expect(z(T_RING)).toBeCloseTo(RIM_H, 6)
    expect(z(T_RING + 0.2)).toBeLessThan(RIM_H)
  })

  it('a perfect swipe scores', () => {
    const rng = new Rng(1)
    const w = newWorld(45, rng)
    w.balls[1].state = 'wait'
    w.balls[1].wait = 99
    expect(perfectRedShot(w)).toBe(true)
    let swish = false
    for (let i = 0; i < 60 * 3 && !swish; i++) {
      for (const e of step(w, STEP, rng)) if (e.kind === 'swish') swish = e.side === 0
    }
    expect(swish).toBe(true)
    expect(w.score).toEqual([1, 0])
  })

  it('a shot that is too short or too long misses the rim plane', () => {
    const rng = new Rng(2)
    for (const k of [0.5, 1.6]) {
      const w = newWorld(45, rng)
      w.balls[1].state = 'wait'
      w.balls[1].wait = 99
      const b = w.balls[0]
      const h = hoopAt(0)
      const dist = Math.hypot(h.x - b.x, h.y - b.y)
      shoot(w, 0, (h.x - b.x) / dist, (h.y - b.y) / dist, (dist * k) / T_RING / GAIN)
      for (let i = 0; i < 60 * 4; i++) step(w, STEP, rng)
      expect(w.score[0]).toBe(0)
    }
  })

  it('a shot aimed far to the side misses', () => {
    const rng = new Rng(3)
    const w = newWorld(45, rng)
    w.balls[1].state = 'wait'
    w.balls[1].wait = 99
    const b = w.balls[0]
    const h = hoopAt(0)
    const dist = Math.hypot(h.x - b.x, h.y - b.y)
    const ang = Math.atan2(h.y - b.y, h.x - b.x) + 0.35
    shoot(w, 0, Math.cos(ang), Math.sin(ang), dist / T_RING / GAIN)
    for (let i = 0; i < 60 * 4; i++) step(w, STEP, rng)
    expect(w.score[0]).toBe(0)
  })

  it('a ball can only be shot when ready, toward its hoop, with a real swipe', () => {
    const w = newWorld(45, new Rng(4))
    expect(ready(w, 0)).toBe(true)
    expect(shoot(w, 0, 0, -1, MIN_SWIPE - 1)).toBe(false)
    expect(shoot(w, 0, 0, 1, 300)).toBe(false) // wrong way: away from the hoop
    expect(shoot(w, 0, 0, -1, 300)).toBe(true)
    expect(ready(w, 0)).toBe(false)
    expect(shoot(w, 0, 0, -1, 300)).toBe(false) // already in the air
    expect(swipeOK(1, 1, 200)).toBe(true)
    expect(swipeOK(1, -1, 200)).toBe(false)
  })

  it('blue shoots down the table at its own hoop', () => {
    const w = newWorld(45, new Rng(5))
    w.balls[1].state = 'ready'
    const b = w.balls[1]
    const h = hoopAt(1)
    expect(h.y).toBeLessThan(900)
    expect(b.y).toBeLessThan(h.y)
    expect(shoot(w, 1, 0, 1, 300)).toBe(true)
  })

  it('the backboard stops a ball flying into it from the front', () => {
    const rng = new Rng(6)
    const w = newWorld(45, rng)
    w.balls[1].state = 'wait'
    w.balls[1].wait = 99
    const b = w.balls[0]
    // Straight up the middle, too hard: the board is in the way before the rim.
    b.x = W / 2
    b.y = boardY(0) + 200
    b.z = 380
    b.vx = 0
    b.vy = -500
    b.vz = 0
    b.state = 'fly'
    let board = false
    for (let i = 0; i < 60; i++) {
      for (const e of step(w, STEP, rng)) if (e.kind === 'board') board = true
      if (board) break
    }
    expect(board).toBe(true)
    expect(b.vy).toBeGreaterThan(0)
  })

  it('a ball that drops onto the rim from above can bounce out', () => {
    const rng = new Rng(7)
    const w = newWorld(45, rng)
    w.balls[1].state = 'wait'
    w.balls[1].wait = 99
    const h = hoopAt(0)
    const b = w.balls[0]
    b.x = h.x + RIM_R - 20
    b.y = h.y
    b.z = RIM_H + 30
    b.vx = 0
    b.vy = 0
    b.vz = -200
    b.state = 'fly'
    let rim = false
    for (let i = 0; i < 60 && !rim; i++) {
      for (const e of step(w, STEP, rng)) if (e.kind === 'rim') rim = true
    }
    expect(rim).toBe(true)
    expect(w.score[0]).toBe(0)
    expect(RIM_R + BALL_R).toBeGreaterThan(RIM_R)
  })

  it('the clock stops new balls and ends the match once the last flight lands', () => {
    const rng = new Rng(8)
    const w = newWorld(1, rng)
    w.score = [1, 0]
    expect(over(w)).toBe(false)
    for (let i = 0; i < 60 * 2; i++) step(w, STEP, rng)
    expect(w.ended).toBe(true)
    expect(w.overtime).toBe(false)
    expect(over(w)).toBe(true)
    expect(ready(w, 0)).toBe(false)
  })

  it('a tied clock goes to sudden death, and the next basket ends it', () => {
    const rng = new Rng(14)
    const w = newWorld(1, rng)
    w.balls[1].state = 'wait'
    w.balls[1].wait = 99
    for (let i = 0; i < 60 * 2; i++) step(w, STEP, rng)
    expect(w.overtime).toBe(true)
    expect(w.ended).toBe(false)
    expect(perfectRedShot(w)).toBe(true)
    for (let i = 0; i < 60 * 3 && !w.ended; i++) step(w, STEP, rng)
    expect(w.score).toEqual([1, 0])
    expect(w.ended).toBe(true)
    for (let i = 0; i < 60 * 4 && !over(w); i++) step(w, STEP, rng)
    expect(over(w)).toBe(true)
    expect(winner(w)).toBe(0)
  })

  it('most baskets wins; equal baskets are a draw', () => {
    const w = newWorld(45, new Rng(9))
    expect(winner(w)).toBe('draw')
    w.score = [2, 1]
    expect(winner(w)).toBe(0)
    w.score = [1, 3]
    expect(winner(w)).toBe(1)
  })

  it('the swipe length is clamped', () => {
    const w = newWorld(45, new Rng(10))
    expect(shoot(w, 0, 0, -1, MAX_SWIPE * 3)).toBe(true)
    expect(w.balls[0].vy).toBeCloseTo(-MAX_SWIPE * GAIN, 3)
    expect(BALL_R).toBeGreaterThan(0)
  })

  it('the clock is the match length the players chose', () => {
    expect(newWorld(90, new Rng(11)).left).toBe(90)
  })

  it('bot vs bot finishes the clock within bounded steps, and the harder bot usually wins', () => {
    const { w, steps } = botMatch('hard', 'normal', 12, 45)
    expect(over(w)).toBe(true)
    expect(steps).toBeLessThan(60 * 90)
    let hard = 0
    for (let s = 1; s <= 4; s++) if (winner(botMatch('hard', 'easy', s).w) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })

  it('the bot plays either side and its tuning gets sloppier on easier levels', () => {
    const w = newWorld(45, new Rng(13))
    for (const side of [0, 1] as Side[]) {
      const other = w.balls[side === 0 ? 1 : 0]
      if (other) {
        other.state = 'wait'
        other.wait = 99
      }
      const d = decide(w, side, 'hard', new Rng(3), newMemory(), STEP)
      expect(d).not.toBeNull()
      expect(Math.hypot(d?.dx ?? 0, d?.dy ?? 0)).toBeCloseTo(1, 5)
      expect(Math.sign(d?.dy ?? 0)).toBe(side === 0 ? -1 : 1)
      if (other) {
        other.state = 'ready'
        other.wait = 0
      }
    }
    expect(TUNING.easy.angle).toBeGreaterThan(TUNING.hard.angle)
    expect(TUNING.easy.cadence).toBeGreaterThan(TUNING.hard.cadence)
    expect(RIM_R).toBeGreaterThan(0)
    expect(MAX_SWIPE).toBeGreaterThan(MIN_SWIPE)
  })
})
