import { describe, expect, it, vi } from 'vitest'
import { type GameContext, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match } from './index.ts'

// The computer normally thinks in a Web Worker; here its search runs inline.
vi.mock('../../engines/board/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../engines/board/index.ts')>()
  const ai = await import('./ai.ts')
  return {
    ...real,
    think: (_game: string, state: unknown, difficulty: string, seed: number) =>
      Promise.resolve(
        ai.choose(state as Parameters<typeof ai.choose>[0], difficulty as 'easy', seed),
      ),
  }
})

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: {} as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: { play: noop, unlock: noop, buzz: noop } as unknown as GameContext['audio'],
    rng: new Rng(11),
    mode: '1p',
    difficulty: 'normal',
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 11,
    target,
  }
}

describe('mancala: match length', () => {
  it('ends the match only when one side has the chosen round wins, scored in rounds', async () => {
    expect(match.default).toBe(1)
    const game = createGame()
    game.init(botContext(2))
    // Each computer move resolves on a later tick, so the loop yields between steps.
    while (game.result === null && game.time < 3000) {
      game.update(STEP)
      await Promise.resolve()
    }
    const [red, blue] = game.s.wins
    expect(game.result).not.toBeNull()
    expect(Math.max(red, blue)).toBe(2)
    expect(game.result?.winner).toBe(red === 2 ? 0 : 1)
    expect(game.result?.score).toEqual([red, blue])
  })
})
