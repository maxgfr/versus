import { describe, expect, it } from 'vitest'
import { type GameContext, type Side, STEP } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import type { Stage } from '../../core/stage.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches; sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {} as Stage,
    input: { player: (side: Side) => new PlayerInput(side) } as unknown as GameContext['input'],
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

function play(target?: number) {
  const game = createGame()
  game.init(botContext(target))
  while (game.result === null && game.time < 900) game.update(STEP)
  return game
}

describe('road dodge: match length', () => {
  it('first to the chosen number of round wins takes the match', () => {
    const game = play(1)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(1)
  })

  it('defaults to first to 3 wins', () => {
    expect(match).toEqual({ unit: 'wins', default: 3, min: 1, max: 9 })
  })
})
