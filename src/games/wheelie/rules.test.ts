import { describe, expect, it } from 'vitest'
import type { Difficulty, GameContext, Side } from '../../core/game.ts'
import { Fx } from '../../core/fx/fx.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import makeGame from './index.ts'
import { drive, newBrain } from './bot.ts'
import {
  FLIP,
  heightAt,
  metres,
  newBike,
  RUN_CAP,
  stepBike,
  terrainFor,
  wheelieAngle,
} from './rules.ts'

const DT = 1 / 60

function ctxFor(
  seed: number,
  mode: GameContext['mode'],
  bots: [boolean, boolean],
  difficulty: Difficulty = 'normal',
): GameContext {
  return {
    stage: {} as Stage,
    input: new Input({} as Stage, mode, 0),
    fx: new Fx(),
    audio: { play: () => {} } as unknown as GameContext['audio'],
    rng: new Rng(seed),
    mode,
    difficulty,
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
  }
}

describe('wheelie terrain', () => {
  it('is flat at the start so the bike can set off', () => {
    const t = terrainFor(7, 0)
    for (let x = 0; x <= 60; x += 10) expect(heightAt(t, x)).toBeCloseTo(0, 9)
  })

  it('is a pure function of seed and run, and differs between runs', () => {
    expect(terrainFor(42, 1)).toEqual(terrainFor(42, 1))
    expect(terrainFor(42, 0)).not.toEqual(terrainFor(42, 1))
  })

  it('stays within the lane: no hill is taller than the lane allows', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = terrainFor(seed, 0)
      for (let x = 0; x < 20000; x += 25) expect(Math.abs(heightAt(t, x))).toBeLessThan(80)
    }
  })
})

describe('wheelie bike', () => {
  it('scores nothing while the front wheel stays down', () => {
    const t = terrainFor(3, 0)
    const b = newBike()
    for (let f = 0; f < 60 * 5; f++) stepBike(b, t, DT, false)
    expect(b.started).toBe(false)
    expect(b.wheelie).toBe(0)
    expect(b.end).toBeNull()
  })

  it('lifts the front with the throttle, then drops it when released', () => {
    const t = terrainFor(3, 0)
    const b = newBike()
    let lifted = false
    for (let f = 0; f < 60 * 6 && !lifted; f++) {
      stepBike(b, t, DT, true)
      lifted = b.started
    }
    expect(lifted).toBe(true)
    // Let go: the spring pulls the nose down and the front touches.
    let ev: string | null = null
    for (let f = 0; f < 60 * 6 && !b.end; f++) {
      const e = stepBike(b, t, DT, false)
      if (e) ev = e
    }
    expect(ev).toBe('dropped')
    expect(b.end).toBe('dropped')
  })

  it('flips over backwards when the throttle is held too long', () => {
    const t = terrainFor(5, 0)
    const b = newBike()
    let ev: string | null = null
    for (let f = 0; f < 60 * 30 && !b.end; f++) {
      const e = stepBike(b, t, DT, true)
      if (e) ev = e
    }
    expect(ev).toBe('flip')
    expect(wheelieAngle(t, b)).toBeGreaterThanOrEqual(FLIP)
  })

  it('stops the run at the time cap', () => {
    const t = terrainFor(9, 0)
    const b = newBike()
    const rng = new Rng(4)
    const brain = newBrain()
    for (let f = 0; f < 60 * (RUN_CAP + 2) && !b.end; f++) {
      stepBike(b, t, DT, drive(b, wheelieAngle(t, b), 'hard', rng, brain))
    }
    expect(b.end === 'capped' || b.end === 'flipped' || b.end === 'dropped').toBe(true)
    expect(b.age).toBeLessThanOrEqual(RUN_CAP + DT)
  })

  it('counts metres in tenths of a unit', () => {
    expect(metres(0)).toBe(0)
    expect(metres(9.9)).toBe(0)
    expect(metres(1234)).toBe(123)
  })
})

describe('wheelie bot', () => {
  it('keeps out of the flip and does not drop the front once it is up', () => {
    const t = terrainFor(11, 0)
    const b = newBike()
    const rng = new Rng(2)
    const brain = newBrain()
    let dropped = false
    let flipped = false
    for (let f = 0; f < 60 * 20 && !b.end; f++) {
      stepBike(b, t, DT, drive(b, wheelieAngle(t, b), 'hard', rng, brain))
    }
    if (b.end === 'dropped') dropped = true
    if (b.end === 'flipped') flipped = true
    expect(dropped).toBe(false)
    expect(flipped).toBe(false)
    expect(b.wheelie).toBeGreaterThan(0)
  })

  it('a hard bot rides further than an easy one on average', () => {
    const avg = (d: Difficulty) => {
      let sum = 0
      for (let seed = 1; seed <= 6; seed++) {
        const t = terrainFor(seed, 0)
        const b = newBike()
        const rng = new Rng(seed)
        const brain = newBrain()
        for (let f = 0; f < 60 * 50 && !b.end; f++) {
          stepBike(b, t, DT, drive(b, wheelieAngle(t, b), d, rng, brain))
        }
        sum += b.wheelie
      }
      return sum / 6
    }
    expect(avg('hard')).toBeGreaterThan(avg('easy'))
  })
})

describe('wheelie game', () => {
  /** Computer against computer through the game's own loop: it must finish in bounded steps. */
  function bots(seed: number, difficulty: Difficulty, mode: GameContext['mode'] = '2p') {
    const game = makeGame()
    game.init(ctxFor(seed, mode, [true, true], difficulty))
    let steps = 0
    while (!game.result && steps < 60 * 400) {
      game.update(1 / 60)
      steps++
    }
    return { game, steps }
  }

  it('a bot-vs-bot match reaches a result within bounded steps, on every seed', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { game, steps } = bots(seed, 'normal')
      expect(game.result).not.toBeNull()
      expect(steps).toBeLessThan(60 * 300)
      expect(game.result?.score).toHaveLength(2)
      for (const side of [0, 1] as Side[]) expect(game.s.runs[side]).toHaveLength(2)
    }
  })

  it('each side banks two runs and the best one decides the match', () => {
    const { game } = bots(8, 'hard')
    const best = (side: Side) => Math.max(...game.s.runs[side])
    const winner = best(0) === best(1) ? 'draw' : best(0) > best(1) ? 0 : 1
    expect(game.result?.winner).toBe(winner)
    expect(game.result?.score).toEqual([best(0), best(1)])
  })

  it('a human who never touches the screen can only lose on time', () => {
    const game = makeGame()
    game.init(ctxFor(12, '1p', [false, false]))
    let steps = 0
    while (!game.result && steps < 60 * 400) {
      game.update(1 / 60)
      steps++
    }
    expect(game.result?.score).toEqual([0, 0])
    expect(game.result?.winner).toBe('draw')
  })
})
