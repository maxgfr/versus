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
  COUNTDOWN,
  FLY,
  LEAD,
  RING_AT,
  TARGET,
  TIMEOUT,
  puckHeight,
  ringsBell,
  roundSpeed,
  roundWinner,
  score,
  swingNew,
  swingStep,
  swingTap,
  swingTimeout,
  swingUpdate,
  timeLeft,
  type SwingEvent,
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
    expect(roundWinner(0.5, 0.504)).toBe('draw')
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

  it('the winner is decided on the readout: equal numbers draw, different numbers never do', () => {
    // Bug: a 0.01 height tolerance drew 86 vs 87 and decided 87 vs 87 silently.
    expect(score(0.8649)).toBe(86)
    expect(score(0.8701)).toBe(87)
    expect(roundWinner(0.8649, 0.8701)).toBe(1)
    expect(roundWinner(0.8749, 0.8751)).toBe(1)
    expect(roundWinner(0.871, 0.874)).toBe('draw')
    expect(roundWinner(0, 0)).toBe('draw')
  })

  it('the bell rings for every readout of 96 and up, and never below', () => {
    // Bug: a puck reading "96" (0.957) did not ring the bell.
    expect(ringsBell(0.957)).toBe(true)
    expect(score(0.957)).toBe(96)
    expect(ringsBell(0.954)).toBe(false)
  })

  it('swingUpdate: stop, flight, landing, in order', () => {
    const sw = swingNew(0.8)
    let rt = 0
    const kinds: string[] = []
    for (let i = 0; i < 200; i++) {
      rt += STEP
      const pressed = rt >= LEAD + 0.3 && sw.height < 0
      for (const e of swingUpdate(sw, 0, STEP, rt, pressed)) kinds.push(e.kind)
    }
    expect(kinds).toEqual(['stop', 'land'])
    expect(sw.landed).toBe(true)
    expect(sw.missed).toBe(false)
  })

  it('an idle side hears 3, 2, 1 then misses, and its puck lands flat', () => {
    const sw = swingNew(0.8)
    let rt = 0
    const evs: SwingEvent[] = []
    while (rt < LEAD + TIMEOUT + FLY + 0.5) {
      rt += STEP
      evs.push(...swingUpdate(sw, 1, STEP, rt, false))
    }
    const ticks = evs.filter((e) => e.kind === 'tick').map((e) => (e.kind === 'tick' ? e.left : 0))
    expect(ticks).toEqual([3, 2, 1])
    expect(ticks.length).toBe(COUNTDOWN)
    expect(evs.filter((e) => e.kind === 'miss')).toHaveLength(1)
    const land = evs.find((e) => e.kind === 'land')
    expect(land).toMatchObject({ kind: 'land', side: 1, height: 0, missed: true })
    expect(timeLeft(sw, rt)).toBe(Infinity)
  })

  it('a press after the stop changes nothing', () => {
    const sw = swingNew(0.8)
    let rt = 0
    while (rt < LEAD + 0.4) {
      rt += STEP
      swingUpdate(sw, 0, STEP, rt, false)
    }
    rt += STEP
    swingUpdate(sw, 0, STEP, rt, true)
    const h = sw.height
    rt += STEP
    expect(swingUpdate(sw, 0, STEP, rt, true).filter((e) => e.kind === 'stop')).toHaveLength(0)
    expect(sw.height).toBe(h)
  })
})

describe('hammer hit bot', () => {
  /** Mean readout and worst readout a bot gets over many rounds at a gauge speed. */
  function play(d: Difficulty, speed: number, seed = 5): { mean: number; worst: number } {
    const bot = new HammerBot(new Rng(seed), d)
    let sum = 0
    let worst = 100
    for (let i = 0; i < 400; i++) {
      bot.newRound()
      const sw = swingNew(speed)
      let rt = 0
      while (sw.height < 0) {
        rt += STEP
        swingUpdate(sw, 0, STEP, rt, rt >= LEAD && bot.wantsStop(sw))
      }
      expect(sw.missed).toBe(false)
      sum += score(sw.height)
      worst = Math.min(worst, score(sw.height))
    }
    return { mean: sum / 400, worst }
  }

  it('aims at the peak with a clear easy / normal / hard spread', () => {
    const easy = play('easy', 0.76)
    const normal = play('normal', 0.76)
    const hard = play('hard', 0.76)
    expect(easy.mean).toBeLessThan(normal.mean - 3)
    expect(normal.mean).toBeLessThan(hard.mean - 2)
    expect(easy.mean).toBeLessThan(90)
    expect(hard.mean).toBeGreaterThan(95)
    expect(hard.worst).toBeGreaterThan(85)
  })

  it('a faster gauge costs it height, as it would a person', () => {
    expect(play('normal', 1.5).mean).toBeLessThan(play('normal', 0.76).mean)
  })

  it('never strikes during the lead-in nor twice', () => {
    const bot = new HammerBot(new Rng(2), 'hard')
    const sw = swingNew(1)
    expect(swingTap(sw, LEAD / 2)).toBe(false)
    let rt = LEAD
    while (sw.height < 0) {
      rt += STEP
      swingUpdate(sw, 0, STEP, rt, bot.wantsStop(sw))
    }
    expect(bot.wantsStop(sw)).toBe(false)
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

  it('two idle players only draw rounds and the game keeps cycling (no soft-lock)', () => {
    const ctx = ctxFor([false, false], 'normal', 8)
    const game = factory()
    game.init(ctx)
    for (let i = 0; i < 60 * 30; i++) {
      game.update(STEP)
      ctx.input.endStep()
    }
    expect(game.result).toBeNull()
    expect(game.s.rounds.wins).toEqual([0, 0])
    expect(game.s.rounds.round).toBeGreaterThan(2)
  })

  it('reads the chosen match length', () => {
    const ctx = { ...ctxFor([true, true], 'hard', 12), target: 1 }
    const game = factory()
    game.init(ctx)
    let steps = 0
    while (!game.result) {
      game.update(STEP)
      if (++steps > 60 * 120) throw new Error('no result')
    }
    expect(Math.max(...(game.result.score ?? [0, 0]))).toBe(1)
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
