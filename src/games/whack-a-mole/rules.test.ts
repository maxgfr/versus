import { describe, expect, it } from 'vitest'
import type { Audio } from '../../core/audio.ts'
import { Fx } from '../../core/fx/fx.ts'
import { STEP, type Difficulty, type GameContext, type Side } from '../../core/game.ts'
import { Input } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import { MoleBot } from './bot.ts'
import factory, { type Cell } from './index.ts'
import {
  BUNNY_POINTS,
  GAME_TIME,
  HOLES,
  MOLE_POINTS,
  holeAt,
  holeXY,
  pointsFor,
  scheduleFor,
  winnerOf,
  type Pop,
} from './rules.ts'

describe('whack a mole rules', () => {
  it('moles are worth a point and bunnies cost two', () => {
    expect(pointsFor('mole')).toBe(MOLE_POINTS)
    expect(pointsFor('bunny')).toBe(BUNNY_POINTS)
    expect(MOLE_POINTS).toBe(1)
    expect(BUNNY_POINTS).toBe(-2)
  })

  it('the most points wins, and a tie is a draw', () => {
    expect(winnerOf([5, 3])).toBe(0)
    expect(winnerOf([2, 9])).toBe(1)
    expect(winnerOf([4, 4])).toBe('draw')
    expect(winnerOf([-2, -2])).toBe('draw')
    expect(winnerOf([-1, 0])).toBe(1)
  })

  it('a point on a hole centre lands on that hole; far away lands on none', () => {
    for (let i = 0; i < HOLES; i++) {
      const { x, y } = holeXY(i)
      expect(holeAt(x, y)).toBe(i)
      expect(holeAt(x + 20, y - 15)).toBe(i)
    }
    expect(holeAt(20, 900)).toBe(-1)
    expect(holeAt(500, 880)).toBe(-1)
  })

  it('the schedule is seeded and covers the whole match', () => {
    const a = scheduleFor(new Rng(12), false)
    const b = scheduleFor(new Rng(12), false)
    expect(a).toEqual(b)
    expect(a[0]?.at).toBeLessThan(1.2)
    expect(a[a.length - 1]?.at).toBeGreaterThan(GAME_TIME - 2)
  })

  it('a hole never pops again before its last pop has gone down', () => {
    for (let seed = 0; seed < 30; seed++) {
      const pops = scheduleFor(new Rng(seed), seed % 2 === 0)
      const last: Record<number, Pop | undefined> = {}
      for (const p of pops) {
        const prev = last[p.hole]
        if (prev) expect(p.at).toBeGreaterThanOrEqual(prev.at + prev.dur)
        last[p.hole] = p
      }
    }
  })

  it('a match has a sensible number of pops, with bunnies a minority', () => {
    let total = 0
    let bunnies = 0
    for (let seed = 0; seed < 40; seed++) {
      for (const p of scheduleFor(new Rng(seed), false)) {
        total++
        if (p.kind === 'bunny') bunnies++
      }
    }
    const perGame = total / 40
    expect(perGame).toBeGreaterThan(50)
    expect(perGame).toBeLessThan(110)
    expect(bunnies / total).toBeGreaterThan(0.18)
    expect(bunnies / total).toBeLessThan(0.34)
  })

  it('teams get faster pops, so there are more of them', () => {
    const solo = scheduleFor(new Rng(4), false).length
    const team = scheduleFor(new Rng(4), true).length
    expect(team).toBeGreaterThan(solo)
  })

  it('hard whackers catch moles more often, and bunnies less often', () => {
    const rate = (d: Difficulty) => {
      const rng = new Rng(8)
      const bot = new MoleBot(rng.fork(), d)
      let moles = 0
      let caught = 0
      let bunnyHits = 0
      for (let seed = 0; seed < 60; seed++) {
        const pops = scheduleFor(new Rng(seed), false)
        const cells: (Cell | null)[] = Array.from({ length: 9 }, () => null)
        let time = 0
        let next = 0
        const end = GAME_TIME
        while (time < end) {
          time += STEP
          while (next < pops.length && (pops[next]?.at ?? Infinity) <= time) {
            const p = pops[next] as Pop
            cells[p.hole] = { kind: p.kind, at: p.at, until: p.at + p.dur, st: 'up', t: p.at }
            if (p.kind === 'mole') moles++
            next++
          }
          for (const h of bot.drive(time, cells)) {
            const c = cells[h]
            if (!c || c.st !== 'up') continue
            c.st = c.kind === 'mole' ? 'hit' : 'bad'
            if (c.kind === 'mole') caught++
            else bunnyHits++
          }
          for (const c of cells) if (c && c.st === 'up' && time >= c.until) c.st = 'down'
        }
      }
      return { catches: caught / moles, bunny: bunnyHits }
    }
    const hard = rate('hard')
    const easy = rate('easy')
    expect(hard.catches).toBeGreaterThan(easy.catches)
    expect(hard.catches).toBeGreaterThan(0.6)
    expect(hard.bunny).toBeLessThan(easy.bunny)
  })
})

// ---------- game level ----------

function ctxFor(
  bots: [boolean, boolean],
  difficulty: Difficulty,
  seed: number,
  mode: GameContext['mode'] = '2p',
  teams = false,
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
    teams,
    names: ['Red', 'Blue'],
    local: 0,
    seed,
  }
}

describe('whack a mole game', () => {
  it('tapping a rising mole scores, and a bunny takes points away', () => {
    const ctx = ctxFor([false, false], 'normal', 21)
    const game = factory()
    game.init(ctx)
    const plan = game.s.plan
    const mole = plan.find((p) => p.kind === 'mole')
    const bunny = plan.find((p) => p.kind === 'bunny' && p.at > (mole?.at ?? 0) + 1.5)
    expect(mole).toBeDefined()
    expect(bunny).toBeDefined()
    const tapHole = (hole: number, id: number) => {
      const { x, y } = holeXY(hole)
      ctx.input.player(0).press(id, x, y)
      game.update(STEP)
      ctx.input.endStep()
    }
    const runTo = (t: number) => {
      while (game.time < t) {
        game.update(STEP)
        ctx.input.endStep()
      }
    }
    runTo((mole?.at ?? 0) + 0.1)
    tapHole(mole?.hole ?? 0, 1)
    expect(game.s.score).toEqual([1, 0])
    // Tapping the same mole again does nothing.
    tapHole(mole?.hole ?? 0, 2)
    expect(game.s.score).toEqual([1, 0])

    runTo((bunny?.at ?? 0) + 0.1)
    tapHole(bunny?.hole ?? 0, 3)
    expect(game.s.score).toEqual([1 + BUNNY_POINTS, 0])
  })

  it('a tap that misses every hole scores nothing', () => {
    const ctx = ctxFor([false, false], 'normal', 22)
    const game = factory()
    game.init(ctx)
    while (game.time < 3) {
      game.update(STEP)
      ctx.input.endStep()
    }
    ctx.input.player(0).press(9, 40, 900)
    game.update(STEP)
    ctx.input.endStep()
    expect(game.s.score).toEqual([0, 0])
  })

  it('a computer on each side plays a full match to a result', () => {
    for (const teams of [false, true]) {
      const game = factory()
      game.init(ctxFor([true, true], 'normal', 31, '2p', teams))
      let steps = 0
      while (!game.result) {
        game.update(STEP)
        if (++steps > 60 * 120) throw new Error('no result')
      }
      const w = game.result.winner
      expect(w === 0 || w === 1 || w === 'draw').toBe(true)
      expect(game.result.score?.length).toBe(2)
      expect(game.time).toBeGreaterThanOrEqual(GAME_TIME)
    }
  })

  it('the winner is the side with the most points at the buzzer', () => {
    const game = factory()
    game.init(ctxFor([true, true], 'hard', 5))
    let steps = 0
    while (!game.result) {
      game.update(STEP)
      if (++steps > 60 * 120) throw new Error('no result')
    }
    const [red, blue] = game.result.score ?? [0, 0]
    expect(game.result.winner).toBe(winnerOf([red, blue]))
  })
})

describe('whack-a-mole match length', () => {
  it('schedules pops for the chosen clock', () => {
    const short = scheduleFor(new Rng(4), false, 20)
    const long = scheduleFor(new Rng(4), false, 90)
    expect(short[short.length - 1]?.at ?? 0).toBeLessThan(21)
    expect(long[long.length - 1]?.at ?? 0).toBeGreaterThan(80)
  })
})
