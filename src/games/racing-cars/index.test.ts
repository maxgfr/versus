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

/** Plays a whole race between two bots and returns the game. */
function play(target?: number) {
  const game = createGame()
  game.init(botContext(target))
  while (game.result === null && game.time < 900) game.update(STEP)
  return game
}

describe('racing cars: match length', () => {
  it('a race is over once the chosen number of laps is done', () => {
    const game = play(1)
    expect(game.result).not.toBeNull()
    expect(game.result?.winner).not.toBe('draw')
  })

  it('defaults to the spec length (three laps)', () => {
    expect(match.default).toBe(3)
    expect(match.unit).toBe('rounds')
  })
})
