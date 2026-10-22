import { describe, expect, it } from 'vitest'
import { type GameContext, STEP } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: { player: () => ({ downs: [] }) } as unknown as GameContext['input'],
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
  while (game.result === null && game.time < 900) game.update(STEP)
  return game
}

describe('fruit merge: match length', () => {
  it('a short match ends on its own clock (plus the result delay)', () => {
    const game = play(30)
    expect(game.result).not.toBeNull()
    expect(game.time).toBeLessThanOrEqual(30 + 2 + 2 * STEP)
  })

  it('defaults to the spec length', () => {
    expect(match.default).toBe(120)
  })
})

describe('fruit merge: input', () => {
  /** Red human against a blue bot, with a real input to press and release. */
  function humanGame() {
    const red = new PlayerInput(0)
    const blue = new PlayerInput(1)
    const ctx = botContext()
    ctx.bots = [false, true]
    ctx.input = { player: (s: number) => (s === 0 ? red : blue) } as unknown as GameContext['input']
    const game = createGame() as unknown as {
      init(c: GameContext): void
      update(dt: number): void
      s: { wells: { jar: { bodies: { x: number; vx: number; vy: number }[] } }[] }
    }
    game.init(ctx)
    const tick = () => {
      game.update(STEP)
      red.endStep()
    }
    return { game, red, tick }
  }

  it('a release during the reload is dropped once the claw is ready, not lost', () => {
    const { game, red, tick } = humanGame()
    // Red's half: local y = world y - 900. Tap twice in quick succession.
    for (const id of [1, 2]) {
      red.press(id, 400, 900 + 500)
      tick()
      red.release(id)
      tick()
    }
    const bodies = () => game.s.wells[0]?.jar.bodies ?? []
    expect(bodies()).toHaveLength(1)
    for (let i = 0; i < 20; i++) tick()
    expect(bodies()).toHaveLength(2)
  })

  it('a fast sideways flick throws the fruit; a slow release drops it straight', () => {
    const { game, red, tick } = humanGame()
    red.press(1, 300, 1400)
    tick()
    red.move(1, 305, 1400)
    tick()
    red.release(1)
    tick()
    const slow = game.s.wells[0]?.jar.bodies[0]
    expect(slow?.vx).toBe(0)
    for (let i = 0; i < 20; i++) tick()
    red.press(2, 300, 1400)
    tick()
    for (let i = 1; i <= 4; i++) {
      red.move(2, 300 + i * 60, 1400 + i * 30)
      tick()
    }
    red.release(2)
    tick()
    const fast = game.s.wells[0]?.jar.bodies[1]
    expect(fast?.vx).toBeGreaterThan(300)
    expect(fast?.vy).toBeGreaterThan(0)
  })
})
