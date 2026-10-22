import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import { STEP, type Difficulty, type GameContext, type Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import { MID, type Stage } from '../../core/stage.ts'
import { SashimiBot } from './bot.ts'
import factory from './index.ts'
import {
  DEAD,
  DECOY_FIRST,
  DECOY_GAP,
  GRACE,
  LIVE_MAX,
  TARGET,
  WAIT_MAX,
  WAIT_MIN,
  decoysFor,
  judgeTaps,
  reactionRange,
  roundSignal,
  slipChance,
  tapSide,
} from './rules.ts'

describe('the last sashimi rules', () => {
  it('a tap before the bell loses the round for the tapper', () => {
    expect(judgeTaps('wait', [true, false])).toBe(1)
    expect(judgeTaps('wait', [false, true])).toBe(0)
  })

  it('after the bell the first tap takes the round', () => {
    expect(judgeTaps('live', [true, false])).toBe(0)
    expect(judgeTaps('live', [false, true])).toBe(1)
  })

  it('taps in the same step cancel into a draw', () => {
    expect(judgeTaps('live', [true, true])).toBe('draw')
    expect(judgeTaps('wait', [true, true])).toBe('draw')
  })

  it('no tap decides nothing', () => {
    expect(judgeTaps('wait', [false, false])).toBeNull()
    expect(judgeTaps('live', [false, false])).toBeNull()
  })

  it('the real bell is scheduled inside the wait window', () => {
    for (let seed = 0; seed < 50; seed++) {
      const sig = roundSignal(new Rng(seed))
      expect(sig.phase).toBe('wait')
      expect(sig.fake).toBe(false)
      expect(sig.at).toBeGreaterThanOrEqual(WAIT_MIN)
      expect(sig.at).toBeLessThanOrEqual(WAIT_MAX)
    }
  })

  it('decoys come in order, before the real bell, and never too early', () => {
    let some = 0
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Rng(seed)
      const at = 2 + rng.next() * 2
      const decoys = decoysFor(new Rng(seed + 1000), at)
      expect(decoys.length).toBeLessThanOrEqual(2)
      if (decoys.length) some++
      for (let i = 0; i < decoys.length; i++) {
        const t = decoys[i] as number
        expect(t).toBeGreaterThanOrEqual(DECOY_FIRST)
        expect(t).toBeLessThanOrEqual(at - DECOY_GAP)
        if (i > 0) expect(t).toBeGreaterThanOrEqual(decoys[i - 1] as number)
      }
    }
    expect(some).toBeGreaterThan(50)
  })

  it('no decoys when the bell is too soon for them', () => {
    expect(decoysFor(new Rng(1), DECOY_FIRST)).toEqual([])
  })

  it('reaction times sit in 280 to 550 ms and get quicker with difficulty', () => {
    const [ea, eb] = reactionRange('easy')
    const [na, nb] = reactionRange('normal')
    const [ha, hb] = reactionRange('hard')
    expect(ea).toBeGreaterThanOrEqual(0.28)
    expect(eb).toBeLessThanOrEqual(0.55)
    expect(ha).toBeGreaterThanOrEqual(0.28)
    expect(ha).toBeLessThan(na)
    expect(na).toBeLessThan(ea)
    expect(nb).toBeLessThan(eb)
    expect(hb).toBeLessThan(nb)
  })

  it('hard bots are rarely fooled by a decoy', () => {
    expect(slipChance('hard')).toBeLessThan(slipChance('normal'))
    expect(slipChance('normal')).toBeLessThan(slipChance('easy'))
    expect(slipChance('hard')).toBeLessThanOrEqual(0.05)
  })
})

describe('the last sashimi bot', () => {
  const runRound = (bot: SashimiBot, sigAt: number): number => {
    // Returns the time (since the wait began) the bot taps, or -1.
    let t = 0
    while (t < sigAt) {
      t += STEP
      if (bot.act('wait', t)) return t
    }
    let lt = 0
    while (lt < 2) {
      lt += STEP
      if (bot.act('live', lt)) return sigAt + lt
    }
    return -1
  }

  it('answers the real bell inside its difficulty reaction window', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      const [lo, hi] = reactionRange(d)
      for (let seed = 0; seed < 40; seed++) {
        const bot = new SashimiBot(new Rng(seed), d)
        bot.newRound([])
        let lt = 0
        let tapAt = -1
        while (lt < 2 && tapAt < 0) {
          lt += STEP
          if (bot.act('live', lt)) tapAt = lt
        }
        expect(tapAt).toBeGreaterThanOrEqual(lo - STEP)
        expect(tapAt).toBeLessThanOrEqual(hi + STEP)
      }
    }
  })

  it('a bot that falls for a decoy taps before the bell', () => {
    let fooled = 0
    for (let seed = 0; seed < 200; seed++) {
      const b = new SashimiBot(new Rng(seed), 'easy')
      b.newRound([0.9])
      const t = runRound(b, 3)
      if (t >= 0 && t < 3) fooled++
    }
    expect(fooled).toBeGreaterThan(20)
  })

  it('hard bots fall for decoys far less often than easy ones', () => {
    const count = (d: Difficulty) => {
      let n = 0
      for (let seed = 0; seed < 300; seed++) {
        const b = new SashimiBot(new Rng(seed), d)
        b.newRound([0.9])
        const t = runRound(b, 3)
        if (t >= 0 && t < 3) n++
      }
      return n
    }
    expect(count('hard')).toBeLessThan(count('easy'))
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

describe('the last sashimi game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot plays a best-of-5 match to a result (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 17))
      let steps = 0
      while (!game.result) {
        game.update(STEP)
        if (++steps > 60 * 300) throw new Error('no result')
      }
      const [red, blue] = game.result.score ?? [0, 0]
      const w = game.result.winner
      expect(w === 0 || w === 1).toBe(true)
      expect(w === 0 ? red : blue).toBe(TARGET)
      expect(Math.min(red, blue)).toBeLessThan(TARGET)
    })
  }

  /** Advance whole steps the way the session does. */
  const run = (game: ReturnType<typeof factory>, ctx: GameContext, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / STEP); i++) {
      ctx.input.setNow(game.time)
      game.update(STEP)
      ctx.input.endStep()
    }
  }
  const tap = (game: ReturnType<typeof factory>, ctx: GameContext, side: Side, y: number) => {
    ctx.input.player(side).press(side * 10 + 1, 300, y)
    ctx.input.player(side).release(side * 10 + 1)
    run(game, ctx, STEP)
  }
  const twoHumans = (seed = 5) => {
    const ctx = ctxFor([false, false], 'normal', seed, '2p')
    const game = factory()
    game.init(ctx)
    return { ctx, game }
  }

  it('a human who jumps the bell loses the round to the bot', () => {
    const ctx = ctxFor([false, true], 'normal', 5, '1p')
    const game = factory()
    game.init(ctx)
    // Tap once the round has settled, while the bell is still waiting.
    run(game, ctx, GRACE + 0.1)
    tap(game, ctx, 0, 1300)
    expect(game.s.rounds.wins).toEqual([0, 1])
    expect(game.s.rounds.phase).toBe('between')
  })

  it('a leftover tap as the round opens is not a false start', () => {
    const { ctx, game } = twoHumans()
    tap(game, ctx, 0, 1300)
    expect(game.s.rounds.phase).toBe('play')
    expect(game.s.rounds.wins).toEqual([0, 0])
  })

  it('the first tap after the bell takes the round, the ms is the real reaction', () => {
    const { ctx, game } = twoHumans()
    run(game, ctx, game.s.sig.at + 0.25)
    expect(game.s.sig.phase).toBe('live')
    tap(game, ctx, 1, 400)
    expect(game.s.took).toBe(1)
    expect(game.s.rounds.wins).toEqual([0, 1])
    expect(game.s.reaction).toBeGreaterThan(0.2)
    expect(game.s.reaction).toBeLessThan(0.32)
  })

  it('both tapping in the same step after the bell is a draw round', () => {
    const { ctx, game } = twoHumans()
    run(game, ctx, game.s.sig.at + 0.3)
    ctx.input.player(0).press(1, 300, 1300)
    ctx.input.player(1).press(2, 300, 400)
    run(game, ctx, STEP)
    expect(game.s.took).toBe('draw')
    expect(game.s.rounds.wins).toEqual([0, 0])
    expect(game.s.rounds.phase).toBe('between')
  })

  it('both jumping the bell in the same step is a draw round', () => {
    const { ctx, game } = twoHumans()
    run(game, ctx, GRACE + 0.1)
    ctx.input.player(0).press(1, 300, 1300)
    ctx.input.player(1).press(2, 300, 400)
    run(game, ctx, STEP)
    expect(game.s.took).toBe('draw')
    expect(game.s.early).toEqual([true, true])
  })

  it('a round nobody grabs is void instead of hanging forever', () => {
    const { ctx, game } = twoHumans()
    run(game, ctx, game.s.sig.at + LIVE_MAX + 0.2)
    expect(game.s.took).toBe('draw')
    expect(game.s.rounds.phase).toBe('between')
    // And the next round starts on its own.
    run(game, ctx, 2.2)
    expect(game.s.rounds.phase).toBe('play')
    expect(game.s.rounds.round).toBe(2)
    expect(game.s.took).toBeNull()
  })

  it('local 2P: a touch on the midline belongs to nobody, not to the rival', () => {
    expect(tapSide(MID - 20)).toBeNull()
    expect(tapSide(MID + 20)).toBeNull()
    expect(tapSide(MID + DEAD + 1)).toBe(0)
    expect(tapSide(MID - DEAD - 1)).toBe(1)
    const { ctx, game } = twoHumans()
    expect(ctx.input.assign?.(500, MID - 10)).toBeNull()
    expect(ctx.input.assign?.(500, 1500)).toBe(0)
    expect(game.s.rounds.phase).toBe('play')
  })

  it('the match ends at the chosen target with the score, then stays decided', () => {
    const ctx = { ...ctxFor([false, false], 'normal', 9, '2p'), target: 2 }
    const game = factory()
    game.init(ctx)
    for (let r = 0; r < 2; r++) {
      run(game, ctx, game.s.sig.at + 0.3)
      tap(game, ctx, 0, 1300)
      run(game, ctx, 2.1)
    }
    expect(game.s.winner).toBe(0)
    expect(game.result).toEqual({ winner: 0, score: [2, 0] })
  })
})
