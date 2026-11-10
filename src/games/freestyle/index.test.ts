import { describe, expect, it } from 'vitest'
import { STEP, type GameContext, type Mode } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import createGame, { match, options } from './index.ts'

/** No touches; sound and sparks are no-ops. */
function context(mode: Mode, bots: [boolean, boolean], o?: Record<string, string>): GameContext {
  const noop = () => undefined
  return {
    stage: {} as GameContext['stage'],
    input: {} as GameContext['input'],
    fx: new Proxy({}, { get: () => noop }) as GameContext['fx'],
    audio: { play: noop, unlock: noop, buzz: noop } as unknown as GameContext['audio'],
    rng: new Rng(7),
    mode,
    difficulty: 'normal',
    bots,
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 7,
    target: 1,
    ...(o ? { options: o } : {}),
  }
}

function play(ctx: GameContext) {
  const game = createGame()
  game.init(ctx)
  for (let i = 0; i < 60 * 60 * 5 && !game.result; i++) game.update(STEP)
  return game
}

describe('Freestyle Battle', () => {
  it('reaches a verdict between two computers', () => {
    const game = play(context('2p', [true, true]))
    expect(game.result).not.toBeNull()
  })

  it('ends solo practice with red done', () => {
    // Red is human here, so the game reads its input: nobody touches the screen.
    const ctx = context('1p', [false, false])
    ctx.input = { player: () => ({ downs: [] }) } as unknown as GameContext['input']
    const game = play(ctx)
    expect(game.result?.winner).toBe(0)
    expect(game.result?.note).toMatch(/bars freestyled/)
  })

  it('reads its settings and survives a snapshot round trip', () => {
    const game = createGame()
    game.init(context('2p', [true, true], { lang: 'en', words: 'off', theme: 'food' }))
    const s = (game.snapshot() as { s: { lang: string; theme: string; words: string[][] } }).s
    expect(s.lang).toBe('en')
    expect(s.theme).toBe('food')
    expect(s.words.flat()).toEqual([])
    const copy = createGame()
    copy.init(context('2p', [true, true]))
    copy.restore(JSON.parse(JSON.stringify(game.snapshot())))
    expect((copy.snapshot() as { s: unknown }).s).toEqual(s)
  })

  it('declares every option default among its choices', () => {
    for (const o of options) expect(o.choices.map(([v]) => v)).toContain(o.default)
    expect(match.default).toBeGreaterThanOrEqual(match.min)
  })
})
