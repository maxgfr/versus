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

describe('rat race: match length', () => {
  it('the first rat to the chosen number of laps wins', () => {
    const game = play(1)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(1)
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(3)
  })
})

describe('rat race: the ending', () => {
  it('the result is fixed when decided: a loser coasting over the line is no draw', () => {
    const game = createGame() as unknown as {
      init: (c: GameContext) => void
      update: (dt: number) => void
      result: unknown
      s: { rats: { angle: number; speed: number }[]; won: unknown }
    }
    game.init(botContext(1))
    // Red is about to cross; blue is right behind and still running hard.
    game.s.rats[0]!.angle = Math.PI * 2 - 0.01
    game.s.rats[0]!.speed = 3
    game.s.rats[1]!.angle = Math.PI * 2 - 0.05
    game.s.rats[1]!.speed = 3
    game.update(STEP)
    expect(game.s.won).toBe(0)
    for (let i = 0; i < 60 && !game.result; i++) game.update(STEP)
    expect(game.s.rats[1]!.angle).toBeGreaterThan(Math.PI * 2)
    expect(game.s.won).toBe(0)
  })
})
