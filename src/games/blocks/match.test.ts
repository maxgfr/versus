import { describe, expect, it } from 'vitest'
import type { GameContext } from '../../core/game.ts'
import { Rng } from '../../core/rng.ts'
import game, { match } from './index.ts'

/** Effects and sound do nothing; both sides are bots, so the match plays itself out. */
function ctx(target?: number): GameContext {
  const sink = new Proxy({}, { get: () => () => {} })
  return {
    stage: sink,
    input: { player: () => ({ downs: [], ups: [], held: new Map() }) },
    fx: sink,
    audio: sink,
    rng: new Rng(5),
    mode: '2p',
    difficulty: 'hard',
    bots: [true, true],
    teams: false,
    names: ['Red', 'Blue'],
    local: 0,
    seed: 17,
    target,
  } as never
}

describe('blocks match length', () => {
  it('declares the 90 s clock as the default, in 15 s steps', () => {
    expect(match).toEqual({ unit: 'seconds', default: 90, min: 15, max: 180, step: 15 })
  })

  it('starts on the default clock when the context omits a length', () => {
    const g = game()
    g.init(ctx())
    expect((g.snapshot() as { s: { sec: number } }).s.sec).toBe(90)
  })

  it('blows the whistle when the chosen length runs out', () => {
    const g = game()
    g.init(ctx(30))
    expect((g.snapshot() as { s: { sec: number } }).s.sec).toBe(30)
    for (let i = 0; i < 60 * 40 && !g.result; i++) g.update(1 / 60)
    expect(g.result?.note).toBe('Time up')
    // Result shows after the whistle's delay, well short of the 90 s default.
    const t = (g.snapshot() as { t: number }).t
    expect(t).toBeGreaterThanOrEqual(30)
    expect(t).toBeLessThan(35)
  })
})
