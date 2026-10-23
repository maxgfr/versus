import { describe, expect, it } from 'vitest'
import { type Difficulty, type GameContext, STEP } from '../../core/game.ts'
import { Input, PlayerInput } from '../../core/input.ts'
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

describe('snakes: swipes steer', () => {
  it('a drag across your half turns your bike that way, a reverse is ignored', () => {
    const input = new Input({} as GameContext['stage'], '2p', 0)
    const ctx = {
      ...botContext(),
      input,
      mode: '2p' as const,
      bots: [false, false] as [boolean, boolean],
    }
    const game = createGame() as unknown as {
      init: (c: GameContext) => void
      update: (dt: number) => void
      time: number
      s: { b: { bikes: { dir: number; q: number[] }[] } }
    }
    game.init(ctx)
    const step = () => {
      input.setNow(game.time)
      game.update(STEP)
      input.endStep()
    }
    // Red heads north. Swipe right on the board (not on a button).
    input.player(0).press(1, 400, 1200)
    step()
    input.player(0).move(1, 520, 1200)
    step()
    expect(game.s.b.bikes[0]?.dir === 1 || game.s.b.bikes[0]?.q[0] === 1).toBe(true)
    input.player(0).release(1)
    step()
    // Blue reads the board turned around: its "right" is the world's left.
    // Blue heads south (its own "up"); a swipe to its right is a world drag to the left.
    input.player(1).press(2, 600, 500)
    step()
    input.player(1).move(2, 480, 500)
    step()
    const blue = game.s.b.bikes[1]
    expect(blue?.dir === 3 || blue?.q[0] === 1).toBe(true)
    input.player(1).release(2)
    step()
    // Straight back toward its own trail: no turn queued.
    for (let i = 0; i < 30; i++) step()
    const red = game.s.b.bikes[0]
    const q = red?.q.length ?? 0
    const back = ((red?.dir ?? 0) + 2) % 4
    const v: [number, number] = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ][back] as [number, number]
    input.player(0).press(3, 400, 1200)
    step()
    input.player(0).move(3, 400 + v[0] * 120, 1200 + v[1] * 120)
    step()
    expect(red?.q.length ?? 0).toBeLessThanOrEqual(q)
  })
})

/** Plays a whole match between two bots and returns the game. */
function play(target?: number) {
  const game = createGame()
  game.init(botContext(target))
  while (game.result === null && game.time < 900) game.update(STEP)
  return game
}

describe('snakes: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(2)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(2)
  })

  it('defaults to the spec length (best of five)', () => {
    expect(match.default).toBe(3)
    expect(match.unit).toBe('wins')
  })
})

describe('snakes: tempo', () => {
  /** Moves made in the first second of the first round. */
  function movesInASecond(difficulty: Difficulty, bots?: [boolean, boolean]): number {
    const game = createGame()
    game.init(botContext(3, difficulty, bots))
    for (let i = 0; i < 60; i++) game.update(STEP)
    return (game.snapshot() as { s: State }).s.b.ticks
  }

  it('normal keeps the move ramp exactly as before', () => {
    expect(TEMPO.normal).toBe(1)
    expect(tickLen(0)).toBe(TICK)
    expect(tickLen(1e6)).toBe(TICK_MIN)
    expect(tickLen(40, TEMPO.normal)).toBe(tickLen(40))
    expect(movesInASecond('normal')).toBe(8)
  })

  it('a hard computer makes the bikes move faster, an easy one slower', () => {
    expect(movesInASecond('hard')).toBe(10)
    expect(movesInASecond('easy')).toBe(6)
    expect(tickLen(0) / tickLen(0, TEMPO.hard)).toBeGreaterThan(1.2)
  })

  it('without a computer the level does not touch the pace', () => {
    expect(movesInASecond('hard', [false, false])).toBe(8)
  })

  it('bots still settle rounds, and beat an idle rider, at the hard tempo', () => {
    // Two hard bots mirror each other into draws (as at normal pace), so check
    // that rounds still resolve, then a full match against a rider that never turns.
    const duel = createGame()
    duel.init(botContext(2, 'hard'))
    while ((duel.snapshot() as { s: State }).s.rounds.round < 3 && duel.time < 120)
      duel.update(STEP)
    expect((duel.snapshot() as { s: State }).s.rounds.round).toBeGreaterThanOrEqual(3)
    const solo = createGame()
    solo.init(botContext(2, 'hard', [false, true]))
    while (solo.result === null && solo.time < 900) solo.update(STEP)
    expect(solo.result?.winner).toBe(1)
  })
})
