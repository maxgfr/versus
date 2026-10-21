import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import { STEP, type Difficulty, type GameContext, type Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { gaugeValue } from '../../engines/reflex/index.ts'
import { HammerBot } from './bot.ts'
import factory from './index.ts'
import {
  FLY,
  LEAD,
  RING_AT,
  TARGET,
  TIMEOUT,
  puckHeight,
  ringsBell,
  roundSpeed,
  roundWinner,
  swingNew,
  swingStep,
  swingTap,
  swingTimeout,
} from './rules.ts'

/** Run a swing forward to round time `to` in fixed steps. */
function run(sw: ReturnType<typeof swingNew>, from: number, to: number): number {
  let t = from
  while (t < to) {
    t += STEP
    swingStep(sw, STEP, t)
  }
  return t
}

describe('hammer hit rules', () => {
  it('ignores taps during the lead-in', () => {
    const sw = swingNew(0.8)
    run(sw, 0, LEAD / 2)
    expect(swingTap(sw, LEAD / 2)).toBe(false)
    expect(sw.height).toBe(-1)
  })

  it('stops the needle where it is and never moves it again', () => {
    const sw = swingNew(0.8)
    const t = run(sw, 0, LEAD + 0.37)
    expect(swingTap(sw, t)).toBe(true)
    const stopped = sw.height
    expect(stopped).toBeCloseTo(gaugeValue(sw.gauge), 9)
    run(sw, t, t + 2)
    expect(sw.height).toBe(stopped)
    expect(swingTap(sw, t + 2)).toBe(false)
  })

  it('an idle side misses after the timeout and its puck stays down', () => {
    const sw = swingNew(0.8)
    const t = run(sw, 0, LEAD + TIMEOUT - 0.1)
    expect(swingTimeout(sw, t)).toBe(false)
    expect(swingTimeout(sw, LEAD + TIMEOUT)).toBe(true)
    expect(sw.height).toBe(0)
    expect(puckHeight(sw, LEAD + TIMEOUT + 1)).toBe(0)
  })

  it('a puck flies up its column and arrives at the stopped height', () => {
    const sw = swingNew(0.8)
    const t = run(sw, 0, LEAD + 0.5)
    swingTap(sw, t)
    expect(puckHeight(sw, sw.stopT)).toBe(0)
    expect(puckHeight(sw, sw.stopT + FLY / 2)).toBeGreaterThan(0)
    expect(puckHeight(sw, sw.stopT + FLY / 2)).toBeLessThan(sw.height)
    expect(puckHeight(sw, sw.stopT + FLY)).toBeCloseTo(sw.height, 9)
  })

  it('only a puck at the very top rings the bell', () => {
    expect(ringsBell(RING_AT)).toBe(true)
    expect(ringsBell(1)).toBe(true)
    expect(ringsBell(RING_AT - 0.01)).toBe(false)
    expect(ringsBell(0)).toBe(false)
  })

  it('the higher puck wins and near-equal pucks draw', () => {
    expect(roundWinner(0.9, 0.5)).toBe(0)
    expect(roundWinner(0.2, 0.9)).toBe(1)
    expect(roundWinner(0.5, 0.505)).toBe('draw')
    expect(roundWinner(0.5, 0.5)).toBe('draw')
    expect(roundWinner(0, 0.02)).toBe(1)
  })

  it('gauges get quicker each round and stay bounded', () => {
    expect(roundSpeed(1, new Rng(4))).toBeLessThan(roundSpeed(4, new Rng(4)))
    for (let r = 1; r <= 30; r++) {
      const v = roundSpeed(r, new Rng(r))
      expect(v).toBeGreaterThan(0.5)
      expect(v).toBeLessThanOrEqual(1.5 * 1.04 + 1e-9)
    }
  })

  it('a bot plans to stop a little short of the top, closer on hard', () => {
    const mean = (d: Difficulty) => {
      const bot = new HammerBot(new Rng(5), d)
      let sum = 0
      for (let i = 0; i < 300; i++) {
        bot.newRound()
        sum += 1 - bot.target
      }
      return sum / 300
    }
    expect(mean('easy')).toBeGreaterThan(mean('normal'))
    expect(mean('normal')).toBeGreaterThan(mean('hard'))
    expect(mean('hard')).toBeLessThan(0.03)
  })

  it('a bot stops once the needle has reached its point', () => {
    const bot = new HammerBot(new Rng(9), 'normal')
    bot.target = 0.8
    expect(bot.wantsStop(0.79)).toBe(false)
    expect(bot.wantsStop(0.8)).toBe(true)
  })
})

// ---------- game level ----------

function ctxFor(
  bots: [boolean, boolean],
  difficulty: Difficulty,
  seed: number,
  mode: GameContext['mode'] = '2p',
): GameContext {
  const audio = { play: () => {}, unlock: () => {}, buzz: () => {} } as unknown as Audio
  return {
    stage: { edge: (side: Side) => (side === 0 ? 1800 : 0) } as unknown as Stage,
    input: new Input({} as Stage, mode, 0),
    fx: new Fx(),
    audio,
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

describe('hammer hit game', () => {
  it('a human tap in the lead-in is ignored, a tap after it stops the gauge', () => {
    const ctx = ctxFor([false, false], 'normal', 3)
    const game = factory()
    game.init(ctx)
    ctx.input.player(0).press(1, 500, 1300)
    game.update(STEP)
    ctx.input.endStep()
    expect(game.s.swings[0].height).toBe(-1)
    while (game.time < LEAD + 0.2) {
      game.update(STEP)
      ctx.input.endStep()
    }
    ctx.input.player(0).press(2, 500, 1300)
    game.update(STEP)
    ctx.input.endStep()
    expect(game.s.swings[0].height).toBeGreaterThanOrEqual(0)
    expect(game.s.swings[1].height).toBe(-1)
  })

  it('a side that never taps loses every round it does not answer', () => {
    const ctx = ctxFor([false, true], 'hard', 21, '1p')
    const game = factory()
    game.init(ctx)
    let steps = 0
    while (!game.result) {
      game.update(STEP)
      ctx.input.endStep()
      if (++steps > 60 * 240) throw new Error('no result')
    }
    expect(game.result.winner).toBe(1)
    expect(game.result.score).toEqual([0, TARGET])
  })

  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot plays a best-of-5 match to a result (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 31))
      let steps = 0
      while (!game.result) {
        game.update(STEP)
        if (++steps > 60 * 240) throw new Error('no result')
      }
      const [red, blue] = game.result.score ?? [0, 0]
      const w = game.result.winner
      expect(w === 0 || w === 1).toBe(true)
      expect(w === 0 ? red : blue).toBe(TARGET)
      expect(Math.min(red, blue)).toBeLessThan(TARGET)
    })
  }
})
