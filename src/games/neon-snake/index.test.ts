import { describe, expect, it } from 'vitest'
import { type GameContext, STEP } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {
      view: { x: 0, y: 0, w: 1000, h: 1800 },
      edge: () => 0,
      safe: {},
    } as unknown as GameContext['stage'],
    input: { player: (side: 0 | 1) => new PlayerInput(side) } as unknown as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: new Proxy({}, { get: () => noop }) as GameContext['audio'],
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
  while (game.result === null && game.time < 900) game.update(STEP)
  return game
}

describe('neon snake: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(2)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(2)
  })

  it('defaults to the spec length (best of three)', () => {
    expect(match.default).toBe(2)
    expect(match.unit).toBe('wins')
  })
})
