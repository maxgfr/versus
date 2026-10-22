import { describe, expect, it } from 'vitest'
import { STEP, type GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match } from './index.ts'

/** Calls to fx, by method name (only `stop` is watched). */
const stops: number[] = []
let clock = () => 0

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: {} as GameContext['input'],
    fx: new Proxy(
      {},
      { get: (_, k) => (k === 'stop' ? () => stops.push(clock()) : noop) },
    ) as GameContext['fx'],
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
  clock = () => game.time
  game.init(botContext(target))
  while (game.result === null && game.time < 300) game.update(STEP)
  return game
}

describe('disco battle: match length', () => {
  it('the music stops when the chosen time runs out, with a chart to match', () => {
    const game = play(20)
    expect(game.s.endAt).toBeCloseTo(20, 1)
    expect(game.s.chart.every((n) => n.t < 20)).toBe(true)
    expect(game.result).not.toBeNull()
  })

  it('never freezes the beat with a hit-stop while the music plays', () => {
    stops.length = 0
    const game = play(30)
    expect(stops.length).toBeGreaterThan(0)
    for (const t of stops) expect(t).toBeGreaterThanOrEqual(game.s.endAt)
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(40)
  })
})
