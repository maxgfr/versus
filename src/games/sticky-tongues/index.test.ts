import { describe, expect, it } from 'vitest'
import { STEP, type GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: {} as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: { play: noop, unlock: noop, buzz: noop } as unknown as GameContext['audio'],
    rng: new Rng(7),
    mode: '1p',
    difficulty: 'normal',
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 7,
    target,
  }
}

/** Plays a whole match between two bots and returns the game. */
function play(target?: number) {
  const game = createGame()
  game.init(botContext(target))
  while (game.result === null && game.time < 300) game.update(STEP)
  return game
}

describe('sticky tongues: match length', () => {
  it('the buzzer goes when the chosen time runs out', () => {
    const game = play(20)
    expect(game.s.endAt).toBeCloseTo(20, 1)
    expect(game.result).not.toBeNull()
  })

  it('the last-seconds countdown follows the chosen length, not the default', () => {
    const counts: number[] = []
    const ctx = botContext(20)
    let now = 0
    ctx.audio = {
      play: (n: string) => n === 'count' && counts.push(now),
      unlock: () => undefined,
      buzz: () => undefined,
    } as unknown as GameContext['audio']
    const game = createGame()
    game.init(ctx)
    while (game.result === null && game.time < 60) {
      game.update(STEP)
      now = game.time
    }
    expect(counts.length).toBe(3)
    for (const t of counts) {
      expect(t).toBeGreaterThan(16.9)
      expect(t).toBeLessThan(20)
    }
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(40)
    expect(play().s.endAt).toBeCloseTo(match.default, 1)
  })
})
