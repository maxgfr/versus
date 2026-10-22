import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose, trial } from './bot.ts'
import {
  frameComplete,
  frameScores,
  FRAME,
  LANE,
  laneDone,
  laneTotal,
  newLane,
  prepare,
  resolve,
  rollOver,
  rack,
  slotPos,
  stepRoll,
  SETTLE,
  START_X,
  swipeThrow,
  throwBall,
  winnerOf,
  type Lane,
} from './rules.ts'

/** Roll one ball on a lane, the way the game does, and return the pins it knocked. */
function roll(lane: Lane, dx: number, dy: number, speed: number, curve = 0): number {
  throwBall(lane, dx, dy, speed, curve, 0)
  let t = 0
  while (!rollOver(lane, t) && t < 10) {
    stepRoll(lane, FRAME)
    t += FRAME
  }
  return resolve(lane)
}

describe('bowling geometry', () => {
  it('racks ten pins in a triangle whose point faces the bowler', () => {
    const pins = rack()
    expect(pins).toHaveLength(10)
    const ys = pins.map((p) => p.y)
    expect(Math.max(...ys)).toBe(LANE.pinY)
    expect(Math.min(...ys)).toBeLessThan(LANE.pinY)
    // Row 0 is the headpin, dead centre; the back row is wider.
    expect(slotPos(0).x).toBe(LANE.cx)
    expect(slotPos(9).x - slotPos(6).x).toBeCloseTo(3 * LANE.gap, 5)
  })
})

describe('bowling scoring', () => {
  it('a strike scores ten plus the simplified bonus of ten', () => {
    expect(frameScores([[10]])).toEqual([20])
  })

  it('a spare scores ten plus five', () => {
    expect(frameScores([[7, 3]])).toEqual([15])
  })

  it('adds up frames as running totals and ignores a frame still in progress', () => {
    expect(frameScores([[10], [3, 4], [9]])).toEqual([20, 27])
    expect(laneTotal([[10], [3, 4], [9]])).toBe(27)
    expect(laneTotal([[0, 0]])).toBe(0)
  })

  it('a frame ends after a strike or a second roll', () => {
    expect(frameComplete([10])).toBe(true)
    expect(frameComplete([9])).toBe(false)
    expect(frameComplete([9, 0])).toBe(true)
  })

  it('the highest total wins and a level score is a draw', () => {
    expect(winnerOf(80, 60)).toBe(0)
    expect(winnerOf(60, 80)).toBe(1)
    expect(winnerOf(70, 70)).toBe('draw')
  })
})

describe('bowling lane', () => {
  it('a ball rolled straight down the middle knocks pins down', () => {
    const lane = newLane(5)
    const knocked = roll(lane, 0, -1, 1500)
    expect(knocked).toBeGreaterThan(0)
    expect(lane.frames[0]).toEqual([knocked])
  })

  it('a ball thrown into the gutter knocks nothing', () => {
    const lane = newLane(5)
    expect(roll(lane, 1, -0.02, 1200)).toBe(0)
  })

  it('a strike ends the frame and racks a fresh set for the next', () => {
    const lane = newLane(3)
    lane.pins = rack()
    // Put every pin down by hand: a strike.
    for (const p of lane.pins) p.down = true
    lane.ball.live = false
    lane.phase = 'roll'
    resolve(lane)
    expect(lane.frames).toEqual([[10], []])
    prepare(lane)
    expect(lane.pins).toHaveLength(10)
  })

  it('a lane is done after the last frame completes', () => {
    const lane = newLane(1)
    lane.frames = [[4]]
    expect(laneDone(lane)).toBe(false)
    lane.frames = [[4, 5]]
    expect(laneDone(lane)).toBe(true)
  })

  it('a roll that is never over is cut off', () => {
    const lane = newLane(1)
    throwBall(lane, 0, -1, 0, 0, 0)
    lane.ball.live = true
    expect(rollOver(lane, 100)).toBe(true)
  })

  it('the bot scores on either lane and five frames end in bounded time', () => {
    for (const seed of [1, 2]) {
      const rng = new Rng(seed)
      const lanes: [Lane, Lane] = [newLane(5), newLane(5)]
      let rolls = 0
      for (let guard = 0; guard < 200 && !lanes.every(laneDone); guard++) {
        for (const lane of lanes) {
          if (laneDone(lane)) continue
          if (lane.phase === 'ready' || lane.phase === 'settle') {
            if (lane.phase === 'settle') prepare(lane)
            const t = choose('hard', rng, lane)
            throwBall(lane, t.dx, t.dy, t.speed, t.curve, 0, t.x)
            let clock = 0
            while (!rollOver(lane, clock) && clock < 10) {
              stepRoll(lane, FRAME)
              clock += FRAME
            }
            resolve(lane)
            rolls++
          }
        }
      }
      expect(lanes.every(laneDone)).toBe(true)
      expect(rolls).toBeLessThanOrEqual(5 * 2 * 2)
      expect(SETTLE).toBeGreaterThan(0)
      // A computer that aims at the pocket should not be hopeless.
      for (const lane of lanes) expect(laneTotal(lane.frames)).toBeGreaterThan(10)
    }
  })

  it('a ball that drops into the gutter stays there, whatever its hook, and knocks nothing', () => {
    const lane = newLane(5)
    // From the left edge, angled out, with a full hook back toward the pins.
    throwBall(lane, -0.35, -1, 1300, 0.9, 0, START_X[0])
    let gutter = false
    let t = 0
    while (!rollOver(lane, t) && t < 10) {
      const ev: { kind: string }[] = []
      stepRoll(lane, FRAME, ev as never)
      if (ev.some((e) => e.kind === 'gutter')) gutter = true
      t += FRAME
    }
    expect(gutter).toBe(true)
    expect(lane.ball.gutter).toBe(true)
    expect(t).toBeLessThan(6)
    expect(resolve(lane)).toBe(0)
  })

  it('the release point is where the player picks the ball up, kept on the lane', () => {
    const lane = newLane(5)
    throwBall(lane, 0, -1, 1500, 0, 0, -500)
    expect(lane.ball.x).toBe(START_X[0])
    throwBall(lane, 0, -1, 1500, 0, 0, 5000)
    expect(lane.ball.x).toBe(START_X[1])
    throwBall(lane, 0, -1, 1500, 0, 0, 450)
    expect(lane.ball.x).toBe(450)
  })

  it('the flick at release sets the speed, not the slow wind-up before it', () => {
    // Slow 0.5 s push, then a quick 0.1 s snap.
    const pts = [
      { x: 500, y: 1700, t: 0 },
      { x: 500, y: 1660, t: 0.25 },
      { x: 500, y: 1620, t: 0.5 },
      { x: 500, y: 1520, t: 0.55 },
      { x: 500, y: 1420, t: 0.6 },
    ]
    const snap = swipeThrow(pts)
    const lazy = swipeThrow(pts.map((p, i) => ({ x: p.x, y: p.y, t: i * 0.3 })))
    expect(snap).not.toBeNull()
    expect(lazy).not.toBeNull()
    expect(snap?.speed ?? 0).toBeGreaterThan(lazy?.speed ?? 0)
  })

  it('a slow gutter ball still rolls off into the pit', () => {
    const lane = newLane(5)
    throwBall(lane, -1, -0.3, 700, 0, 0, START_X[0])
    let t = 0
    while (!rollOver(lane, t) && t < 10) {
      stepRoll(lane, FRAME)
      t += FRAME
    }
    expect(lane.ball.gutter).toBe(true)
    expect(lane.ball.y).toBeLessThan(LANE.pitY)
  })

  it('the bot practises on the real lane: hard knocks more than easy and picks up a corner spare', () => {
    let hard = 0
    let easy = 0
    for (let seed = 1; seed <= 6; seed++) {
      for (const [d, add] of [
        ['hard', (n: number) => (hard += n)],
        ['easy', (n: number) => (easy += n)],
      ] as const) {
        const lane = newLane(5)
        const t = choose(d, new Rng(seed), lane)
        add(trial(lane, t))
      }
    }
    expect(hard).toBeGreaterThan(easy)
    // Only the back-left corner pin standing.
    let picked = 0
    for (let seed = 1; seed <= 5; seed++) {
      const lane = newLane(5)
      lane.frames = [[9]]
      lane.pins = rack().filter((p) => p.slot === 6)
      const t = choose('hard', new Rng(seed), lane)
      if (trial(lane, t) === 1) picked++
    }
    expect(picked).toBeGreaterThanOrEqual(3)
  })
})
