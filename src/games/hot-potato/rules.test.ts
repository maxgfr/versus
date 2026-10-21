import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import { other, STEP, type Difficulty, type GameContext, type Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { PotatoBot } from './bot.ts'
import factory from './index.ts'
import {
  BOOM_MAX,
  BOOM_MIN,
  CATCH,
  HEAT_THROWS,
  LIMIT_B,
  LIMIT_R,
  SPEED0,
  SPEED_MAX,
  TARGET,
  boomDelay,
  canThrow,
  heatOf,
  holderOf,
  potatoNew,
  potatoStep,
  speedOf,
  throwPotato,
} from './rules.ts'

describe('hot potato rules', () => {
  it('the half a potato is in decides who holds it', () => {
    expect(holderOf(1200)).toBe(0)
    expect(holderOf(600)).toBe(1)
    expect(holderOf(LIMIT_R)).toBe(0)
    expect(holderOf(LIMIT_B)).toBe(1)
  })

  it('a served potato waits at the server’s catch point', () => {
    const p = potatoNew(1, 0)
    expect(p.holder).toBe(1)
    expect(p.y).toBe(LIMIT_B)
    expect(p.held).toBe(true)
    potatoStep(p, 1, 1)
    expect(p.y).toBe(LIMIT_B)
  })

  it('only the holder may throw, and only after the catch delay', () => {
    const p = potatoNew(0, 0)
    expect(canThrow(p, 0, 0)).toBe(false)
    expect(canThrow(p, 0, CATCH - STEP)).toBe(false)
    expect(canThrow(p, 0, CATCH)).toBe(true)
    expect(canThrow(p, 1, 5)).toBe(false)
  })

  it('a throw sends the potato back the other way and makes it hotter', () => {
    const p = potatoNew(0, 0)
    throwPotato(p, 0)
    expect(p.dir).toBe(-1)
    expect(p.held).toBe(false)
    expect(p.throws).toBe(1)
    const q = potatoNew(1, 0)
    throwPotato(q, 1)
    expect(q.dir).toBe(1)
  })

  it('a potato already thrown cannot be thrown again on its way out', () => {
    const p = potatoNew(0, 0)
    throwPotato(p, 0)
    potatoStep(p, STEP, 1)
    expect(holderOf(p.y)).toBe(0)
    expect(canThrow(p, 0, 1)).toBe(false)
  })

  it('the potato moves toward the other half and stops at the far catch point', () => {
    const p = potatoNew(0, 0)
    throwPotato(p, 0)
    let t = 0
    while (p.held === false && t < 10) {
      t += STEP
      potatoStep(p, STEP, t)
    }
    expect(p.y).toBe(LIMIT_B)
    expect(p.held).toBe(true)
    expect(p.holder).toBe(1)
  })

  it('crossing the midline hands the potato to the other half and restarts the catch clock', () => {
    const p = potatoNew(0, 0)
    throwPotato(p, 0)
    let t = 0
    let crossedAt = -1
    while (crossedAt < 0 && t < 10) {
      t += STEP
      const before = p.holder
      potatoStep(p, STEP, t)
      if (p.holder !== before) crossedAt = t
    }
    expect(crossedAt).toBeGreaterThan(0)
    expect(p.holder).toBe(1)
    expect(p.enteredAt).toBeCloseTo(crossedAt, 9)
    expect(canThrow(p, 1, crossedAt)).toBe(false)
    expect(canThrow(p, 1, crossedAt + CATCH)).toBe(true)
  })

  it('flights get quicker with every throw, up to a cap', () => {
    expect(speedOf(0)).toBe(SPEED0)
    expect(speedOf(1)).toBeGreaterThan(speedOf(0))
    expect(speedOf(100)).toBe(SPEED_MAX)
  })

  it('heat rises with throws and tops out', () => {
    expect(heatOf(0)).toBe(0)
    expect(heatOf(HEAT_THROWS / 2)).toBeCloseTo(0.5, 9)
    expect(heatOf(HEAT_THROWS * 3)).toBe(1)
  })

  it('the hidden timer is seeded and lands inside its window', () => {
    for (let seed = 0; seed < 100; seed++) {
      const d = boomDelay(new Rng(seed))
      expect(d).toBeGreaterThanOrEqual(BOOM_MIN)
      expect(d).toBeLessThanOrEqual(BOOM_MAX)
      expect(boomDelay(new Rng(seed))).toBe(d)
    }
  })
})

describe('hot potato bot', () => {
  it('a bot throws only after its reaction, never before the catch delay', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 30; seed++) {
        const bot = new PotatoBot(new Rng(seed), d)
        let t = 0
        let threw = -1
        while (threw < 0 && t < 3) {
          t += STEP
          if (bot.drive(t, 0, 0, 0)) threw = t
        }
        expect(threw).toBeGreaterThanOrEqual(CATCH)
      }
    }
  })

  it('hard reacts faster than easy', () => {
    const reaction = (d: Difficulty) => {
      let sum = 0
      for (let seed = 0; seed < 100; seed++) {
        const bot = new PotatoBot(new Rng(seed), d)
        let t = 0
        while (!bot.drive(t, 1 as Side, 0, 1)) t += STEP
        sum += t
      }
      return sum / 100
    }
    expect(reaction('hard')).toBeLessThan(reaction('normal'))
    expect(reaction('normal')).toBeLessThan(reaction('easy'))
  })

  it('a bot does nothing while the other half holds the potato', () => {
    const bot = new PotatoBot(new Rng(1), 'hard')
    let threw = false
    for (let t = 0; t < 3; t += STEP) if (bot.drive(t, 0, 0, 1)) threw = true
    expect(threw).toBe(false)
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

describe('hot potato game', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`bot vs bot plays a best-of-5 match to a result (${difficulty})`, () => {
      const game = factory()
      game.init(ctxFor([true, true], difficulty, 9))
      let steps = 0
      while (!game.result) {
        game.update(STEP)
        if (++steps > 60 * 400) throw new Error('no result')
      }
      const [red, blue] = game.result.score ?? [0, 0]
      const w = game.result.winner
      expect(w === 0 || w === 1).toBe(true)
      expect(w === 0 ? red : blue).toBe(TARGET)
      expect(Math.min(red, blue)).toBeLessThan(TARGET)
    })
  }

  it('whoever holds the potato when it blows loses the round', () => {
    // Blue is a bot and throws; red never does. The round goes to whichever
    // side was not holding the potato at the moment it blew.
    const ctx = ctxFor([false, true], 'hard', 14, '1p')
    const game = factory()
    game.init(ctx)
    let steps = 0
    let checked = false
    let wasBoomed = game.s.boomed
    while (game.s.rounds.wins[0] + game.s.rounds.wins[1] < 1 && steps < 60 * 120) {
      const holder = holderOf(game.s.pot.y)
      game.update(STEP)
      ctx.input.endStep()
      if (wasBoomed < 0 && game.s.boomed >= 0) {
        expect(game.s.rounds.last).toBe(other(holder))
        checked = true
      }
      wasBoomed = game.s.boomed
      steps++
    }
    expect(checked).toBe(true)
  })
})
