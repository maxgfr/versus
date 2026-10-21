import { describe, expect, it } from 'vitest'
import { Rng } from '../../core/rng.ts'
import { choose } from './bot.ts'
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
            const t = choose('hard', rng)
            throwBall(lane, t.dx, t.dy, t.speed, t.curve, 0)
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
})
