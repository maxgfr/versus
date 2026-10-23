import { describe, expect, it } from 'vitest'
import { type Difficulty, STEP, type GameContext, type Side } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match, type State } from './index.ts'
import { TEMPO } from './rules.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(
  target?: number,
  difficulty: Difficulty = 'normal',
  bots: [boolean, boolean] = [true, true],
): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: { player: (side: Side) => new PlayerInput(side) } as unknown as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: new Proxy({}, { get: () => noop }) as GameContext['audio'],
    rng: new Rng(7),
    mode: '1p',
    difficulty,
    bots,
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
  while (game.result === null && game.time < 3600) game.update(STEP)
  return game
}

describe('happy birds: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(3)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(3)
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(2)
  })
})

describe('happy birds: tempo', () => {
  const tempo = (d: Difficulty, bots?: [boolean, boolean]) => {
    const game = createGame()
    game.init(botContext(2, d, bots))
    return (game.snapshot() as { s: State }).s.tempo
  }

  it("the computer's level sets the pace, only when a computer plays", () => {
    expect(tempo('normal')).toBe(1)
    expect(tempo('hard')).toBe(TEMPO.hard)
    expect(tempo('easy', [false, true])).toBe(TEMPO.easy)
    expect(tempo('hard', [false, false])).toBe(1)
  })
})
