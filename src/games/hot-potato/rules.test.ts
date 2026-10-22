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
  BOOST,
  CATCH,
  FOLLOW,
  FUMBLE,
  HEAT_THROWS,
  LIMIT_B,
  LIMIT_R,
  SPEED0,
  SPEED_MAX,
  TARGET,
  boomDelay,
  canThrow,
  followThrough,
  heatOf,
  holderOf,
  incoming,
  potatoNew,
  potatoStep,
  speedOf,
  tapResult,
  throwPotato,
  warmth,
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

  it('grabbing before the catch delay is a fumble that burns the fingers for a moment', () => {
    const p = potatoNew(0, 0)
    expect(tapResult(p, 0, CATCH / 2)).toBe('fumble')
    const lock = CATCH / 2 + FUMBLE
    // Locked out even after the catch delay, until the fingers cool.
    expect(canThrow(p, 0, CATCH, lock)).toBe(false)
    expect(tapResult(p, 0, lock - STEP, lock)).toBe('fumble')
    expect(tapResult(p, 0, lock, lock)).toBe('throw')
  })

  it('mashing is slower than one clean tap (it used to be the best play)', () => {
    // A masher taps every 0.1 s from the moment the potato is theirs; each tap
    // too soon renews the burn. A clean tap waits for the catch delay.
    const firstThrow = (tapEvery: number, firstTap: number): number => {
      const p = potatoNew(0, 0)
      let lock = -Infinity
      for (let t = firstTap; t < 5; t += tapEvery) {
        const r = tapResult(p, 0, t, lock)
        if (r === 'throw') return t
        if (r === 'fumble') lock = t + FUMBLE
      }
      return Infinity
    }
    expect(firstThrow(10, CATCH + 0.15)).toBeCloseTo(CATCH + 0.15, 9)
    expect(firstThrow(0.1, 0.02)).toBe(Infinity)
  })

  it('a tap while the potato is the rival’s problem does nothing', () => {
    const p = potatoNew(1, 0)
    expect(tapResult(p, 0, 5)).toBe('none')
    // Thrown by red and on its way out of red's half: red's taps do nothing.
    const q = potatoNew(0, 0)
    throwPotato(q, 0, 1)
    potatoStep(q, STEP, 1 + STEP)
    expect(holderOf(q.y)).toBe(0)
    expect(incoming(q, 0)).toBe(false)
    expect(tapResult(q, 0, 2)).toBe('none')
  })

  it('a potato flying at you can be sent back before it reaches the mitt', () => {
    const p = potatoNew(1, 0)
    throwPotato(p, 1, 0)
    let t = 0
    while (holderOf(p.y) !== 0) {
      t += STEP
      potatoStep(p, STEP, t)
    }
    const entered = p.enteredAt
    expect(tapResult(p, 0, entered + CATCH)).toBe('throw')
    const y = p.y
    throwPotato(p, 0, entered + CATCH)
    expect(p.y).toBe(y)
    expect(p.y).toBeLessThan(LIMIT_R)
    expect(p.dir).toBe(-1)
  })

  it('a flick right after the throw speeds the potato up; late, weaker or other flicks do not', () => {
    const p = potatoNew(0, 0)
    throwPotato(p, 0, 1)
    const base = p.v
    expect(base).toBe(speedOf(1))
    expect(followThrough(p, 1, 1, 1)).toBe(false)
    expect(followThrough(p, 0, 0.5, 1 + STEP)).toBe(true)
    expect(p.v).toBeCloseTo(base * (1 + BOOST * 0.5), 9)
    expect(followThrough(p, 0, 0.3, 1 + 2 * STEP)).toBe(false)
    expect(p.power).toBe(0.5)
    expect(followThrough(p, 0, 1, 1 + FOLLOW + STEP)).toBe(false)
    expect(p.v).toBeCloseTo(base * (1 + BOOST * 0.5), 9)
  })

  it('a flicked throw leaves your half sooner than a plain tap', () => {
    const timeOut = (force: number) => {
      const p = potatoNew(0, 0)
      throwPotato(p, 0, 0)
      followThrough(p, 0, force, 0)
      let t = 0
      while (holderOf(p.y) === 0) {
        t += STEP
        potatoStep(p, STEP, t)
      }
      return t
    }
    expect(timeOut(1)).toBeLessThan(timeOut(0) * 0.7)
  })

  it('the potato never leaves the lane, however fast it flies', () => {
    const p = potatoNew(0, 0)
    let t = 0
    for (let i = 0; i < 200; i++) {
      const side = holderOf(p.y)
      throwPotato(p, side, t)
      followThrough(p, side, 1, t)
      while (!p.held) {
        t += STEP
        potatoStep(p, STEP, t)
        expect(p.y).toBeGreaterThanOrEqual(LIMIT_B)
        expect(p.y).toBeLessThanOrEqual(LIMIT_R)
      }
    }
    expect(p.v).toBeLessThanOrEqual(SPEED_MAX * (1 + BOOST))
  })

  it('the match ramps up: match point and deciders start with a warm, faster potato', () => {
    expect(warmth([0, 0], 3)).toBe(0)
    expect(warmth([1, 1], 3)).toBe(0)
    expect(warmth([2, 0], 3)).toBe(2)
    expect(warmth([1, 2], 3)).toBe(2)
    expect(warmth([2, 2], 3)).toBe(3)
    // A single-round match is a decider from the start.
    expect(warmth([0, 0], 1)).toBe(3)
    const calm = potatoNew(0, 0)
    const tense = potatoNew(0, 0, warmth([2, 2], 3))
    expect(heatOf(tense.throws)).toBeGreaterThan(heatOf(calm.throws))
    throwPotato(calm, 0, 0)
    throwPotato(tense, 0, 0)
    expect(tense.v).toBeGreaterThan(calm.v)
    expect(tense.v).toBeLessThanOrEqual(SPEED_MAX)
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

/** Play one potato round between two bots with the real rules; returns the loser and each side's time holding. */
function botRound(
  bots: [PotatoBot, PotatoBot],
  server: Side,
  boomIn: number,
  warm = 0,
): { loser: Side; held: [number, number]; throws: number } {
  const p = potatoNew(server, 0, warm)
  const lock: [number, number] = [-1, -1]
  const held: [number, number] = [0, 0]
  let t = 0
  while (t < boomIn) {
    for (const side of [0, 1] as Side[]) {
      const touch = bots[side].drive(t, p, side, lock[side])
      if (touch.tap) {
        const r = tapResult(p, side, t, lock[side])
        if (r === 'throw') {
          throwPotato(p, side, t)
          followThrough(p, side, touch.force, t)
        } else if (r === 'fumble') lock[side] = t + FUMBLE
      }
    }
    potatoStep(p, STEP, t)
    held[holderOf(p.y)] += STEP
    t += STEP
  }
  return { loser: holderOf(p.y), held, throws: p.throws }
}

describe('hot potato bot', () => {
  it('a bot always gets rid of the potato, and never throws before the catch delay', () => {
    for (const d of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 40; seed++) {
        const bot = new PotatoBot(new Rng(seed), d)
        const p = potatoNew(0, 0)
        let lock = -1
        let t = 0
        let threw = -1
        while (threw < 0 && t < 3) {
          t += STEP
          const touch = bot.drive(t, p, 0, lock)
          if (!touch.tap) continue
          const r = tapResult(p, 0, t, lock)
          if (r === 'throw') threw = t
          else if (r === 'fumble') lock = t + FUMBLE
        }
        expect(threw).toBeGreaterThanOrEqual(CATCH)
      }
    }
  })

  it('hard reacts faster than normal, normal faster than easy', () => {
    const reaction = (d: Difficulty) => {
      let sum = 0
      for (let seed = 0; seed < 100; seed++) {
        const bot = new PotatoBot(new Rng(seed), d)
        const p = potatoNew(1, 0)
        let lock = -1
        let t = 0
        for (;;) {
          const touch = bot.drive(t, p, 1, lock)
          if (touch.tap) {
            const r = tapResult(p, 1, t, lock)
            if (r === 'throw') break
            if (r === 'fumble') lock = t + FUMBLE
          }
          t += STEP
        }
        sum += t
      }
      return sum / 100
    }
    expect(reaction('hard')).toBeLessThan(reaction('normal'))
    expect(reaction('normal')).toBeLessThan(reaction('easy'))
  })

  it('a bot does nothing while the other half holds the potato', () => {
    const bot = new PotatoBot(new Rng(1), 'hard')
    const p = potatoNew(0, 0)
    let threw = false
    for (let t = 0; t < 3; t += STEP) if (bot.drive(t, p, 1).tap) threw = true
    expect(threw).toBe(false)
  })

  it('a hard bot flicks harder than an easy one', () => {
    const force = (d: Difficulty) => {
      let sum = 0
      for (let seed = 0; seed < 60; seed++) {
        const bot = new PotatoBot(new Rng(seed), d)
        const p = potatoNew(0, 0)
        let t = 0
        let f = -1
        while (f < 0) {
          const touch = bot.drive(t, p, 0)
          if (touch.tap) f = touch.force
          t += STEP
        }
        sum += f
      }
      return sum / 60
    }
    expect(force('hard')).toBeGreaterThan(force('normal'))
    expect(force('normal')).toBeGreaterThan(force('easy'))
  })

  it('a harder bot holds the potato less and loses fewer rounds', () => {
    const rng = new Rng(3)
    const play = (a: Difficulty, b: Difficulty) => {
      let lostA = 0
      let heldA = 0
      let heldB = 0
      const n = 300
      for (let i = 0; i < n; i++) {
        const bots: [PotatoBot, PotatoBot] = [
          new PotatoBot(rng.fork(), a),
          new PotatoBot(rng.fork(), b),
        ]
        const r = botRound(bots, (i % 2) as Side, boomDelay(rng))
        if (r.loser === 0) lostA++
        heldA += r.held[0]
        heldB += r.held[1]
      }
      return { lost: lostA / n, heldA, heldB }
    }
    const hardVsEasy = play('hard', 'easy')
    expect(hardVsEasy.heldA).toBeLessThan(hardVsEasy.heldB)
    expect(hardVsEasy.lost).toBeLessThan(0.4)
    const normalVsEasy = play('normal', 'easy')
    expect(normalVsEasy.lost).toBeLessThan(0.5)
    const hardVsNormal = play('hard', 'normal')
    expect(hardVsNormal.heldA).toBeLessThan(hardVsNormal.heldB)
  })

  it('over seeded best-of-5 matches, hard beats easy most of the time and normal beats easy', () => {
    const rng = new Rng(11)
    const matchWins = (a: Difficulty, b: Difficulty): number => {
      let won = 0
      const n = 200
      for (let m = 0; m < n; m++) {
        const bots: [PotatoBot, PotatoBot] = [
          new PotatoBot(rng.fork(), a),
          new PotatoBot(rng.fork(), b),
        ]
        const wins: [number, number] = [0, 0]
        let server = (m % 2) as Side
        while (wins[0] < TARGET && wins[1] < TARGET) {
          const { loser } = botRound(bots, server, boomDelay(rng), warmth(wins, TARGET))
          wins[other(loser)]++
          server = loser
        }
        if (wins[0] === TARGET) won++
      }
      return won / n
    }
    // The hidden fuse keeps some luck in every round; skill still shows.
    expect(matchWins('hard', 'easy')).toBeGreaterThan(0.75)
    expect(matchWins('normal', 'easy')).toBeGreaterThan(0.65)
    expect(matchWins('hard', 'normal')).toBeGreaterThan(0.5)
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

  it('a human who grabs too soon is burnt and cannot throw until it cools', () => {
    const ctx = ctxFor([false, false], 'normal', 5)
    const game = factory() as unknown as {
      init(c: GameContext): void
      update(dt: number): void
      s: { pot: { holder: Side; throws: number }; lock: [number, number] }
    }
    game.init(ctx)
    const holder = game.s.pot.holder
    const idle = (n: number) => {
      for (let i = 0; i < n; i++) {
        game.update(STEP)
        ctx.input.endStep()
      }
    }
    const tap = (id: number) => {
      ctx.input.player(holder).press(id, 500, holder === 0 ? 1600 : 200)
      game.update(STEP)
      ctx.input.player(holder).release(id)
      ctx.input.endStep()
    }
    tap(1)
    expect(game.s.lock[holder]).toBeGreaterThan(0)
    // Past the catch delay but still burnt: nothing happens (and it burns again).
    idle(Math.round(CATCH / STEP))
    tap(2)
    expect(game.s.pot.throws).toBe(0)
    idle(Math.round(FUMBLE / STEP) + 2)
    tap(3)
    expect(game.s.pot.throws).toBe(1)
  })

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
