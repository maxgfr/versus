import { describe, expect, it } from 'vitest'
import { type GameContext, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: { player: () => ({ downs: [] }) } as unknown as GameContext['input'],
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
  while (game.result === null && game.time < 1500) game.update(STEP)
  return game
}

describe('gravity run: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(3)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(3)
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(2)
  })
})
