import { describe, expect, it } from 'vitest'
import { STEP, type GameContext, type Side } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import { H, W, type Stage } from '../../core/stage.ts'
import createGame, { match, type State } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  // Only the parts the controls read: the view and the two edges.
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

describe('tanks: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(3)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(3)
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(2)
  })

  it('no shell is left flying once a round is decided', () => {
    const game = createGame()
    game.init(botContext(3))
    const st = () => (game as unknown as { s: State }).s
    let between = 0
    while (game.result === null && game.time < 900) {
      game.update(STEP)
      if (st().rounds.phase === 'between') {
        between++
        expect(st().w.shells.length).toBe(0)
      }
    }
    expect(between).toBeGreaterThan(0)
  })
})
