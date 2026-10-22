import { describe, expect, it } from 'vitest'
import { type Difficulty, type Side, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { MID, W } from '../../core/stage.ts'
import { type BotMemory, decide, intercept, newMemory, TUNING } from './bot.ts'
import {
  aim,
  bandOf,
  fly,
  HAND,
  NET_H,
  type Cmd,
  COURT,
  newWorld,
  REACH,
  step,
  TOSS_T,
  type World,
  timeTo,
  winner,
} from './rules.ts'

const idle = (): Cmd => ({ target: [null, null], speed: [5000, 5000], serve: [false, false] })

/** Run steps until the point ends (or the cap), returning the events seen. */
function runUntilPoint(w: World, cmd: Cmd, cap = 60 * 8) {
  const seen: ReturnType<typeof step> = []
  for (let i = 0; i < cap && w.phase === 'play'; i++) seen.push(...step(w, STEP, cmd))
  return seen
}

/** A ball in play at (x, y) moving with (vx, vy, vz) at height z, hit last by `hitter`. */
function inPlay(
  w: World,
  hitter: Side,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
) {
  w.phase = 'play'
  w.hitter = hitter
  w.bounces = 0
  w.ball = { x, y, z, vx, vy, vz }
  return w
}

describe('ball flight and faults', () => {
  it('a ball landing out of the lines is a point to the receiver', () => {
    const w = inPlay(newWorld(0, 'clay'), 0, COURT.x0 - 60, 500, 20, 0, -200, -200)
    const ev = runUntilPoint(w, idle())
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.reason).toBe('out')
    expect(w.score).toEqual([0, 1])
  })

  it('hitting into the net (below the tape) gives the point to the receiver', () => {
    const w = inPlay(newWorld(0, 'grass'), 0, W / 2, MID + 2, 10, 0, -500, 0)
    const ev = runUntilPoint(w, idle())
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.reason).toBe('net')
    expect(w.score).toEqual([0, 1])
  })

  it('landing on the hitter side is a short ball, a point to the receiver', () => {
    const w = inPlay(newWorld(0, 'grass'), 0, 220, 1500, 10, 0, 100, -150)
    const ev = runUntilPoint(w, idle())
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.reason).toBe('short')
    expect(w.score).toEqual([0, 1])
  })

  it('a second bounce on the receiving side without a hit is a double, a point to the hitter', () => {
    const w = newWorld(0, 'clay')
    w.blobs[1].x = 200
    inPlay(w, 0, W / 2, 500, 1, 0, -400, -300)
    w.rally = 3
    const ev = runUntilPoint(w, idle(), 60 * 8)
    expect(ev.some((e) => e.kind === 'bounce')).toBe(true)
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.reason).toBe('double')
    expect(w.score).toEqual([1, 0])
  })

  it('a serve the receiver never touches is an ace', () => {
    const w = newWorld(0, 'clay')
    w.blobs[1].x = 200
    inPlay(w, 0, W / 2, 500, 1, 0, -400, -300)
    w.rally = 0
    const ev = runUntilPoint(w, idle(), 60 * 8)
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.reason).toBe('ace')
    expect(w.score).toEqual([1, 0])
  })

  it('a stroke always clears the net, even struck low right by it', () => {
    const w = newWorld(0, 'clay')
    const red = w.blobs[0]
    red.x = W / 2
    red.y = MID + 60
    inPlay(w, 1, W / 2, MID + 20, 4, 0, 400, 60)
    w.bounces = 1
    const ev = runUntilPoint(w, idle(), 60 * 4)
    expect(ev.some((e) => e.kind === 'hit')).toBe(true)
    const point = ev.find((e) => e.kind === 'point')
    expect(point && point.kind === 'point' && point.reason).not.toBe('net')
  })

  it('aim lands the ball where asked, clearing the tape', () => {
    const b = { x: 300, y: 1400, z: 10, vx: 0, vy: 0, vz: 0 }
    aim(b, 600, 400, 0.4)
    let crossed = -1
    let prevY = b.y
    for (let i = 0; i < 600 && b.z >= 0; i++) {
      fly(b, 1 / 240)
      if ((prevY - MID) * (b.y - MID) <= 0 && crossed < 0) crossed = b.z
      prevY = b.y
    }
    expect(crossed).toBeGreaterThanOrEqual(NET_H)
    expect(Math.abs(b.x - 600)).toBeLessThan(10)
    expect(Math.abs(b.y - 400)).toBeLessThan(10)
  })

  it('a ball in reach is struck by the racket, and the offset aims the return', () => {
    const w = newWorld(0, 'clay')
    const blue = w.blobs[1]
    // Ball coming at blue, a little to the right of its centre.
    inPlay(w, 0, blue.x + 60, blue.y + 110, 20, 0, -700, 200)
    w.bounces = 1
    const ev = step(w, STEP, idle())
    const hit = ev.find((e) => e.kind === 'hit')
    expect(hit && hit.kind === 'hit' && hit.side).toBe(1)
    expect(w.ball.vy).toBeGreaterThan(0)
    expect(w.ball.vx).toBeGreaterThan(0)
    expect(w.hitter).toBe(1)
    expect(w.bounces).toBe(0)
  })

  it('the racket waits for the bounce: a low ball before it lands is not struck', () => {
    const w = newWorld(0, 'clay')
    const blue = w.blobs[1]
    inPlay(w, 0, blue.x + 60, blue.y + 110, 20, 0, -700, 200)
    const ev = step(w, STEP, idle())
    expect(ev.some((e) => e.kind === 'hit')).toBe(false)
  })

  it('running into the ball drives it: quicker and deeper than a standing stroke', () => {
    const stroke = (run: number) => {
      const w = newWorld(0, 'clay')
      const blue = w.blobs[1]
      blue.y = MID - 400
      inPlay(w, 0, blue.x, blue.y + 140, 20, 0, -700, 200)
      w.bounces = 1
      const cmd = idle()
      cmd.target[1] = { x: blue.x, y: blue.y + run * STEP }
      const ev = step(w, STEP, cmd)
      const hit = ev.find((e) => e.kind === 'hit')
      return { w, hit: hit && hit.kind === 'hit' ? hit : null }
    }
    const still = stroke(0)
    const drive = stroke(1300)
    expect(still.hit?.power).toBe(0)
    expect(drive.hit?.power).toBeGreaterThan(0.8)
    expect(drive.hit?.speed ?? 0).toBeGreaterThan((still.hit?.speed ?? 0) * 1.2)
    // Deeper: blue hits down the court, so its ball lands nearer red's baseline.
    const landY = (w: World) => w.ball.y + w.ball.vy * timeTo(w.ball.z, w.ball.vz, 0)
    expect(landY(drive.w)).toBeGreaterThan(landY(still.w) + 80)
  })

  it('a ball out of reach is not struck', () => {
    const w = newWorld(0, 'clay')
    const blue = w.blobs[1]
    inPlay(w, 0, blue.x + REACH * 2, blue.y + 40, 20, 0, -700, -100)
    const ev = step(w, STEP, idle())
    expect(ev.some((e) => e.kind === 'hit')).toBe(false)
  })

  it('a high ball is out of racket reach until it drops', () => {
    const w = newWorld(0, 'clay')
    const blue = w.blobs[1]
    inPlay(w, 0, blue.x, blue.y + 40, 800, 0, -500, -100)
    const ev = step(w, STEP, idle())
    expect(ev.some((e) => e.kind === 'hit')).toBe(false)
    expect(timeTo(800, -100, 110)).toBeGreaterThan(0)
  })
})

describe('serve', () => {
  it('the server tosses, then the ball is launched over the net', () => {
    const w = newWorld(0, 'clay')
    const cmd = idle()
    cmd.serve = [true, false]
    const ev: ReturnType<typeof step> = []
    for (let i = 0; i < 60 && w.phase === 'serve'; i++) ev.push(...step(w, STEP, cmd))
    expect(w.phase).toBe('play')
    expect(ev.some((e) => e.kind === 'serve')).toBe(true)
    expect(w.hitter).toBe(0)
    expect(w.ball.vy).toBeLessThan(0)
    expect(TOSS_T).toBeGreaterThan(0)
  })

  it('the ball leaves from the hand it was held in (no jump at the serve)', () => {
    const w = newWorld(0, 'clay')
    const held = w.ball.x
    expect(held).toBe(w.blobs[0].x - HAND)
    const cmd = idle()
    cmd.serve = [true, false]
    let launched = NaN
    for (let i = 0; i < 60 && w.phase === 'serve'; i++) {
      const ev = step(w, STEP, cmd)
      if (ev.some((e) => e.kind === 'serve')) launched = w.ball.x
    }
    expect(Math.abs(launched - held)).toBeLessThan(1)
  })

  it('does not serve before the server taps', () => {
    const w = newWorld(1, 'grass')
    for (let i = 0; i < 300; i++) step(w, STEP, idle())
    expect(w.phase).toBe('serve')
    expect(w.toss).toBe(-1)
  })
})

describe('blobs and scoring', () => {
  it('blobs stay in their own half of the court', () => {
    const w = newWorld(0, 'clay')
    const rng = new Rng(21)
    for (let i = 0; i < 600; i++) {
      const cmd: Cmd = {
        target: [
          { x: rng.range(-500, 1500), y: rng.range(-500, 2500) },
          { x: rng.range(-500, 1500), y: rng.range(-500, 2500) },
        ],
        speed: [1300, 1300],
        serve: [false, false],
      }
      step(w, STEP, cmd)
      for (const side of [0, 1] as Side[]) {
        const b = bandOf(side)
        const p = w.blobs[side]
        expect(p.x).toBeGreaterThanOrEqual(b.x0 - 1e-6)
        expect(p.x).toBeLessThanOrEqual(b.x1 + 1e-6)
        expect(p.y).toBeGreaterThanOrEqual(b.y0 - 1e-6)
        expect(p.y).toBeLessThanOrEqual(b.y1 + 1e-6)
      }
    }
  })

  it('first to the target wins', () => {
    expect(winner([7, 3], 7)).toBe(0)
    expect(winner([6, 6], 7)).toBeNull()
    expect(winner([2, 3], 3)).toBe(1)
  })
})

/** Computer vs computer until someone reaches `target`; returns the world and steps taken. */
function botMatch(
  a: Difficulty,
  b: Difficulty,
  seed: number,
  target = 7,
): { w: World; steps: number } {
  const rng = new Rng(seed)
  const w = newWorld(rng.chance(0.5) ? 0 : 1, rng.chance(0.5) ? 'clay' : 'grass')
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
    step(w, STEP, cmd)
    steps++
  }
  return { w, steps }
}

describe('tennis bots', () => {
  it('a bot-vs-bot match reaches a result in bounded time', () => {
    const { w, steps } = botMatch('normal', 'normal', 31)
    expect(winner(w.score, 7)).not.toBeNull()
    expect(steps).toBeLessThan(60 * 900)
  })

  it('plays either side and finishes at a custom target', () => {
    const { w } = botMatch('hard', 'easy', 32, 3)
    expect(winner(w.score, 3)).not.toBeNull()
  })

  it('the harder bot usually wins', () => {
    let hard = 0
    for (let s = 1; s <= 4; s++) if (winner(botMatch('hard', 'easy', s, 5).w.score, 5) === 0) hard++
    expect(hard).toBeGreaterThanOrEqual(3)
  })

  it('the bot reads the bounce and finds a spot it can reach in time', () => {
    const w = newWorld(0, 'clay')
    inPlay(w, 0, 300, MID - 100, 60, -100, -900, 250)
    const spot = intercept(w, 1, TUNING.hard.speed, 0)
    expect(spot).not.toBeNull()
    // It meets the ball on its own half, after the bounce.
    expect((spot as { y: number }).y).toBeLessThan(MID)
  })

  it('the bot lets a ball that dies on the other half go', () => {
    const w = newWorld(0, 'clay')
    inPlay(w, 0, W / 2, MID + 200, 20, 0, 50, -100)
    expect(intercept(w, 1, TUNING.hard.speed, 0)).toBeNull()
  })

  it('the court constants are the ones the bots assume', () => {
    expect(COURT.y0).toBeLessThan(MID)
    expect(COURT.y1).toBeGreaterThan(MID)
  })
})
