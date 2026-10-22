import { describe, expect, it } from 'vitest'
import { STEP, type GameContext, type Side } from '../../core/game.ts'
import { PlayerInput } from '../../core/input.ts'
import { Rng } from '../../core/rng.ts'
import { H, W, type Stage } from '../../core/stage.ts'
import createGame, { match } from './index.ts'

/** Computer vs computer: no touches, and sound and sparks are no-ops. */
function botContext(target?: number, bots: [boolean, boolean] = [true, true]): GameContext {
  const players = [new PlayerInput(0), new PlayerInput(1)]
  const noop = () => undefined
  const stage = {
    view: { x: 0, y: 0, w: W, h: H },
    edge: (side: Side) => (side === 0 ? H : 0),
    safe: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as Stage
  return {
    stage,
    input: { player: (side: Side) => players[side] } as unknown as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: new Proxy({}, { get: () => noop }) as GameContext['audio'],
    rng: new Rng(7),
    mode: '1p',
    difficulty: 'normal',
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
  while (game.result === null && game.time < 1800) game.update(STEP)
  return game
}

describe('dung battle: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(3)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(3)
  })

  it('defaults to best of three', () => {
    expect(match.default).toBe(2)
    expect(match.unit).toBe('wins')
  })
})

describe('dung battle: the flick', () => {
  /** Red's thumb goes down on its stick and moves `per` units up the screen each step. */
  function swipe(per: number) {
    const ctx = botContext(undefined, [false, true])
    const game = createGame()
    game.init(ctx)
    const red = ctx.input.player(0)
    // Let the opening stamp pass so the round is in full swing.
    for (let i = 0; i < 30; i++) game.update(STEP)
    let y = 1650
    red.press(1, 300, y)
    for (let i = 0; i < 8; i++) {
      game.update(STEP)
      red.endStep()
      y -= per
      red.move(1, 300, y)
    }
    return (
      game as unknown as { s: { w: { bugs: { beetle: { dashT: number; dashK: number } }[] } } }
    ).s.w.bugs[0]!.beetle
  }

  it('a fast flick of the stick charges, with power from the flick speed', () => {
    const quick = swipe(60) // 3600 units/s
    expect(quick.dashT).toBeGreaterThan(0)
    const fast = swipe(90) // 5400 units/s
    expect(fast.dashK).toBeGreaterThan(quick.dashK)
  })

  it('steering at a normal pace never charges', () => {
    expect(swipe(12).dashT).toBe(-1)
  })
})
