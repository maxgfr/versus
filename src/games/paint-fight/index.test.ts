import { describe, expect, it } from 'vitest'
import { STEP, type GameContext, type Side } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import { H, W, type Stage } from '../../core/stage.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  const stage = {
    view: { x: 0, y: 0, w: W, h: H },
    edge: (side: Side) => (side === 0 ? H : 0),
    safe: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as Stage
  return {
    stage,
    input: { player: (side: Side) => new PlayerInput(side) } as unknown as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: new Proxy({}, { get: () => noop }) as GameContext['audio'],
    rng: new Rng(21),
    mode: '1p',
    difficulty: 'normal',
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 21,
    target,
  }
}

describe('paint fight: match length', () => {
  it('the match is timed: it ends when the chosen seconds are up', () => {
    const game = createGame()
    game.init(botContext(15))
    while (game.result === null && game.time < 200) game.update(STEP)
    expect(game.result).not.toBeNull()
    expect(game.time).toBeGreaterThanOrEqual(15)
    expect(game.time).toBeLessThan(15 + 3)
  })

  it('defaults to a minute', () => {
    expect(match.unit).toBe('seconds')
    expect(match.default).toBe(60)
  })
})
