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
    input: {
      player: () => ({ downs: [], held: new Map(), ups: [] }),
    } as unknown as GameContext['input'],
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

describe('maze paint: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(2)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(2)
  })

  it('defaults to a single race', () => {
    expect(match.default).toBe(1)
  })
})

describe('maze paint: swipes', () => {
  interface Peek {
    s: { panels: { lv: number; pos: number; moves: number; busyUntil: number; levelAt: number }[] }
    levels: { start: number; solution: number[] }[]
    time: number
    init(c: GameContext): void
    update(dt: number): void
  }

  /** A solo human game with a real input to swipe on. */
  function solo() {
    const inp = new PlayerInput(0)
    const ctx = botContext()
    ctx.bots = [false, false]
    ctx.input = { player: () => inp } as unknown as GameContext['input']
    const game = createGame() as unknown as Peek
    game.init(ctx)
    const tick = () => {
      game.update(STEP)
      inp.endStep()
    }
    let id = 0
    const swipe = (d: number) => {
      id++
      inp.press(id, 500, 900)
      tick()
      inp.move(id, 500 + [0, 1, 0, -1][d]! * 120, 900 + [-1, 0, 1, 0][d]! * 120)
      tick()
      inp.release(id)
      tick()
    }
    return { game, tick, swipe }
  }

  it('a swipe on a cleared board is not carried over to the next level', () => {
    const { game, tick, swipe } = solo()
    const panel = () => game.s.panels[0]!
    for (const d of game.levels[0]!.solution) {
      while (game.time < panel().busyUntil) tick()
      swipe(d)
    }
    expect(panel().lv).toBe(1)
    expect(game.time).toBeLessThan(panel().levelAt)
    // Swiping while the cleared board celebrates…
    swipe(1)
    swipe(2)
    while (game.time < panel().levelAt + 0.5) tick()
    // …does not roll the fresh board before it is seen.
    expect(panel().moves).toBe(0)
    expect(panel().pos).toBe(game.levels[1]!.start)
  })

  it('a hard swipe rolls the ball faster than a lazy drag', () => {
    const fast = solo()
    const d = fast.game.levels[0]!.solution[0]!
    fast.swipe(d)
    const quick = fast.game.s.panels[0]!.busyUntil - fast.game.time
    const slow = solo()
    const inp = (slow.game as unknown as { ctx: GameContext }).ctx.input.player(0)
    inp.press(1, 500, 900)
    slow.tick()
    // The same distance, dragged over half a second.
    for (let i = 1; i <= 30; i++) {
      inp.move(1, 500 + [0, 1, 0, -1][d]! * 2 * i, 900 + [-1, 0, 1, 0][d]! * 2 * i)
      slow.tick()
    }
    const lazy = slow.game.s.panels[0]!.busyUntil - slow.game.time
    expect(quick).toBeLessThan(lazy)
  })
})
