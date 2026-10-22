import { describe, expect, it } from 'vitest'
import { type GameContext, STEP } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import { PlayerInput } from '../../core/input.ts'
import { toWorld } from '../../engines/puzzle/index.ts'
import { halfFrame } from '../../engines/runner/frame.ts'
import createGame, { match, type State } from './index.ts'
import { geometry, hoverY, place } from './render.ts'

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

describe('nuts and bolts: match length', () => {
  it('the first to the chosen number of round wins takes the match', () => {
    const game = play(2)
    expect(game.result).not.toBeNull()
    expect(Math.max(...(game.result?.score ?? [0, 0]))).toBe(2)
  })

  it('defaults to a single race', () => {
    expect(match.default).toBe(1)
  })
})

/** Two humans in local 2P with scriptable fingers. */
function humans() {
  const players = [new PlayerInput(0), new PlayerInput(1)]
  const c = {
    ...botContext(),
    mode: '2p',
    bots: [false, false],
    input: { player: (side: 0 | 1) => players[side] },
  } as unknown as GameContext
  const game = createGame()
  game.init(c)
  const s = () => (game.snapshot() as { s: State }).s
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      game.update(STEP)
      for (const p of players) p.endStep()
    }
  }
  const red = players[0] as PlayerInput
  const f = halfFrame(0, '2p')
  const geo = geometry(f.w, f.h)
  /** World point over bolt i of red's board, `lift` units above its plate. */
  const at = (i: number, lift = 120) => {
    const p = place(geo, i)
    return toWorld(f, p.x, p.base - lift)
  }
  let id = 0
  const tap = (i: number) => {
    const w = at(i)
    red.press(++id, w.x, w.y)
    tick()
    red.release(id)
    tick()
  }
  return { s, tick, red, tap, at, geo, f }
}

/** One move (the 5 onto the empty last bolt) from a board with no legal move left. */
const BEFORE = [
  [3, 3, 3, 0],
  [4, 4, 4, 0],
  [5, 5, 5, 0],
  [1, 1, 1, 1],
  [2, 2, 2, 2],
  [0, 3, 5],
  [4],
  [],
]

/** Bolt 0 tops with a lone 2, bolt 1 is empty, bolt 4 has room for one more 2. */
const OPEN = [
  [1, 2],
  [],
  [0, 0, 0, 0],
  [1, 1, 1],
  [2, 2, 2],
  [3, 3, 3, 3],
  [4, 4, 4, 4],
  [5, 5, 5, 5],
]

describe('nuts and bolts: dead ends', () => {
  it('a move into a dead end is stepped back, with a time penalty', () => {
    const { s, tick, tap } = humans()
    s().boards[0].bolts = BEFORE.map((x) => x.slice())
    tap(5)
    expect(s().boards[0].hand).not.toBeNull()
    tap(7)
    expect(s().boards[0].bolts[7]).toEqual([5])
    expect(s().boards[0].deadAt).toBeGreaterThan(0)
    // Taps are ignored while the dead end shows.
    tap(6)
    expect(s().boards[0].hand).toBeNull()
    tick(120)
    expect(s().boards[0].deadAt).toBe(-1)
    expect(s().boards[0].bolts).toEqual(BEFORE)
    expect(s().race[0].penalty).toBe(5)
  })
})

describe('nuts and bolts: drag', () => {
  it('a run carried by the finger drops on the bolt it is let go over', () => {
    const { s, tick, red, at, geo, f } = humans()
    s().boards[0].bolts = OPEN.map((x) => x.slice())
    const from = at(0)
    red.press(1, from.x, from.y)
    tick()
    expect(s().boards[0].hand?.n).toBe(1)
    // Swing across to bolt 4 and let go.
    const x0 = place(geo, 0).x
    const to = place(geo, 4)
    for (let i = 1; i <= 8; i++) {
      const p = toWorld(f, x0 + ((to.x - x0) * i) / 8, hoverY(geo, to.base, 3, 0))
      red.move(1, p.x, p.y)
      tick()
    }
    red.release(1)
    tick()
    expect(s().boards[0].hand).toBeNull()
    expect(s().boards[0].bolts[4]).toEqual([2, 2, 2, 2])
    expect(s().boards[0].bolts[0]).toEqual([1])
    // The swing's speed carries into the flight.
    expect(s().boards[0].move?.k).toBeGreaterThan(0)
  })

  it('a tap without travel keeps the run lifted for a second tap', () => {
    const { s, tap } = humans()
    s().boards[0].bolts = OPEN.map((x) => x.slice())
    tap(0)
    expect(s().boards[0].hand?.from).toBe(0)
    tap(1)
    expect(s().boards[0].bolts[1]).toEqual([2])
  })
})
