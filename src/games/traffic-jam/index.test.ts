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

/** Plays a whole match between two bots and returns the game. */
function play(target?: number) {
  const game = createGame()
  game.init(botContext(target))
  while (game.result === null && game.time < 300) game.update(STEP)
  return game
}

describe('traffic jam: match length', () => {
  it('the match is timed in seconds and the spec default is 45', () => {
    expect(match).toEqual({ unit: 'seconds', default: 45, min: 15, max: 120, step: 15 })
  })

  it('the whistle blows at the chosen length and the score is cars across', () => {
    const game = play(15)
    expect(game.result).not.toBeNull()
    expect(game.time).toBeGreaterThanOrEqual(15)
    expect(game.time).toBeLessThan(15 + 3)
    expect(game.result?.score).toBeDefined()
  })
})
