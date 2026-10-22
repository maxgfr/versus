import { describe, expect, it } from 'vitest'
import { STEP, type GameContext } from '../../core/game.ts'
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

describe('broken tiles: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(3)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(3)
  })

  it('defaults to the spec length (best of three)', () => {
    expect(match.default).toBe(2)
    expect(match.unit).toBe('wins')
  })
})

describe('broken tiles: input and flow', () => {
  function humanGame() {
    const players: [PlayerInput, PlayerInput] = [new PlayerInput(0), new PlayerInput(1)]
    const ctx = botContext()
    ctx.input = { player: (side: 0 | 1) => players[side] } as unknown as GameContext['input']
    ctx.bots = [false, true]
    ctx.mode = '1p'
    const game = createGame()
    game.init(ctx)
    const step = () => {
      game.update(STEP)
      for (const p of players) p.endStep()
    }
    return { game, players, step }
  }

  it('a slow drag walks, a fast flick of the finger dashes', () => {
    const { game, players, step } = humanGame()
    const s = () => (game.snapshot() as { s: { b: { p: { dash: number; x: number }[] } } }).s
    players[0].press(1, 500, 1400)
    step()
    // Slow drag right: 10 units a step = 600 units/s.
    for (let i = 1; i <= 12; i++) {
      players[0].move(1, 500 + i * 10, 1400)
      step()
    }
    expect(s().b.p[0]?.dash).toBe(0)
    // Flick: 90 units in one step = 5400 units/s.
    players[0].move(1, 710, 1400)
    step()
    expect(s().b.p[0]?.dash).toBeGreaterThan(0.9)
  })
})
