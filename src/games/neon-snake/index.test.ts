import { describe, expect, it } from 'vitest'
import { type Difficulty, type GameContext, STEP } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match, type State } from './index.ts'
import { TEMPO, TICK, TICK_MIN, tickLen } from './rules.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(
  target?: number,
  difficulty: Difficulty = 'normal',
  bots: [boolean, boolean] = [true, true],
): GameContext {
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

describe('neon snake: tempo', () => {
  /** Seconds between moves a moment into the first round. */
  function tickAfterStart(difficulty: Difficulty, bots?: [boolean, boolean]): number {
    const game = createGame()
    game.init(botContext(3, difficulty, bots))
    for (let i = 0; i < 30; i++) game.update(STEP)
    return (game.snapshot() as { s: State }).s.b.len
  }

  it('normal keeps the tick ramp exactly as before', () => {
    expect(TEMPO.normal).toBe(1)
    expect(tickLen(0)).toBe(TICK)
    expect(tickLen(999)).toBe(TICK_MIN)
    expect(tickLen(20, TEMPO.normal)).toBe(tickLen(20))
    expect(tickAfterStart('normal')).toBeCloseTo(tickLen(0.5), 9)
  })

  it('a hard computer makes the snakes tick faster, an easy one slower', () => {
    const normal = tickAfterStart('normal')
    expect(normal / tickAfterStart('hard')).toBeGreaterThan(1.2)
    expect(normal / tickAfterStart('easy')).toBeLessThan(0.9)
  })

  it('without a computer the level does not touch the pace', () => {
    expect(tickAfterStart('hard', [false, false])).toBe(tickAfterStart('normal', [false, false]))
  })

  it('bots still finish a match at the hard tempo', () => {
    const game = createGame()
    game.init(botContext(2, 'hard'))
    while (game.result === null && game.time < 900) game.update(STEP)
    expect(game.result).not.toBeNull()
  })
})
